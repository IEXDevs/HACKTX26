import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentGraph } from "./agent-factory";
import { getDb } from "./db/client";
import { agents, workspaceContexts, workspaces } from "./db/schema";
import { env, newId } from "./env";
import { hydrateContextFromStores } from "./connectors";
import { isContextStub, WorkspaceContextFile } from "./runtime/workspace-context";

const worker = (name: string, parentIndex: number) => ({
  name, parentIndex, role: "worker" as const, complexity: "standard" as const,
  instructions: `Complete the work assigned to ${name}.`, tools: ["kb.search"],
});

describe("saving agent builder context", () => {
  const files: string[] = [];
  beforeEach(() => { delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb; });
  afterEach(() => {
    for (const file of files.splice(0)) if (fs.existsSync(file)) fs.unlinkSync(file);
  });

  async function setup() {
    const id = newId("ws_context_test");
    const [workspace] = await getDb().insert(workspaces).values({ id, name: "Context test", slug: id, createdAt: new Date() }).returning();
    const file = new WorkspaceContextFile(env.sandboxRoot, id);
    files.push(file.file);
    file.ensure();
    return { workspace: workspace!, file };
  }

  it("saves chat with the agent, restores it from storage, and supplies it on the first run", async () => {
    const { workspace, file } = await setup();
    file.apply({ op: "include", text: "Use Chicago time" });
    const result = await createAgentGraph({
      workspace, spec, actor: "test", auditAction: "agent.created", contextUpdatedBy: "operator_test",
      builderConversation: [
        { role: "user", content: "Only handle CS courses. Keep completed assignments out of the report." },
        { role: "assistant", content: "The report will list pending CS assignments." },
      ],
    });
    expect(result.ok).toBe(true);
    const saved = file.read();
    expect(saved).toContain("Use Chicago time");
    expect(saved).toContain("Keep completed assignments out of the report.");
    expect(isContextStub(saved)).toBe(true);
    expect(file.promptBlock()).toContain("Keep completed assignments out of the report.");
    expect(file.promptBlock()).toContain("Preserve existing builder context and operator notes");
    const [stored] = await getDb().select().from(workspaceContexts);
    expect(stored).toMatchObject({ content: saved, updatedBy: "operator_test" });
    fs.unlinkSync(file.file);
    expect(await hydrateContextFromStores(workspace.id)).toBe(saved);
    expect(file.read()).toBe(saved);
  });

  it("rejects a context overflow without creating agents or changing existing notes", async () => {
    const { workspace, file } = await setup();
    const original = "x".repeat(256 * 1024 - 2) + "\n";
    file.write(original);
    const result = await createAgentGraph({
      workspace, spec, actor: "test", auditAction: "agent.created",
      builderConversation: [{ role: "user", content: "Keep this setup context." }],
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("256 KB") });
    expect(await getDb().select().from(agents)).toHaveLength(0);
    expect(file.read()).toBe(original);
  });
});
const spec = {
  orchestrator: { name: "Lead", summary: "A nested workflow.", instructions: "Delegate the work to the named child agents.", complexity: "standard" as const },
  workers: [worker("Research", -1), worker("Sources", 0), worker("Verifier", 1), worker("Writer", -1)],
};

describe("saving nested agent trees", () => {
  beforeEach(() => { delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb; });

  async function workspace() {
    return (await getDb().insert(workspaces).values({ id: "ws_tree", name: "Tree test", slug: "tree-test", createdAt: new Date() }).returning())[0]!;
  }

  it("persists each selected parent and gives nested agents the correct rank", async () => {
    const result = await createAgentGraph({ workspace: await workspace(), spec, canSpawnSubagents: false, actor: "test", auditAction: "workflow.created" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = await getDb().select().from(agents);
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get("Research")).toMatchObject({ parentAgentId: result.orchestratorId, rank: "intermediate", canSpawnSubagents: false });
    expect(byName.get("Sources")).toMatchObject({ parentAgentId: byName.get("Research")!.id, rank: "intermediate_2", canSpawnSubagents: false });
    expect(byName.get("Verifier")).toMatchObject({ parentAgentId: byName.get("Sources")!.id, rank: "grunt", canSpawnSubagents: false });
    expect(byName.get("Writer")?.parentAgentId).toBe(result.orchestratorId);
    expect(result.agentIds).toEqual([result.orchestratorId, ...spec.workers.map((item) => byName.get(item.name)!.id)]);
  });

  it("rejects invalid topology before writing any agent", async () => {
    const result = await createAgentGraph({ workspace: await workspace(), spec: { ...spec, workers: [worker("Loop", 0)] }, actor: "test", auditAction: "workflow.created" });
    expect(result.ok).toBe(false);
    expect(await getDb().select().from(agents)).toHaveLength(0);
  });
});
