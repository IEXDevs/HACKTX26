import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createAgentGraph } from "./agent-factory";
import { getDb } from "./db/client";
import { agents, workspaces } from "./db/schema";
import { saveLibraryWorkflow } from "./workflow-library";
import { WorkflowSelectionSchema, selectionGraph } from "./workflow-selection";

describe("workflows from existing agents", () => {
  beforeEach(() => { delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb; });

  async function fixture() {
    const workspace = (await getDb().insert(workspaces).values({ id: "ws_library", name: "Library", slug: "library", createdAt: new Date() }).returning())[0]!;
    await createAgentGraph({ workspace, actor: "test", auditAction: "agent.created", spec: {
      orchestrator: { name: "Research lead", summary: "Research existing documents.", instructions: "Read the available documents and summarize the findings.", complexity: "standard" },
      workers: [{ name: "Reader", role: "worker", instructions: "Read the source documents.", complexity: "trivial", tools: ["kb.search", "fs.read"] }],
    } });
    const library = await getDb().select().from(agents);
    return { workspace, library };
  }

  it("saves the chosen hierarchy without changing library agents or their settings", async () => {
    const { workspace, library } = await fixture();
    const lead = library.find((agent) => agent.name === "Research lead")!;
    const reader = library.find((agent) => agent.name === "Reader")!;
    const result = await saveLibraryWorkflow(workspace, {
      name: "Onboarding review", mode: "manual", goal: "Review the onboarding source documents.", nodes: [
        { id: "lead", parentId: null, agentId: lead.id },
        { id: "child", parentId: "lead", agentId: reader.id },
        { id: "nested", parentId: "child", agentId: reader.id },
      ],
    }, "test");
    const rows = await getDb().select().from(agents);
    expect(rows.filter((agent) => !agent.sourceAgentId)).toEqual(library);
    const root = rows.find((agent) => agent.id === result.workflowId)!;
    expect(root).toMatchObject({ name: "Onboarding review", sourceAgentId: lead.id, defaultGoal: "Review the onboarding source documents.", status: "active", canSpawnSubagents: false, modelPolicy: lead.modelPolicy, grants: lead.grants });
    const childId = result.nodes.find((node) => node.id === "child")!.agentId;
    const nestedId = result.nodes.find((node) => node.id === "nested")!.agentId;
    expect(rows.find((agent) => agent.id === childId)).toMatchObject({ sourceAgentId: reader.id, parentAgentId: root.id, allowedTools: reader.allowedTools, modelPolicy: reader.modelPolicy });
    expect(rows.find((agent) => agent.id === nestedId)).toMatchObject({ sourceAgentId: reader.id, parentAgentId: childId, rank: "intermediate_2" });
  });

  it("rejects unavailable source agents before writing a workflow", async () => {
    const { workspace, library } = await fixture();
    await getDb().update(agents).set({ status: "archived" }).where(eq(agents.id, library[0]!.id));
    await expect(saveLibraryWorkflow(workspace, { name: "Invalid", mode: "manual", nodes: [{ id: "lead", parentId: null, agentId: library[0]!.id }] }, "test")).rejects.toThrow("no longer available");
    expect(await getDb().select().from(agents)).toHaveLength(library.length);
  });

  it("shows an empty selection as a placeholder and rejects saving it", () => {
    const node = { id: "lead", parentId: null, agentId: null };
    expect(selectionGraph([node], [])[0]).toMatchObject({ id: "lead", placeholder: true, name: "Choose agent" });
    expect(WorkflowSelectionSchema.safeParse({ name: "Empty", mode: "manual", nodes: [node] }).success).toBe(false);
  });

  it("rejects cycles and missing parents in selected graphs", () => {
    for (const parentId of ["child", "missing"]) expect(WorkflowSelectionSchema.safeParse({
      name: "Invalid", mode: "manual", nodes: [{ id: "lead", parentId: null, agentId: "agent-1" }, { id: "child", parentId, agentId: "agent-2" }],
    }).success).toBe(false);
  });
});
