import { describe, expect, it } from "vitest";
import { computeMetrics, projectRun } from "../src/runtime/project";
import { appendEvent, GENESIS_HASH } from "../src/runtime/hash";
import type { RunEvent, RunEventPayload } from "../src/protocol/events";

function chain(payloads: RunEventPayload[]): RunEvent[] {
  let prev = GENESIS_HASH;
  return payloads.map((payload, i) => {
    const event = appendEvent("run_1", i, `2026-10-24T12:00:0${i}.000Z`, payload, prev);
    prev = event.hash;
    return event;
  });
}

describe("run projection", () => {
  const events = chain([
    {
      type: "run.started",
      goal: "remediate the auth regression",
      orchestratorAgentId: "root",
      trigger: "manual",
      budgetUsd: 2.5,
      dataClass: "internal",
    },
    {
      type: "agent.spawned",
      agentId: "root",
      parentAgentId: null,
      name: "Triage",
      role: "orchestrator",
      model: "anthropic/claude-sonnet-4-6",
    },
    {
      type: "task.created",
      taskId: "t1",
      agentId: "root",
      parentTaskId: null,
      title: "Locate failing test",
    },
    {
      type: "tool.requested",
      callId: "c1",
      agentId: "root",
      taskId: "t1",
      tool: "fs.read",
      args: { path: "src/auth.ts" },
      risk: "low",
      scopes: ["read"],
    },
    {
      type: "tool.completed",
      callId: "c1",
      agentId: "root",
      tool: "fs.read",
      ok: true,
      durationMs: 12,
      resultPreview: "export function login() {}",
    },
    {
      type: "permission.requested",
      approvalId: "ap1",
      agentId: "root",
      callId: null,
      resource: "shell:prod-deploy",
      scopes: ["execute"],
      risk: "critical",
      reason: "needs deploy access",
    },
    {
      type: "permission.resolved",
      approvalId: "ap1",
      decision: "denied",
      decidedBy: "sid",
      note: "not during freeze",
    },
    {
      type: "file.changed",
      agentId: "root",
      path: "src/auth.ts",
      op: "read",
      bytes: 24,
    },
    {
      type: "handoff",
      fromAgentId: "root",
      toAgentId: "worker",
      summary: "Triage → worker: inspect the failing test",
    },
    {
      type: "model.usage",
      agentId: "root",
      model: "anthropic/claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.006,
    },
    {
      type: "run.completed",
      status: "succeeded",
      summary: "fixed",
      totalCostUsd: 0.006,
      durationMs: 7000,
    },
  ]);

  it("folds events into run state", () => {
    const state = projectRun(events);
    expect(state.status).toBe("succeeded");
    expect(state.goal).toBe("remediate the auth regression");
    expect(state.agents.get("root")?.promptTokens).toBe(1000);
    expect(state.toolCalls.get("c1")?.status).toBe("succeeded");
    expect(state.approvals.get("ap1")?.status).toBe("denied");
    expect(state.files[0]?.path).toBe("src/auth.ts");
    expect(state.handoffs[0]?.toAgentId).toBe("worker");
    expect(state.lastSeq).toBe(events.length - 1);
  });

  it("computes evaluation metrics", () => {
    const metrics = computeMetrics(projectRun(events));
    expect(metrics.toolCalls).toBe(1);
    expect(metrics.approvalsRequested).toBe(1);
    expect(metrics.approvalsDenied).toBe(1);
    expect(metrics.interventionRate).toBe(1);
    expect(metrics.costUsd).toBeCloseTo(0.006);
  });

  it("moves to awaiting_approval and back", () => {
    const partial = projectRun(events.slice(0, 6));
    expect(partial.status).toBe("awaiting_approval");
    const resumed = projectRun(events.slice(0, 7));
    expect(resumed.status).toBe("running");
  });

  it("is order-independent for the final status flag", () => {
    const shuffled = [...events].sort((a, b) => b.seq - a.seq);
    // Replaying out of order must not silently produce a terminal state.
    const state = projectRun(shuffled);
    expect(state.status).not.toBe("succeeded");
  });
});
