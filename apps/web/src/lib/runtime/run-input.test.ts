import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentGraph } from "../agent-factory";
import { getDb } from "../db/client";
import { agents, runCheckpoints, runEvents, runs, workspaces } from "../db/schema";
import { env, newId } from "../env";
import * as connectors from "../connectors";
import * as githubSync from "../github-sync";
import { homeView } from "../views";
import { ScriptedGateway } from "./gateway-scripted";
import { cancelRun, executeRun } from "./orchestrator";
import { answerInput, listPendingInputs } from "./run-input";
import { reapStaleRuns, STALE_AFTER_MS } from "./reaper";
import { AgentSandbox } from "./sandbox";
import type { ModelChunk, ModelRequest } from "./types";

const question: ModelChunk = { type: "tool_call", call: { id: "ask_course", name: "user.ask", args: { question: "Which course should I include?", reason: "Two courses match the requested name. I checked the available notes." } } };
const final = "## Outcome\nCompleted the report for CS 314.\n\n## Findings\nIncluded the selected course.\n\n## Verification\nUsed the operator's course selection.";
const text = (content: string): ModelChunk => ({ type: "text", text: content });

describe("pausing for user input", () => {
  let turns: ModelChunk[][] = [];
  const requests: ModelRequest[] = [];
  beforeEach(() => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    requests.length = 0; turns = [];
    vi.spyOn(ScriptedGateway.prototype, "complete").mockImplementation(async function* (request) {
      requests.push(structuredClone(request));
      for (const chunk of turns.shift() ?? []) yield chunk;
      yield { type: "usage", inputTokens: 100, outputTokens: 100 };
      yield { type: "done", stopReason: "end" };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  async function fixture() {
    const db = getDb();
    const id = newId("ws_input_test");
    const [workspace] = await db.insert(workspaces).values({ id, slug: id, name: "Input test", createdAt: new Date() }).returning();
    const created = await createAgentGraph({ workspace: workspace!, actor: "test", auditAction: "agent.created", spec: {
      orchestrator: { name: "Course lead", summary: "Builds a course report.", instructions: "Find the requested course, check the assignments, and report the findings.", complexity: "standard" },
      workers: [{ name: "Reader", role: "worker", instructions: "Read the course notes and report the findings.", complexity: "standard", tools: ["context.read"] }],
    } });
    if (!created.ok) throw new Error(created.error);
    await db.update(agents).set({ status: "active" });
    await db.update(agents).set({ rank: "grunt" }).where(eq(agents.name, "Reader"));
    const runId = newId("run_input_test");
    await db.insert(runs).values({ id: runId, workspaceId: id, agentId: created.orchestratorId, goal: "Prepare the requested course assignment report.", mode: "scripted", budgetUsd: 1, startedAt: new Date() });
    return { runId, workspaceId: id };
  }
  async function row(id: string) { return (await getDb().select().from(runs).where(eq(runs.id, id)))[0]!; }
  async function events(id: string) { return (await getDb().select().from(runEvents).where(eq(runEvents.runId, id))).map((event) => event.payload); }

  it("pauses without finishing, shows the full question on Home, then resumes without repeating earlier calls", async () => {
    turns = [[
      { type: "tool_call", call: { id: "read_before", name: "context.read", args: {} } }, question,
      { type: "tool_call", call: { id: "read_after", name: "context.read", args: {} } },
    ], [text(final)]];
    const { runId, workspaceId } = await fixture();
    await executeRun(runId);
    const paused = await row(runId);
    expect(paused).toMatchObject({ status: "awaiting_input", endedAt: null, summary: null });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.messages[0]!.content).toContain("Lead-agent responsibilities");
    expect(requests[0]!.tools.some((tool) => tool.name === "user.ask")).toBe(true);
    expect((await events(runId)).some((event) => event.type === "run.completed")).toBe(false);
    const [pending] = await listPendingInputs(workspaceId);
    expect((await homeView(workspaceId)).needs).toContainEqual(expect.objectContaining({ id: pending!.id, kind: "input", ask: "Which course should I include?" }));
    const tooLate = Date.now() + STALE_AFTER_MS * 3;
    expect(await reapStaleRuns(tooLate)).not.toContain(runId);
    expect(answerInput(pending!.id, workspaceId, "CS 314", "operator")).toMatchObject({ ok: true, runId });
    await executeRun(runId); // New engine instance loads only the persisted continuation.
    const completed = await row(runId);
    expect(completed).toMatchObject({ status: "succeeded", summary: final });
    expect(completed.costUsd).toBeGreaterThan(paused.costUsd);
    expect(completed.inputTokens).toBe(200);
    expect(requests[1]!.messages).toContainEqual(expect.objectContaining({ role: "tool", toolName: "user.ask", content: expect.stringContaining("CS 314") }));
    const all = await events(runId);
    expect(all.filter((event) => event.type === "tool.completed" && event.callId === "read_before")).toHaveLength(1);
    expect(all.filter((event) => event.type === "tool.completed" && event.callId === "read_after")).toHaveLength(1);
    expect(all.filter((event) => event.type === "run.started")).toHaveLength(1);
    expect(await listPendingInputs(workspaceId)).toHaveLength(0);
    expect(await getDb().select().from(runCheckpoints)).toHaveLength(0);
  });

  it("resumes a paused worker and returns its result to its lead without recreating the task", async () => {
    turns = [
      [{ type: "tool_call", call: { id: "delegate_reader", name: "agent.delegate", args: { agent: "Reader", task: "Read the course notes and check the selected course.", title: "Read course notes" } } }],
      [question], [text(final)], [text(final)],
    ];
    const { runId, workspaceId } = await fixture();
    await executeRun(runId);
    expect((await row(runId)).status).toBe("awaiting_input");
    const [pending] = await listPendingInputs(workspaceId);
    expect(pending!.agentId).not.toBe((await row(runId)).agentId);
    answerInput(pending!.id, workspaceId, "CS 314", "operator");
    await executeRun(runId);
    expect(await row(runId)).toMatchObject({ status: "succeeded", summary: final, inputTokens: 400 });
    expect((await events(runId)).filter((event) => event.type === "task.created")).toHaveLength(1);
    expect(requests[2]!.messages[0]!.content).not.toContain("Lead-agent responsibilities");
    expect(requests[3]!.messages).toContainEqual(expect.objectContaining({ role: "tool", toolName: "agent.delegate", content: expect.stringContaining("CS 314") }));
  });

  it("rejects blank, cross-workspace, and duplicate answers without granting access", async () => {
    turns = [[question]];
    const { runId, workspaceId } = await fixture();
    await executeRun(runId);
    const [pending] = await listPendingInputs(workspaceId);
    expect(answerInput(pending!.id, workspaceId, " ", "operator")).toMatchObject({ ok: false, status: 400 });
    expect(answerInput(pending!.id, "other_workspace", "CS 314", "operator")).toMatchObject({ ok: false, status: 404 });
    const before = (await getDb().select().from(agents)).map((agent) => agent.grants);
    expect(answerInput(pending!.id, workspaceId, "CS 314", "operator").ok).toBe(true);
    expect(answerInput(pending!.id, workspaceId, "CS 311", "operator")).toMatchObject({ ok: false, status: 409 });
    expect((await getDb().select().from(agents)).map((agent) => agent.grants)).toEqual(before);
  });

  it("can cancel a paused run and removes its pending question", async () => {
    turns = [[question]];
    const { runId, workspaceId } = await fixture();
    await executeRun(runId);
    const [pending] = await listPendingInputs(workspaceId);
    await cancelRun(runId);
    expect(await row(runId)).toMatchObject({ status: "cancelled", endedAt: expect.any(Date) });
    expect(await listPendingInputs(workspaceId)).toHaveLength(0);
    expect(answerInput(pending!.id, workspaceId, "CS 314", "operator")).toMatchObject({ ok: false, status: 409 });
    await executeRun(runId);
    expect(requests).toHaveLength(1);
  });

  it("keeps the original budget on resume", async () => {
    turns = [[question], [text(final)]];
    const { runId, workspaceId } = await fixture();
    await executeRun(runId);
    const paused = await row(runId);
    const [pending] = await listPendingInputs(workspaceId);
    answerInput(pending!.id, workspaceId, "CS 314", "operator");
    await getDb().update(runs).set({ budgetUsd: paused.costUsd }).where(eq(runs.id, runId));
    await executeRun(runId);
    expect(requests).toHaveLength(1);
    expect((await row(runId)).status).toBe("halted");
  });

  it("keeps in-progress GitHub files when resuming a run after user input", async () => {
    vi.spyOn(connectors, "connectedToolkitsFor").mockResolvedValue([]);
    vi.spyOn(connectors, "refreshContextCatalog").mockResolvedValue("");
    const sync = vi.spyOn(githubSync, "ensureGithubCheckout").mockImplementation(async ({ sandbox }) => {
      sandbox.write("repo/work.md", "Remote checkout content.");
      return { synced: true, skipped: false, files: 1, repo: "example/repo", branch: "main" };
    });
    turns = [[question], [{ type: "tool_call", call: { id: "read_work", name: "fs.read", args: { path: "repo/work.md" } } }], [text(final)]];
    const { runId, workspaceId } = await fixture();
    await getDb().update(runs).set({ operatorUserId: "test-operator" }).where(eq(runs.id, runId));
    await executeRun(runId);
    const root = await row(runId);
    const sandbox = new AgentSandbox(env.sandboxRoot, workspaceId, root.agentId);
    sandbox.write("repo/work.md", "In-progress local findings.");
    const [pending] = await listPendingInputs(workspaceId);
    answerInput(pending!.id, workspaceId, "CS 314", "operator");
    await executeRun(runId);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sandbox.read("repo/work.md")).toBe("In-progress local findings.");
    expect(requests[2]!.messages).toContainEqual(expect.objectContaining({ role: "tool", toolName: "fs.read", content: "In-progress local findings." }));
    expect((await row(runId)).status).toBe("succeeded");
  });

  it("gives a lead the useful findings from a failed delegate so it can solve the gap", async () => {
    turns = [
      [{ type: "tool_call", call: { id: "failed_reader", name: "agent.delegate", args: { agent: "Reader", task: "Read the course notes and verify the course.", title: "Read course notes" } } }],
      [text("## Findings\nCS 314 was found; the due-date check was cut off"), { type: "done", stopReason: "length" }],
      [text(final)],
    ];
    const { runId } = await fixture();
    await getDb().update(agents).set({ maxSteps: 1 }).where(eq(agents.name, "Reader"));
    await executeRun(runId);
    const returned = requests[2]!.messages.find((message) => message.role === "tool" && message.toolName === "agent.delegate");
    expect(returned?.content).toContain("ERROR: Reader did not complete");
    expect(returned?.content).toContain("CS 314 was found");
    expect(returned?.content).toContain("Incomplete report");
  });

  it("keeps completed lead work when a follow-up review pauses for input", async () => {
    turns = [[text(final)], [question], [text(final)]];
    const { runId, workspaceId } = await fixture();
    await getDb().update(runs).set({ goal: "Prepare the course report and a security review." }).where(eq(runs.id, runId));
    await executeRun(runId);
    expect((await row(runId)).status).toBe("awaiting_input");
    const [pending] = await listPendingInputs(workspaceId);
    answerInput(pending!.id, workspaceId, "CS 314", "operator");
    await executeRun(runId);
    expect(await row(runId)).toMatchObject({ status: "succeeded", summary: final });
    expect(requests).toHaveLength(3);
    expect((await events(runId)).filter((event) => event.type === "task.created")).toHaveLength(1);
  });
});
