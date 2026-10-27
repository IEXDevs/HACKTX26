import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { ensureAccountWorkspace } from "./account-workspace";
import { createAgentGraph } from "./agent-factory";
import { getDb } from "./db/client";
import { agents, approvals, credentials, runs, workspaces, templates, templateProposals } from "./db/schema";
import { seedPlatform } from "./db/seed";
import { getAgent, getRun, requireWorkspace, listAgents, listTemplates } from "./queries";
import { saveLibraryWorkflow } from "./workflow-library";
import { addAccountKey, listAccountKeys } from "./account-assets";
import { PATCH } from "@/app/api/agents/[id]/route";
import { POST as fromTemplate } from "@/app/api/agents/from-template/route";

const identity = vi.hoisted(() => ({ id: "account-a", email: "a@example.invalid", name: "A" }));
vi.mock("./auth", () => ({ getSessionUser: async () => identity }));
const draft = { orchestrator: { name: "Private agent", summary: "Private summary", instructions: "Summarize public documents.", complexity: "standard" as const }, workers: [] };

beforeEach(async () => {
  delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
  await seedPlatform();
  identity.id = "account-a"; identity.email = "a@example.invalid";
});

describe("private account workspaces", () => {
  it("isolates lists, direct reads, writes, runs, and workflow source selection", async () => {
    const a = await requireWorkspace();
    const b = await ensureAccountWorkspace("account-b", "b@example.invalid");
    const created = await createAgentGraph({ workspace: a, actor: identity.email, auditAction: "agent.created", spec: draft });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const db = await getDb();
    const [builtin] = await db.select().from(templates).limit(1);
    await db.insert(templates).values({ ...builtin!, id: "private-template", key: "private-template", builtin: false });
    await db.insert(templateProposals).values({ id: "private-proposal", workspaceId: a.id, parentAgentId: created.orchestratorId, name: "Private template", summary: "Private", instructions: "Read public notes.", tools: [], role: "worker", reason: "Private reuse", status: "saved", templateId: "private-template", createdAt: new Date() });
    expect((await listTemplates()).some((row) => row.id === "private-template")).toBe(true);
    await (await getDb()).insert(runs).values({ id: "private-run", workspaceId: a.id, agentId: created.orchestratorId, goal: "Private goal", budgetUsd: 1, mode: "scripted", startedAt: new Date() });
    expect(await getAgent(created.orchestratorId)).not.toBeNull();
    identity.id = "account-b"; identity.email = "b@example.invalid";
    expect((await requireWorkspace()).id).toBe(b.id);
    expect(await getAgent(created.orchestratorId)).toBeNull();
    expect(await getRun("private-run")).toBeNull();
    expect((await listTemplates()).some((row) => row.id === "private-template")).toBe(false);
    expect((await fromTemplate(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ templateId: "private-template" }) }))).status).toBe(404);
    expect((await listAgents(b.id)).some((row) => row.id === created.orchestratorId)).toBe(false);
    const response = await PATCH(new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify({ status: "active" }) }), { params: Promise.resolve({ id: created.orchestratorId }) });
    expect(response.status).toBe(404);
    await expect(saveLibraryWorkflow(b, { name: "Other account", mode: "manual", nodes: [{ id: "lead", parentId: null, agentId: created.orchestratorId }] }, identity.email)).rejects.toThrow("no longer available");
    expect((await listAgents(a.id)).some((row) => row.id === created.orchestratorId)).toBe(true);
  });

  it("recovers only audited legacy ownership and keeps unassigned records intact", async () => {
    const [legacy] = await (await getDb()).select().from(workspaces).where(eq(workspaces.id, "ws_astronom"));
    const own = await createAgentGraph({ workspace: legacy!, actor: identity.email, auditAction: "agent.created", spec: draft });
    const foreign = await createAgentGraph({ workspace: legacy!, actor: "b@example.invalid", auditAction: "agent.created", spec: { ...draft, orchestrator: { ...draft.orchestrator, name: "B private" } } });
    const unknown = await createAgentGraph({ workspace: legacy!, actor: "operator@local", auditAction: "agent.created", spec: { ...draft, orchestrator: { ...draft.orchestrator, name: "Unassigned" } } });
    expect(own.ok && foreign.ok && unknown.ok).toBe(true);
    if (!own.ok || !foreign.ok || !unknown.ok) return;
    await (await getDb()).insert(runs).values({ id: "conflicting-legacy-run", workspaceId: legacy!.id, agentId: own.orchestratorId, goal: "Another operator's run", budgetUsd: 1, mode: "scripted", operatorUserId: "account-b", startedAt: new Date() });
    await (await getDb()).insert(approvals).values({ id: "conflicting-approval", workspaceId: legacy!.id, runId: "conflicting-legacy-run", agentId: own.orchestratorId, resource: "fs.write", scopes: ["write"], risk: "low", reason: "Another operator's decision", requestedAt: new Date() });
    const key = await addAccountKey({ workspaceId: legacy!.id, accountId: identity.id }, "muse", "synthetic-private-key-for-migration");
    const a = await requireWorkspace();
    expect((await getAgent(own.orchestratorId))?.workspaceId).toBe(a.id);
    expect(await getAgent(foreign.orchestratorId)).toBeNull();
    expect(await getAgent(unknown.orchestratorId)).toBeNull();
    expect(await listAccountKeys({ workspaceId: a.id, accountId: identity.id })).toMatchObject([{ id: key.id }]);
    const [keyRow] = await (await getDb()).select().from(credentials).where(eq(credentials.id, key.id));
    expect(keyRow!.workspaceId).toBe(a.id);
    const [untouched] = await (await getDb()).select().from(agents).where(eq(agents.id, unknown.orchestratorId));
    expect(untouched!.workspaceId).toBe("ws_astronom");
    const [conflict] = await (await getDb()).select().from(approvals).where(eq(approvals.id, "conflicting-approval"));
    expect(conflict!.workspaceId).toBe("ws_astronom");
    expect(await getRun("conflicting-legacy-run")).toBeNull();
    const b = await ensureAccountWorkspace("account-b", "b@example.invalid");
    expect((await listAgents(b.id)).map((row) => row.id)).toContain(foreign.orchestratorId);
    expect((await listAgents(b.id)).map((row) => row.id)).not.toContain(own.orchestratorId);
  });

  it("provisions the same private workspace once under concurrent requests", async () => {
    const rows = await Promise.all([ensureAccountWorkspace(identity.id, identity.email), ensureAccountWorkspace(identity.id, identity.email)]);
    expect(rows[0]!.id).toBe(rows[1]!.id);
    expect(await listAgents(rows[0]!.id)).toHaveLength(2);
  });
});
