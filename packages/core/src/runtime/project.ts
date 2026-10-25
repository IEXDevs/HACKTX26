/**
 * Event → view projection.
 *
 * The database stores events, not state. Everything the UI renders (agent
 * status, tasks, tool calls, approvals, findings, cost) is folded out of the
 * stream by this pure reducer, which means the live view and a replayed view can
 * never disagree.
 */
import type { RunEvent, RunStatus } from "../protocol/events";
import type { AgentRole, Severity } from "../protocol/events";

export type AgentRuntimeStatus =
  | "idle"
  | "thinking"
  | "working"
  | "blocked"
  | "done"
  | "failed";

export interface ProjectedAgent {
  id: string;
  name: string;
  role: AgentRole;
  parentAgentId: string | null;
  model: string;
  status: AgentRuntimeStatus;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  spawnedAt: string;
  messages: number;
}

export interface ProjectedTask {
  id: string;
  agentId: string;
  parentTaskId: string | null;
  title: string;
  detail: string | null;
  status: "pending" | "running" | "blocked" | "succeeded" | "failed" | "skipped";
  note: string | null;
  createdAt: string;
}

export interface ProjectedToolCall {
  id: string;
  agentId: string;
  taskId: string | null;
  tool: string;
  args: Record<string, unknown>;
  risk: string;
  scopes: string[];
  status: "requested" | "succeeded" | "failed" | "awaiting_approval" | "denied";
  startedAt: string;
  durationMs: number | null;
  resultPreview: string | null;
  error: string | null;
}

export interface ProjectedApproval {
  id: string;
  agentId: string;
  callId: string | null;
  resource: string;
  scopes: string[];
  risk: string;
  reason: string;
  status: "pending" | "approved" | "denied" | "expired";
  decidedBy: string | null;
  note: string | null;
  requestedAt: string;
}

export interface ProjectedFinding {
  id: string;
  agentId: string;
  targetAgentId: string | null;
  category: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: string | null;
  remediation: string | null;
  at: string;
}

export interface TranscriptEntry {
  seq: number;
  ts: string;
  agentId: string;
  role: "assistant" | "system" | "user";
  text: string;
  delta: boolean;
}

export interface RouterDecisionView {
  seq: number;
  ts: string;
  agentId: string;
  taskId: string | null;
  chosenModel: string;
  hwTier?: "light" | "medium" | "heavy";
  reason: string;
  estimatedCostUsd: number;
  candidates: Array<{
    model: string;
    score: number;
    estimatedCostUsd: number;
    rejectedReason?: string;
  }>;
}

export interface LogLineView {
  seq: number;
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  agentId: string | null;
}

export interface RunProjection {
  runId: string;
  protocol: number;
  goal: string | null;
  trigger: string | null;
  status: RunStatus;
  dataClass: string | null;
  startedAt: string | null;
  endedAt: string | null;
  budgetUsd: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  summary: string | null;
  failureReason: string | null;
  agents: Map<string, ProjectedAgent>;
  tasks: Map<string, ProjectedTask>;
  toolCalls: Map<string, ProjectedToolCall>;
  approvals: Map<string, ProjectedApproval>;
  findings: ProjectedFinding[];
  memories: Array<{ seq: number; scope: string; kind: string; content: string }>;
  transcript: TranscriptEntry[];
  router: RouterDecisionView[];
  logs: LogLineView[];
  budgetEvents: Array<{
    seq: number;
    kind: "warning" | "halted";
    scope: string;
    spentUsd: number;
    limitUsd: number;
  }>;
  lastSeq: number;
}

export function emptyProjection(runId: string): RunProjection {
  return {
    runId,
    protocol: 1,
    goal: null,
    trigger: null,
    status: "queued",
    dataClass: null,
    startedAt: null,
    endedAt: null,
    budgetUsd: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    summary: null,
    failureReason: null,
    agents: new Map(),
    tasks: new Map(),
    toolCalls: new Map(),
    approvals: new Map(),
    findings: [],
    memories: [],
    transcript: [],
    router: [],
    logs: [],
    budgetEvents: [],
    lastSeq: -1,
  };
}

export function applyEvent(
  state: RunProjection,
  event: RunEvent,
): RunProjection {
  // Reducer is copy-on-write at the top level; nested maps are mutated in place
  // for speed, so callers get a fresh object identity per event.
  const next: RunProjection = {
    ...state,
    agents: new Map(state.agents),
    tasks: new Map(state.tasks),
    toolCalls: new Map(state.toolCalls),
    approvals: new Map(state.approvals),
    findings: [...state.findings],
    memories: [...state.memories],
    transcript: [...state.transcript],
    router: [...state.router],
    logs: [...state.logs],
    budgetEvents: [...state.budgetEvents],
    lastSeq: event.seq,
  };

  const p = event.payload;

  switch (p.type) {
    case "run.started": {
      next.goal = p.goal;
      next.trigger = p.trigger;
      next.budgetUsd = p.budgetUsd;
      next.dataClass = p.dataClass;
      next.startedAt = event.ts;
      next.status = "running";
      break;
    }
    case "run.completed": {
      next.status = p.status;
      next.summary = p.summary ?? null;
      next.failureReason = p.reason ?? null;
      next.endedAt = event.ts;
      next.costUsd = p.totalCostUsd;
      break;
    }
    case "agent.spawned": {
      next.agents.set(p.agentId, {
        id: p.agentId,
        name: p.name,
        role: p.role,
        parentAgentId: p.parentAgentId,
        model: p.model,
        status: "idle",
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        spawnedAt: event.ts,
        messages: 0,
      });
      break;
    }
    case "agent.status": {
      const agent = next.agents.get(p.agentId);
      if (agent) next.agents.set(p.agentId, { ...agent, status: p.status });
      break;
    }
    case "agent.message": {
      const agent = next.agents.get(p.agentId);
      if (agent) {
        next.agents.set(p.agentId, {
          ...agent,
          messages: agent.messages + (p.delta ? 0 : 1),
        });
      }
      next.transcript.push({
        seq: event.seq,
        ts: event.ts,
        agentId: p.agentId,
        role: p.role,
        text: p.text,
        delta: p.delta ?? false,
      });
      break;
    }
    case "task.created": {
      next.tasks.set(p.taskId, {
        id: p.taskId,
        agentId: p.agentId,
        parentTaskId: p.parentTaskId,
        title: p.title,
        detail: p.detail ?? null,
        status: "pending",
        note: null,
        createdAt: event.ts,
      });
      break;
    }
    case "task.updated": {
      const task = next.tasks.get(p.taskId);
      if (task) {
        next.tasks.set(p.taskId, {
          ...task,
          status: p.status,
          note: p.note ?? task.note,
        });
      }
      break;
    }
    case "tool.requested": {
      next.toolCalls.set(p.callId, {
        id: p.callId,
        agentId: p.agentId,
        taskId: p.taskId,
        tool: p.tool,
        args: p.args,
        risk: p.risk,
        scopes: p.scopes,
        status: "requested",
        startedAt: event.ts,
        durationMs: null,
        resultPreview: null,
        error: null,
      });
      break;
    }
    case "tool.completed": {
      const call = next.toolCalls.get(p.callId);
      if (call) {
        next.toolCalls.set(p.callId, {
          ...call,
          status: p.ok ? "succeeded" : "failed",
          durationMs: p.durationMs,
          resultPreview: p.resultPreview ?? null,
          error: p.error ?? null,
        });
      }
      break;
    }
    case "permission.requested": {
      next.approvals.set(p.approvalId, {
        id: p.approvalId,
        agentId: p.agentId,
        callId: p.callId,
        resource: p.resource,
        scopes: p.scopes,
        risk: p.risk,
        reason: p.reason,
        status: "pending",
        decidedBy: null,
        note: null,
        requestedAt: event.ts,
      });
      if (p.callId) {
        const call = next.toolCalls.get(p.callId);
        if (call) next.toolCalls.set(p.callId, { ...call, status: "awaiting_approval" });
      }
      if (next.status === "running") next.status = "awaiting_approval";
      break;
    }
    case "permission.resolved": {
      const approval = next.approvals.get(p.approvalId);
      if (approval) {
        next.approvals.set(p.approvalId, {
          ...approval,
          status: p.decision,
          decidedBy: p.decidedBy,
          note: p.note ?? null,
        });
        if (approval.callId) {
          const call = next.toolCalls.get(approval.callId);
          if (call) {
            next.toolCalls.set(approval.callId, {
              ...call,
              status: p.decision === "approved" ? "requested" : "denied",
            });
          }
        }
      }
      const stillPending = [...next.approvals.values()].some((a) => a.status === "pending");
      if (!stillPending && next.status === "awaiting_approval") next.status = "running";
      break;
    }
    case "router.decision": {
      next.router.push({
        seq: event.seq,
        ts: event.ts,
        agentId: p.agentId,
        taskId: p.taskId,
        chosenModel: p.chosenModel,
        hwTier: p.hwTier,
        reason: p.reason,
        estimatedCostUsd: p.estimatedCostUsd,
        candidates: p.candidates,
      });
      const agent = next.agents.get(p.agentId);
      if (agent) next.agents.set(p.agentId, { ...agent, model: p.chosenModel });
      break;
    }
    case "model.usage": {
      next.inputTokens += p.inputTokens;
      next.outputTokens += p.outputTokens;
      next.costUsd = Number((next.costUsd + p.costUsd).toFixed(6));
      const agent = next.agents.get(p.agentId);
      if (agent) {
        next.agents.set(p.agentId, {
          ...agent,
          promptTokens: agent.promptTokens + p.inputTokens,
          completionTokens: agent.completionTokens + p.outputTokens,
          costUsd: Number((agent.costUsd + p.costUsd).toFixed(6)),
        });
      }
      break;
    }
    case "security.finding": {
      next.findings.push({
        id: p.findingId,
        agentId: p.agentId,
        targetAgentId: p.targetAgentId,
        category: p.category,
        severity: p.severity,
        title: p.title,
        detail: p.detail,
        evidence: p.evidence ?? null,
        remediation: p.remediation ?? null,
        at: event.ts,
      });
      break;
    }
    case "memory.written": {
      next.memories.push({
        seq: event.seq,
        scope: p.scope,
        kind: p.kind,
        content: p.content,
      });
      break;
    }
    case "budget.warning": {
      next.budgetEvents.push({
        seq: event.seq,
        kind: "warning",
        scope: p.scope,
        spentUsd: p.spentUsd,
        limitUsd: p.limitUsd,
      });
      break;
    }
    case "budget.halted": {
      next.budgetEvents.push({
        seq: event.seq,
        kind: "halted",
        scope: p.scope,
        spentUsd: p.spentUsd,
        limitUsd: p.limitUsd,
      });
      next.status = "halted";
      break;
    }
    case "log": {
      next.logs.push({
        seq: event.seq,
        ts: event.ts,
        level: p.level,
        message: p.message,
        agentId: p.agentId ?? null,
      });
      break;
    }
    case "file.changed":
    case "handoff":
    case "eval.scored":
      break;
  }

  return next;
}

export function projectRun(events: readonly RunEvent[], runId?: string): RunProjection {
  const id = runId ?? events[0]?.runId ?? "unknown";
  return events.reduce(applyEvent, emptyProjection(id));
}

export interface RunMetrics {
  durationMs: number | null;
  costUsd: number;
  toolCalls: number;
  toolFailureRate: number;
  approvalsRequested: number;
  approvalsDenied: number;
  interventionRate: number;
  agentCount: number;
  findings: number;
  criticalFindings: number;
}

/** Derived evaluation metrics — the numbers on the evals screen. */
export function computeMetrics(state: RunProjection): RunMetrics {
  const calls = [...state.toolCalls.values()];
  const failed = calls.filter((c) => c.status === "failed").length;
  const approvals = [...state.approvals.values()];
  const denied = approvals.filter((a) => a.status === "denied").length;
  const durationMs =
    state.startedAt && state.endedAt
      ? new Date(state.endedAt).getTime() - new Date(state.startedAt).getTime()
      : null;

  return {
    durationMs,
    costUsd: state.costUsd,
    toolCalls: calls.length,
    toolFailureRate: calls.length ? failed / calls.length : 0,
    approvalsRequested: approvals.length,
    approvalsDenied: denied,
    // "Intervention rate": share of tool calls that needed a human decision.
    interventionRate: calls.length ? approvals.length / calls.length : 0,
    agentCount: state.agents.size,
    findings: state.findings.length,
    criticalFindings: state.findings.filter((f) => f.severity === "critical").length,
  };
}
