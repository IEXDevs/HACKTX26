import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/agents/from-template/route";
import { getDb } from "./db/client";
import { agents, auditLog, budgetPolicies, promptBlocks, templates, workspaces } from "./db/schema";

vi.mock("./queries", () => ({
  requireWorkspace: async () => (await getDb().select().from(workspaces).where(eq(workspaces.id, "ws_template")))[0],
  getWorkspaceUser: async () => ({ user: { email: "builder@local" } }),
}));

const create = (body: unknown) => POST(new NextRequest("http://localhost/api/agents/from-template", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));

describe("template creation through the shared factory", () => {
  beforeEach(async () => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    const db = getDb();
    await db.insert(workspaces).values({ id: "ws_template", name: "Templates", slug: "template-test", createdAt: new Date(), defaultRunBudgetUsd: 3 });
    await db.insert(promptBlocks).values({ id: "org_template", workspaceId: "ws_template", name: "Company", level: "org", content: "Follow policy.", locked: true, createdAt: new Date() });
    await db.insert(templates).values({ id: "tpl_test", key: "test", name: "Test", category: "operations", description: "A template.", outcome: "A verified report.", requiredConnectors: ["github"], createdAt: new Date(), graph: {
      orchestrator: { name: "Lead", instructions: "Delegate and verify.", complexity: "standard" },
      workers: [
        { name: "Reader", role: "worker", instructions: "Read notes.", complexity: "standard", tools: ["fs.read", "shell.exec"] },
        { name: "Reader", role: "security", instructions: "Check findings.", complexity: "complex", tools: ["fs.read"] },
      ],
    } });
  });

  it("preserves template provenance, ranks, grants, prompts, connectors, budgets, and audit records", async () => {
    const response = await create({ templateId: "tpl_test", name: "Renamed", dataClass: "confidential" });
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({ status: "draft", agentIds: expect.any(Array), issues: expect.any(Array) });
    const db = getDb();
    const rows = await db.select().from(agents);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.slug)).size).toBe(3);
    for (const row of rows) {
      expect(row).toMatchObject({ templateId: "tpl_test", status: "draft", dataClass: "confidential", inheritedPromptBlockIds: ["org_template"], allowedConnectors: ["github"] });
      expect(row.grants.every((grant) => grant.note?.includes("template capability list"))).toBe(true);
      expect(row.grants.some((grant) => grant.resource === "shell.exec")).toBe(false);
    }
    expect(rows.find((row) => row.id === result.orchestratorId)).toMatchObject({ name: "Renamed", rank: "orchestrator", canSpawnSubagents: true, summary: "A verified report.", maxSteps: 12 });
    expect(rows.filter((row) => row.parentAgentId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "worker", rank: "intermediate", maxSteps: 10 }),
      expect.objectContaining({ role: "security", rank: "intermediate", maxSteps: 16 }),
    ]));
    expect((await db.select().from(budgetPolicies))[0]).toMatchObject({ agentId: result.orchestratorId, limitUsd: 3, hardStop: true });
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "agent.created_from_template")))[0]).toMatchObject({ actor: "builder@local", detail: expect.objectContaining({ templateId: "tpl_test", templateKey: "test" }) });
  });

  it("rolls back the whole graph if its audit write fails", async () => {
    const db = getDb();
    db.$client.exec("CREATE TRIGGER fail_template_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit failed'); END;");
    await expect(create({ templateId: "tpl_test" })).rejects.toThrow();
    expect(await db.select().from(agents)).toEqual([]);
    expect(await db.select().from(budgetPolicies)).toEqual([]);
  });

  it("rejects invalid bodies and missing templates without writing agents", async () => {
    expect((await create({})).status).toBe(400);
    expect((await create({ templateId: "missing" })).status).toBe(404);
    expect(await getDb().select().from(agents)).toEqual([]);
  });
});
