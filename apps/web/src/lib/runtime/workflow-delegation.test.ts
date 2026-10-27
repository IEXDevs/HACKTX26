import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentGraph } from "../agent-factory";
import { getDb } from "../db/client";
import { agents, runEvents, runs, workspaces } from "../db/schema";
import { saveLibraryWorkflow } from "../workflow-library";
import { executeRun } from "./orchestrator";
import { ScriptedGateway } from "./gateway-scripted";

describe("delegation in a selected static workflow", () => {
  let target = "", turn = 0;
  let selected: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    turn = 0;
    vi.spyOn(ScriptedGateway.prototype, "complete").mockImplementation(async function* () {
      if (turn++ === 0) yield { type: "tool_call", call: { id: "call_selected", name: "agent.delegate", args: { agent: target, title: "Read docs", task: "Read the source documents and report." } } };
      else yield { type: "text", text: "The source documents are summarized." };
      yield { type: "usage", inputTokens: 10, outputTokens: 10 };
      yield { type: "done", stopReason: "end" };
    });
    // Cold PGlite startup and migrations belong to the setup hook's timeout.
    selected = await fixture();
  });
  afterEach(() => vi.restoreAllMocks());

  async function fixture() {
    const db = await getDb();
    const workspace = (await db.insert(workspaces).values({ id: "ws_selected", name: "Selected", slug: "selected", createdAt: new Date() }).returning())[0]!;
    await createAgentGraph({ workspace, actor: "test", auditAction: "agent.created", spec: {
      orchestrator: { name: "Lead", summary: "Summarizes documents.", instructions: "Delegate document reading to the Reader and summarize its report.", complexity: "standard" },
      workers: ["Reader", "Outside"].map((name) => ({ name, role: "worker" as const, instructions: "Read and summarize the available documents.", complexity: "standard" as const, tools: ["kb.search"] })),
    } });
    await db.update(agents).set({ status: "active" });
    const library = await db.select().from(agents);
    const lead = library.find((agent) => agent.name === "Lead")!;
    const reader = library.find((agent) => agent.name === "Reader")!;
    const workflow = await saveLibraryWorkflow(workspace, { name: "Selected docs", mode: "manual", nodes: [
      { id: "lead", parentId: null, agentId: lead.id }, { id: "reader", parentId: "lead", agentId: reader.id },
    ] }, "test");
    await db.insert(runs).values({ id: "run_selected", workspaceId: workspace.id, agentId: workflow.workflowId, goal: "Summarize the source documents.", mode: "scripted", budgetUsd: 1, startedAt: new Date() });
    return { workflow, reader };
  }

  it("runs the connected instance of an existing agent", async () => {
    target = "Reader";
    const { workflow, reader } = selected;
    await executeRun("run_selected");
    const spawned = (await (await getDb()).select().from(runEvents)).filter((event) => event.type === "agent.spawned").map((event) => event.agentId);
    expect(spawned).toContain(workflow.nodes.find((node) => node.id === "reader")!.agentId);
    expect(spawned).not.toContain(reader.id);
  });

  it("rejects delegating outside the selected static tree", async () => {
    target = "Outside";
    await executeRun("run_selected");
    expect(JSON.stringify(await (await getDb()).select().from(runEvents))).toContain("connected below it in this workflow");
  });
});
