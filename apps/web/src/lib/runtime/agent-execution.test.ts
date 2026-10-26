import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentGraph } from "../agent-factory";
import { getDb } from "../db/client";
import { agents, runEvents, runs, workspaces } from "../db/schema";
import { newId } from "../env";
import { AGENT_EXECUTION_GUIDANCE, EMPTY_RESPONSE_GUIDANCE, LAST_TURN_GUIDANCE, REPORT_RETRY_GUIDANCE } from "./execution-guidance";
import { ScriptedGateway } from "./gateway-scripted";
import { executeRun } from "./orchestrator";
import type { ModelChunk, ModelRequest } from "./types";

const report = "# Findings\n\n## Outcome\nRead the workspace notes.\n\n## Findings\nThe workspace has unfinished setup sections.\n\n## Verification\nRead CONTEXT.md with context.read.";
const readContext: ModelChunk = { type: "tool_call", call: { id: "read_context", name: "context.read", args: {} } };

describe("persistent agent execution", () => {
  const requests: ModelRequest[] = [];
  let turns: ModelChunk[][] = [];
  beforeEach(() => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    requests.length = 0;
    turns = [];
    vi.spyOn(ScriptedGateway.prototype, "complete").mockImplementation(async function* (request) {
      requests.push(structuredClone(request));
      for (const chunk of turns.shift() ?? []) yield chunk;
      yield { type: "usage", inputTokens: 10, outputTokens: 10 };
      yield { type: "done", stopReason: "end" };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  async function run(maxSteps = 6) {
    const db = await getDb();
    const workspaceId = newId("ws_execution_test");
    const [workspace] = await db.insert(workspaces).values({ id: workspaceId, name: "Execution test", slug: workspaceId, createdAt: new Date() }).returning();
    const created = await createAgentGraph({ workspace: workspace!, actor: "test", auditAction: "agent.created", canSpawnSubagents: false, spec: {
      orchestrator: { name: "Existing agent", summary: "Reads notes.", instructions: "Read the workspace notes and report your findings.", complexity: "standard" }, workers: [],
    } });
    if (!created.ok) throw new Error(created.error);
    await db.update(agents).set({ status: "active", maxSteps }).where(eq(agents.id, created.orchestratorId));
    const id = newId("run_execution_test");
    await db.insert(runs).values({ id, workspaceId, agentId: created.orchestratorId, goal: "Read the workspace notes and summarize the findings.", mode: "scripted", budgetUsd: 1, startedAt: new Date() });
    await executeRun(id);
    return (await db.select().from(runs).where(eq(runs.id, id)))[0]!;
  }

  it("gives saved agents persistence rules, continues after a tool error, and keeps the Markdown report", async () => {
    turns = [
      [{ type: "tool_call", call: { id: "bad_read", name: "fs.read", args: {} } }],
      [readContext], [{ type: "text", text: report }],
    ];
    const result = await run();
    expect(requests[0]!.messages[0]!.content).toContain(AGENT_EXECUTION_GUIDANCE);
    expect(requests[1]!.messages).toContainEqual(expect.objectContaining({ role: "tool", content: "ERROR: fs.read requires a path." }));
    expect(requests[2]!.messages).toContainEqual(expect.objectContaining({ role: "tool", toolName: "context.read", content: expect.stringContaining("# Workspace context") }));
    expect(result).toMatchObject({ status: "succeeded", summary: report });
  });

  it("recovers once from an empty model response with more output room", async () => {
    turns = [[], [readContext], [{ type: "text", text: report }]];
    expect(await run()).toMatchObject({ status: "succeeded", summary: report });
    expect(requests[1]!.messages).toContainEqual({ role: "system", content: EMPTY_RESPONSE_GUIDANCE });
    expect(requests[1]!.maxOutputTokens).toBeGreaterThan(requests[0]!.maxOutputTokens!);
  });

  it("fails honestly after repeated empty responses instead of claiming completion", async () => {
    const result = await run();
    expect(requests).toHaveLength(2);
    expect(result.status).toBe("failed");
    expect(result.summary).toContain("# Findings");
    expect(result.summary).toContain("Completion is unverified");
  });

  it("reserves the last step for a report within the existing step limit", async () => {
    turns = [[readContext], [{ type: "text", text: report }]];
    expect(await run(2)).toMatchObject({ status: "succeeded", summary: report });
    expect(requests).toHaveLength(2);
    expect(requests[0]!.tools.length).toBeGreaterThan(0);
    expect(requests[1]!.tools).toEqual([]);
    expect(requests[1]!.messages).toContainEqual({ role: "system", content: LAST_TURN_GUIDANCE });
  });

  it("rewrites a report cut off by the provider and saves the complete replacement", async () => {
    turns = [
      [{ type: "text", text: "## Outcome\nThe assignment findings are incom" }, { type: "done", stopReason: "length" }],
      [{ type: "text", text: report }],
    ];
    expect(await run()).toMatchObject({ status: "succeeded", summary: report });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.tools).toEqual([]);
    expect(requests[1]!.messages).toContainEqual({ role: "system", content: REPORT_RETRY_GUIDANCE });
  });

  it("labels a report as incomplete if its final allowed turn is cut off", async () => {
    turns = [[{ type: "text", text: "## Findings\nPartial results" }, { type: "done", stopReason: "length" }]];
    const result = await run(1);
    expect(requests).toHaveLength(1);
    expect(result.status).toBe("failed");
    expect(result.summary).toContain("## Findings\nPartial results");
    expect(result.summary).toContain("**Incomplete report:**");
  });

  it("does not execute more tools or claim success when the model ignores the final-report turn", async () => {
    turns = [[readContext], [{ type: "tool_call", call: { id: "extra_write", name: "fs.write", args: { path: "extra.md", content: "Should not be written." } } }]];
    const result = await run(2);
    expect(result.status).toBe("failed");
    expect(result.summary).toContain("step limit");
    const events = await (await getDb()).select().from(runEvents).where(eq(runEvents.runId, result.id));
    expect(events.filter((event) => event.type === "file.changed").some((event) => JSON.stringify(event.payload).includes("extra.md"))).toBe(false);
  });
});
