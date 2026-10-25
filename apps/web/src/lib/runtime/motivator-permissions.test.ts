import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentGraph } from "../agent-factory";
import { getDb } from "../db/client";
import { agents, approvals, auditLog, runEvents, runs, workspaces } from "../db/schema";
import { newId } from "../env";
import * as broker from "./approvals";
import { ScriptedGateway } from "./gateway-scripted";
import * as motivator from "./motivator";
import { cancelRun, executeRun } from "./orchestrator";
import * as tools from "./tools";
import type { ModelChunk } from "./types";

const report: ModelChunk = { type: "text", text: "## Outcome\nThe permitted checks have finished.\n## Findings\nSee the tool results.\n## Verification\nThe permission decision was recorded." };
const shell = (id = "shell_one", command = "check workspace") : ModelChunk => ({ type: "tool_call", call: { id, name: "shell.exec", args: { command } } });

describe("motivator permission decisions", () => {
  let turns: ModelChunk[][];
  let decision: motivator.MotivatorDecision;
  let duringReview: (() => Promise<void>) | undefined;
  let humanDecision: "approved" | "denied";
  const reviews: motivator.MotivatorReviewInput[] = [];
  beforeEach(() => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    turns = [[shell()], [report]]; reviews.length = 0; duringReview = undefined; humanDecision = "approved";
    decision = { verdict: "approve", reason: "The exact check is required by the user's goal and its scope is clear.", nextSteps: [] };
    vi.spyOn(ScriptedGateway.prototype, "complete").mockImplementation(async function* () {
      for (const chunk of turns.shift() ?? []) yield chunk;
      yield { type: "usage", inputTokens: 10, outputTokens: 10 };
    });
    vi.spyOn(motivator, "reviewWithMotivator").mockImplementation(async (input) => {
      reviews.push(structuredClone(input));
      if (input.proposal === "permission") await duringReview?.();
      const result: motivator.MotivatorDecision = input.proposal === "permission" ? decision : { verdict: "complete", reason: "The final report matches the recorded outcome.", nextSteps: [] };
      return { decision: result, inputTokens: 7, outputTokens: 5, messages: motivator.motivatorMessages(input), completion: JSON.stringify(result) };
    });
    vi.spyOn(tools, "executeTool").mockResolvedValue({ ok: true, preview: "The permitted check completed." });
    vi.spyOn(broker, "waitForApprovalDecision").mockImplementation(async (id) => {
      const db = getDb();
      const [pending] = await db.select().from(approvals).where(eq(approvals.id, id));
      const [run] = await db.select().from(runs).where(eq(runs.id, pending!.runId));
      expect(pending!.status).toBe("pending");
      expect(run!.status).toBe("awaiting_approval");
      await db.update(approvals).set({ status: humanDecision, decidedBy: "operator", note: "Human decision.", resolvedAt: new Date() }).where(eq(approvals.id, id));
      return { decision: humanDecision, decidedBy: "operator", note: "Human decision." };
    });
  });
  afterEach(() => vi.restoreAllMocks());

  async function fixture(mode: "request" | "motivator" = "motivator", worker = false) {
    const db = getDb(), workspaceId = newId("ws_permission_test");
    const [workspace] = await db.insert(workspaces).values({ id: workspaceId, slug: workspaceId, name: "Permissions test", approvalMode: mode, createdAt: new Date() }).returning();
    const created = await createAgentGraph({ workspace: workspace!, actor: "test", auditAction: "agent.created", canSpawnSubagents: false, spec: {
      orchestrator: { name: "Check lead", summary: "Checks the workspace.", instructions: "Run the scoped workspace check and report the findings.", complexity: "standard" },
      workers: worker ? [{ name: "Check worker", role: "worker", instructions: "Run the scoped workspace check and report the findings.", complexity: "standard", tools: ["shell.exec"] }] : [],
    } });
    if (!created.ok) throw new Error(created.error);
    await db.update(agents).set({ status: "active", maxSteps: 6 });
    await db.update(agents).set({ allowedTools: ["shell.exec", "agent.delegate"] }).where(eq(agents.id, created.orchestratorId));
    const runId = newId("run_permission_test");
    await db.insert(runs).values({ id: runId, workspaceId, agentId: created.orchestratorId, goal: "Run the scoped workspace check and report the findings.", mode: "scripted", budgetUsd: 1, startedAt: new Date() });
    return { runId, workspaceId, rootId: created.orchestratorId };
  }

  it("keeps Request permission mode on the human path", async () => {
    const { runId } = await fixture("request");
    await executeRun(runId);
    expect(broker.waitForApprovalDecision).toHaveBeenCalledTimes(1);
    expect(reviews.some((review) => review.proposal === "permission")).toBe(false);
    expect(tools.executeTool).toHaveBeenCalledTimes(1);
  });

  it("reviews every exact action through the motivator and records the decision and cost", async () => {
    const command = "check " + "scope ".repeat(150) + "END OF EXACT ACTION";
    turns = [[shell("shell_one", command)], [shell("shell_two", "check another scoped path")], [report]];
    const { runId } = await fixture();
    await executeRun(runId);
    const permissionReviews = reviews.filter((review) => review.proposal === "permission");
    expect(permissionReviews).toHaveLength(2);
    expect(permissionReviews[0]!.permission).toMatchObject({ tool: "shell.exec", risk: "high", args: { command } });
    expect(permissionReviews[1]!.priorReviews[0]!.verdict).toBe("approve");
    expect(broker.waitForApprovalDecision).not.toHaveBeenCalled();
    expect(tools.executeTool).toHaveBeenCalledTimes(2);
    const rows = await getDb().select().from(approvals).where(eq(approvals.runId, runId));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "approved" && row.decidedBy === `mot_${runId}` && row.resolvedAt)).toBe(true);
    const audit = await getDb().select().from(auditLog);
    expect(audit.filter((row) => row.actor === `mot_${runId}` && row.action === "approval.approved")).toHaveLength(2);
    const events = (await getDb().select().from(runEvents).where(eq(runEvents.runId, runId))).map((row) => row.payload);
    expect(events.filter((event) => event.type === "model.usage" && event.agentId === `mot_${runId}`)).toHaveLength(3);
    expect(events.some((event) => event.type === "log" && event.message.includes("waiting for your approval"))).toBe(false);
  });

  it("does not execute an action rejected by the motivator", async () => {
    decision = { verdict: "deny", reason: "This action does not match the user's goal.", nextSteps: [] };
    const { runId } = await fixture();
    await executeRun(runId);
    expect(tools.executeTool).not.toHaveBeenCalled();
    expect(broker.waitForApprovalDecision).not.toHaveBeenCalled();
    expect((await getDb().select().from(approvals))[0]).toMatchObject({ status: "denied", decidedBy: `mot_${runId}` });
  });

  it.each(["request", "motivator"] as const)("gates linked GitHub writes in %s mode even when local file writes are allowed", async (mode) => {
    const { runId, rootId } = await fixture(mode);
    await getDb().update(agents).set({ allowedTools: ["fs.write"] }).where(eq(agents.id, rootId));
    turns = [[{ type: "tool_call", call: { id: "github_write", name: "fs.write", args: { path: "repo/src/check.ts", content: "export const checked = true;" } } }], [report]];
    humanDecision = "denied";
    await executeRun(runId);
    const [approval] = await getDb().select().from(approvals).where(eq(approvals.runId, runId));
    expect(approval).toMatchObject({ resource: "fs.write", risk: "high", status: mode === "motivator" ? "approved" : "denied" });
    expect(approval!.reason).toContain("commits back to the remote");
    if (mode === "motivator") {
      expect(reviews.find((review) => review.proposal === "permission")!.permission).toMatchObject({ tool: "fs.write", risk: "high", args: { path: "repo/src/check.ts" } });
      expect(broker.waitForApprovalDecision).not.toHaveBeenCalled();
      expect(tools.executeTool).toHaveBeenCalledTimes(1);
    } else {
      expect(broker.waitForApprovalDecision).toHaveBeenCalledTimes(1);
      expect(tools.executeTool).not.toHaveBeenCalled();
    }
  });

  it("keeps ordinary local writes available without treating them as GitHub commits", async () => {
    const { runId, rootId } = await fixture();
    await getDb().update(agents).set({ allowedTools: ["fs.write"] }).where(eq(agents.id, rootId));
    turns = [[{ type: "tool_call", call: { id: "local_write", name: "fs.write", args: { path: "notes/report.md", content: "# Findings" } } }], [report]];
    await executeRun(runId);
    expect(reviews.some((review) => review.proposal === "permission")).toBe(false);
    expect(await getDb().select().from(approvals)).toHaveLength(0);
    expect(tools.executeTool).toHaveBeenCalledTimes(1);
  });

  it("asks the human when the motivator cannot establish the user's intent", async () => {
    decision = { verdict: "ask_user", reason: "Only the user can confirm the destination.", question: "Should this action target the shared workspace?", nextSteps: [] };
    humanDecision = "denied";
    const { runId } = await fixture();
    await executeRun(runId);
    expect(broker.waitForApprovalDecision).toHaveBeenCalledTimes(1);
    expect(tools.executeTool).not.toHaveBeenCalled();
    expect((await getDb().select().from(approvals))[0]!.reason).toContain("Only the user");
  });

  it("cannot override a blocked policy or add a missing capability", async () => {
    const { runId, workspaceId } = await fixture();
    await getDb().update(workspaces).set({ actionEffects: { "shell.exec": "deny" } }).where(eq(workspaces.id, workspaceId));
    await executeRun(runId);
    expect(reviews.some((review) => review.proposal === "permission")).toBe(false);
    expect(tools.executeTool).not.toHaveBeenCalled();
    const next = await fixture();
    await getDb().update(agents).set({ allowedTools: [] }).where(eq(agents.id, next.rootId));
    turns = [[shell()], [report]];
    await executeRun(next.runId);
    expect(reviews.some((review) => review.proposal === "permission")).toBe(false);
    expect(tools.executeTool).not.toHaveBeenCalled();
  });

  it("respects switching back to Request permission during a review", async () => {
    const { runId, workspaceId } = await fixture();
    duringReview = async () => { await getDb().update(workspaces).set({ approvalMode: "request" }).where(eq(workspaces.id, workspaceId)); };
    humanDecision = "denied";
    await executeRun(runId);
    expect(broker.waitForApprovalDecision).toHaveBeenCalledTimes(1);
    expect(tools.executeTool).not.toHaveBeenCalled();
  });

  it("respects a blocked policy added during a review", async () => {
    const { runId, workspaceId } = await fixture();
    duringReview = async () => { await getDb().update(workspaces).set({ actionEffects: { "shell.exec": "deny" } }).where(eq(workspaces.id, workspaceId)); };
    await executeRun(runId);
    expect(tools.executeTool).not.toHaveBeenCalled();
    expect(broker.waitForApprovalDecision).not.toHaveBeenCalled();
  });

  it("does not execute an approved action after a user stop", async () => {
    const { runId } = await fixture();
    duringReview = async () => { await cancelRun(runId); };
    await executeRun(runId);
    expect(tools.executeTool).not.toHaveBeenCalled();
    expect((await getDb().select().from(runs).where(eq(runs.id, runId)))[0]!.status).toBe("cancelled");
  });

  it("cannot approve an action past the shared run budget", async () => {
    const { runId } = await fixture();
    vi.mocked(motivator.reviewWithMotivator).mockImplementationOnce(async (input) => ({
      decision, inputTokens: 1e9, outputTokens: 1e9, messages: motivator.motivatorMessages(input), completion: JSON.stringify(decision),
    }));
    await executeRun(runId);
    expect(tools.executeTool).not.toHaveBeenCalled();
    expect((await getDb().select().from(runs).where(eq(runs.id, runId)))[0]!.status).toBe("halted");
  });

  it("reviews a worker's action through the same motivator peer", async () => {
    turns = [[{ type: "tool_call", call: { id: "delegate", name: "agent.delegate", args: { agent: "Check worker", task: "Run the scoped workspace check." } } }], [shell()], [report], [report]];
    const { runId } = await fixture("motivator", true);
    await executeRun(runId);
    expect(reviews.find((review) => review.proposal === "permission")!.permission!.agentName).toBe("Check worker");
    expect(tools.executeTool).toHaveBeenCalledTimes(1);
    expect(broker.waitForApprovalDecision).not.toHaveBeenCalled();
  });

  it("keeps restricted worker context away from an ineligible motivator model", async () => {
    turns = [[{ type: "tool_call", call: { id: "delegate", name: "agent.delegate", args: { agent: "Check worker", task: "Run the scoped workspace check." } } }], [shell()], [report], [report]];
    const { runId, rootId } = await fixture("motivator", true);
    const [lead] = await getDb().select().from(agents).where(eq(agents.id, rootId));
    await getDb().update(agents).set({ modelPolicy: { ...lead!.modelPolicy, mode: "pinned", pinnedModelId: "muse-spark-1.3" } }).where(eq(agents.id, rootId));
    await getDb().update(agents).set({ dataClass: "restricted" }).where(eq(agents.name, "Check worker"));
    humanDecision = "denied";
    await executeRun(runId);
    expect(reviews.some((review) => review.proposal === "permission")).toBe(false);
    expect(broker.waitForApprovalDecision).toHaveBeenCalledTimes(1);
    expect(tools.executeTool).not.toHaveBeenCalled();
  });
});
