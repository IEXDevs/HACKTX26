import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentGraph } from "../agent-factory";
import { getDb } from "../db/client";
import { agents, runEvents, runs, workspaces } from "../db/schema";
import { newId } from "../env";
import { workflowGraph } from "../graph-data";
import { ScriptedGateway } from "./gateway-scripted";
import * as motivator from "./motivator";
import { cancelRun, executeRun } from "./orchestrator";
import { answerInput, listPendingInputs } from "./run-input";
import type { ModelChunk, ModelRequest } from "./types";

const final = "## Outcome\nThe requested notes were read.\n\n## Findings\nThe workspace has setup notes.\n\n## Verification\nRead CONTEXT.md.";
const complete: motivator.MotivatorDecision = { verdict: "complete", reason: "The requested result is supported by the file read.", nextSteps: [] };
const keepGoing: motivator.MotivatorDecision = { verdict: "continue", reason: "The available workspace notes have not been checked.", nextSteps: ["Read CONTEXT.md with context.read, then summarize the observed findings."] };
const say = (text: string): ModelChunk => ({ type: "text", text });
const read: ModelChunk = { type: "tool_call", call: { id: "read_notes", name: "context.read", args: {} } };
const report: ModelChunk = { type: "tool_call", call: { id: "stuck_report", name: "motivator.report", args: {
  blocker: "The notes do not identify which course the user means.",
  attempts: ["Read the workspace notes.", "Checked the saved course names."],
  evidence: "Two courses have the same short name.", remainingOptions: ["Check the full course names before asking the user."],
} } };

describe("orchestrator and motivator", () => {
  let turns: ModelChunk[][] = [], verdicts: motivator.MotivatorDecision[] = [];
  const requests: ModelRequest[] = [], reviews: motivator.MotivatorReviewInput[] = [];
  beforeEach(() => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    turns = []; verdicts = []; requests.length = 0; reviews.length = 0;
    vi.spyOn(ScriptedGateway.prototype, "complete").mockImplementation(async function* (request) {
      requests.push(structuredClone(request));
      for (const chunk of turns.shift() ?? []) yield chunk;
      yield { type: "usage", inputTokens: 10, outputTokens: 10 };
      yield { type: "done", stopReason: "end" };
    });
    vi.spyOn(motivator, "reviewWithMotivator").mockImplementation(async (input) => {
      reviews.push(structuredClone(input));
      const decision = verdicts.shift() ?? complete;
      return { decision, inputTokens: 7, outputTokens: 5, messages: motivator.motivatorMessages(input), completion: JSON.stringify(decision) };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  async function fixture(maxSteps = 6) {
    const workspaceId = newId("ws_dual_test");
    const [workspace] = await getDb().insert(workspaces).values({ id: workspaceId, slug: workspaceId, name: "Dual head test", createdAt: new Date() }).returning();
    const created = await createAgentGraph({ workspace: workspace!, actor: "test", auditAction: "agent.created", canSpawnSubagents: false, spec: {
      orchestrator: { name: "Notes lead", summary: "Reads workspace notes.", instructions: "Read the workspace notes and summarize the findings.", complexity: "standard" }, workers: [],
    } });
    if (!created.ok) throw new Error(created.error);
    await getDb().update(agents).set({ status: "active", maxSteps }).where(eq(agents.id, created.orchestratorId));
    const runId = newId("run_dual_test");
    await getDb().insert(runs).values({ id: runId, workspaceId, agentId: created.orchestratorId, goal: "Read the workspace notes and summarize the findings.", mode: "scripted", budgetUsd: 1, startedAt: new Date() });
    return { runId, workspaceId, rootId: created.orchestratorId };
  }
  async function run(id: string) { return (await getDb().select().from(runs).where(eq(runs.id, id)))[0]!; }
  async function events(id: string) { return (await getDb().select().from(runEvents).where(eq(runEvents.runId, id))).map((row) => row.payload); }

  it("starts both peers before work and shows them in the same graph without a library copy", async () => {
    turns = [[read], [say(final)]];
    const { runId, workspaceId, rootId } = await fixture();
    await executeRun(runId);
    const all = await events(runId);
    const spawned = all.filter((event) => event.type === "agent.spawned");
    expect(spawned).toHaveLength(2);
    expect(spawned[0]).toMatchObject({ agentId: rootId, role: "orchestrator" });
    expect(spawned[1]).toMatchObject({ name: "Motivator", purpose: "motivator", parentAgentId: null });
    expect(all.indexOf(spawned[1]!)).toBeLessThan(all.findIndex((event) => event.type === "tool.requested"));
    const graph = await workflowGraph(workspaceId, rootId);
    expect(graph?.agents.find((agent) => agent.kind === "motivator")).toMatchObject({ name: "Motivator", parentAgentId: null, tools: [], trailHref: `/runs/${runId}` });
    expect(await getDb().select().from(agents)).toHaveLength(1);
    expect(await run(runId)).toMatchObject({ status: "succeeded", summary: final, inputTokens: 27 });
  });

  it("prods an early surrender into useful work, then accepts a verified Markdown report", async () => {
    turns = [[say("## Outcome\nI found no information and will stop.")], [read], [say(final)]];
    verdicts = [keepGoing, complete];
    const { runId } = await fixture();
    await executeRun(runId);
    expect(requests).toHaveLength(3);
    expect(requests[1]!.messages).toContainEqual(expect.objectContaining({ role: "system", content: expect.stringContaining("Read CONTEXT.md with context.read") }));
    expect(reviews).toHaveLength(2);
    expect(reviews[1]!.priorReviews).toEqual([keepGoing]);
    expect(reviews[1]!.messages.some((message) => message.role === "tool" && message.toolName === "context.read")).toBe(true);
    expect(await run(runId)).toMatchObject({ status: "succeeded", summary: final, inputTokens: 44 });
  });

  it("checks an early request for user input before pausing", async () => {
    turns = [[{ type: "tool_call", call: { id: "premature_ask", name: "user.ask", args: { question: "What do the workspace notes say?", reason: "I have not read the notes." } } }], [read], [say(final)]];
    verdicts = [keepGoing, complete];
    const { runId, workspaceId } = await fixture();
    await executeRun(runId);
    expect(reviews[0]!.proposal).toBe("ask_user");
    expect(await listPendingInputs(workspaceId)).toHaveLength(0);
    expect(requests[1]!.messages.some((message) => message.role === "tool" && message.content.includes("motivator"))).toBe(true);
    expect((await run(runId)).status).toBe("succeeded");
  });

  it("activates the motivator on a structured blocker report and sends the orchestrator back to work", async () => {
    turns = [[report], [read], [say(final)]];
    verdicts = [keepGoing, complete];
    const { runId } = await fixture();
    await executeRun(runId);
    expect(requests[0]!.tools.find((tool) => tool.name === "motivator.report")?.parameters).toMatchObject({ required: ["blocker", "attempts"] });
    expect(reviews[0]).toMatchObject({ proposal: "stuck" });
    expect(JSON.parse(reviews[0]!.candidate)).toMatchObject({ attempts: ["Read the workspace notes.", "Checked the saved course names."], evidence: "Two courses have the same short name." });
    expect(requests[1]!.messages).toContainEqual(expect.objectContaining({ role: "tool", toolName: "motivator.report", content: expect.stringContaining("Read CONTEXT.md with context.read") }));
    const all = await events(runId);
    const handoff = all.findIndex((event) => event.type === "handoff" && event.summary.startsWith("Orchestrator is stuck"));
    expect(handoff).toBeGreaterThan(-1);
    expect(all[handoff + 1]).toMatchObject({ type: "agent.status", agentId: `mot_${runId}`, status: "thinking" });
    expect(await run(runId)).toMatchObject({ status: "succeeded", summary: final });
  });

  it("pauses from the blocker report and resumes that same tool call after the user answers", async () => {
    turns = [[read], [report], [say(final)]];
    verdicts = [{ verdict: "ask_user", reason: "The full names and saved notes still leave two matches. Only the user can select the course.", question: "Which course should I include?", nextSteps: [] }, complete];
    const { runId, workspaceId } = await fixture();
    await executeRun(runId);
    const [question] = await listPendingInputs(workspaceId);
    expect(question).toMatchObject({ callId: "stuck_report", question: "Which course should I include?" });
    expect((await run(runId)).status).toBe("awaiting_input");
    expect(reviews).toHaveLength(1);
    answerInput(question!.id, workspaceId, "CS 314", "operator");
    await executeRun(runId);
    expect(requests[2]!.messages).toContainEqual(expect.objectContaining({ role: "tool", toolName: "motivator.report", toolCallId: "stuck_report", content: expect.stringContaining("Operator reply: CS 314") }));
    expect(reviews.map((review) => review.proposal)).toEqual(["stuck", "finish"]);
    expect(reviews[1]!.priorReviews[0]!.verdict).toBe("ask_user");
    const all = await events(runId);
    expect(all.filter((event) => event.type === "agent.spawned" && event.purpose === "motivator")).toHaveLength(1);
    expect(all.filter((event) => event.type === "tool.completed" && event.callId === "read_notes")).toHaveLength(1);
    expect(await listPendingInputs(workspaceId)).toHaveLength(0);
    expect(await run(runId)).toMatchObject({ status: "succeeded", summary: final });
  });

  it("rejects a blocker report with no concrete attempt before activating the motivator", async () => {
    turns = [[{ type: "tool_call", call: { id: "empty_report", name: "motivator.report", args: { blocker: "I am stuck.", attempts: [] } } }], [read], [say(final)]];
    const { runId } = await fixture();
    await executeRun(runId);
    expect(requests[1]!.messages).toContainEqual(expect.objectContaining({ role: "tool", toolName: "motivator.report", content: expect.stringContaining("at least one concrete attempt") }));
    expect(reviews.map((review) => review.proposal)).toEqual(["finish"]);
    expect((await run(runId)).status).toBe("succeeded");
  });

  it("pauses on Home when the motivator confirms that only the user can unblock the goal", async () => {
    turns = [[say("## Outcome\nTwo courses match the requested name.")], [say(final)]];
    verdicts = [{ verdict: "ask_user", reason: "The available notes do not resolve the ambiguous course selection.", question: "Which course should I include?", nextSteps: [] }, complete];
    const { runId, workspaceId } = await fixture();
    await executeRun(runId);
    expect((await run(runId)).status).toBe("awaiting_input");
    const [question] = await listPendingInputs(workspaceId);
    expect(question?.question).toBe("Which course should I include?");
    answerInput(question!.id, workspaceId, "CS 314", "operator");
    await executeRun(runId);
    expect(await run(runId)).toMatchObject({ status: "succeeded", summary: final });
    expect(reviews).toHaveLength(2);
    expect(reviews[1]!.priorReviews).toHaveLength(1);
    expect((await events(runId)).filter((event) => event.type === "agent.spawned" && event.purpose === "motivator")).toHaveLength(1);
  });

  it("ends honestly when no useful path remains", async () => {
    turns = [[say("## Outcome\nThe source is no longer available.")]];
    verdicts = [{ verdict: "blocked", reason: "The only permitted source is permanently removed, and the user has no substitute.", nextSteps: [] }];
    const { runId } = await fixture();
    await executeRun(runId);
    expect(await run(runId)).toMatchObject({ status: "failed", summary: expect.stringContaining("permanently removed") });
    expect(requests).toHaveLength(1);
  });

  it("cannot extend the hard step limit or invent success when the orchestrator ignores feedback", async () => {
    turns = [[say("I will stop.")], [say("I will stop.")], [say("I will stop.")]];
    verdicts = [keepGoing, keepGoing, keepGoing];
    const { runId } = await fixture(3);
    await executeRun(runId);
    expect(requests).toHaveLength(3);
    expect(reviews).toHaveLength(3);
    expect(await run(runId)).toMatchObject({ status: "failed", summary: expect.stringContaining("step limit") });
  });

  it("never prods past an explicit user stop", async () => {
    const { runId } = await fixture();
    vi.mocked(ScriptedGateway.prototype.complete).mockImplementationOnce(async function* () {
      await cancelRun(runId);
      yield say("Stopping as requested.");
      yield { type: "usage", inputTokens: 10, outputTokens: 10 };
    });
    await executeRun(runId);
    expect(motivator.reviewWithMotivator).not.toHaveBeenCalled();
    expect((await run(runId)).status).toBe("cancelled");
  });
});
