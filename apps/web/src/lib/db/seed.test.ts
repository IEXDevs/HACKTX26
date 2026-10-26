import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "./client";
import {
  agents,
  approvals,
  auditLog,
  budgetPolicies,
  connectors,
  credentials,
  evalRuns,
  evalSuites,
  kbDocuments,
  memories,
  promptBlocks,
  runs,
  securityFindings,
  templates,
  triggers,
  users,
  workspaces,
} from "./schema";
import { DEALERSHIP_TEMPLATE_ID, ensurePlatformTemplates, seedPlatform } from "./seed";
import { ensureBootstrapped } from "../bootstrap";
import { eq } from "drizzle-orm";

async function freshPlatform() {
  const g = globalThis as unknown as { __agentOsDb?: unknown };
  delete g.__agentOsDb;
  const db = await getDb();
  await seedPlatform();
  return db;
}

describe("first boot", () => {
  let db: Awaited<ReturnType<typeof freshPlatform>>;
  beforeEach(async () => {
    db = await freshPlatform();
  });

  it("creates the workspace, the company policy, and the template catalog", async () => {
    expect(await db.select().from(workspaces)).toHaveLength(1);
    expect((await db.select().from(promptBlocks)).length).toBeGreaterThan(0);
    expect((await db.select().from(templates)).length).toBeGreaterThan(0);
  });

  it("has only the two team leads, and neither hangs under a sample parent", async () => {
    const rows = await db.select().from(agents);
    expect(rows.map((a) => a.id).sort()).toEqual(["agt_blue_team", "agt_red_team"]);
    expect(rows.every((a) => a.parentAgentId === null)).toBe(true);
    expect(rows.find((a) => a.id === "agt_red_team")?.team).toBe("red");
    expect(rows.find((a) => a.id === "agt_blue_team")?.team).toBe("blue");
  });

  it("budgets exist only for what exists", async () => {
    const owners = (await db.select().from(budgetPolicies)).map((b) => b.agentId);
    expect(owners.filter((id) => id !== null).sort()).toEqual(["agt_blue_team", "agt_red_team"]);
  });

  it("holds no sample people, runs, findings, connectors, or history", async () => {
    for (const table of [
      users,
      runs,
      approvals,
      memories,
      securityFindings,
      connectors,
      credentials,
      evalSuites,
      evalRuns,
      triggers,
      auditLog,
      kbDocuments,
    ]) {
      expect(await db.select().from(table)).toHaveLength(0);
    }
  });
});

describe("platform templates on an existing database", () => {
  beforeEach(async () => {
    await freshPlatform();
  });

  it("ships the dealership receptionist template once, however often boot runs", async () => {
    const db = await getDb();
    await ensurePlatformTemplates();
    await ensurePlatformTemplates();
    const rows = await db.select().from(templates).where(eq(templates.id, DEALERSHIP_TEMPLATE_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requiredConnectors).toEqual(["googlecalendar"]);
    expect(rows[0]?.graph.orchestrator.instructions).toContain("Monday to Saturday");
  });

  it("adds a missing template at boot without reseeding anything else", async () => {
    const db = await getDb();
    await db.delete(templates).where(eq(templates.id, DEALERSHIP_TEMPLATE_ID));
    const before = (await db.select().from(templates)).length;
    await ensureBootstrapped();
    expect((await db.select().from(templates)).length).toBe(before + 1);
    expect(await db.select().from(workspaces)).toHaveLength(1);
    expect(await db.select().from(users)).toHaveLength(0);
  });
});
