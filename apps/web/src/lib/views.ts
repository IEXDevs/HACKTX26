/**
 * Read-only view models for the Relay screens. Each function folds backend
 * rows and run events into the plain shapes the client components render.
 * No writes happen here.
 */
import { and, eq, gte } from "drizzle-orm";
import {
  MODEL_BY_ID,
  projectRun,
  routeModel,
  TERMINAL_RUN_STATUSES,
  type DataClass,
  type RunEvent,
  type RunStatus,
  type TaskComplexity,
} from "@agent-os/core";
import { getDb } from "./db/client";
import { descendantsOf } from "./agent-tree";
import { runEvents, runs, type AgentRow } from "./db/schema";
import { duration, relativeTime, usd } from "./format";
import { listUsageEvents, type CloudUsageRow } from "./observability";
import { plainText } from "./plain-text";
import { listPendingInputs } from "./runtime/run-input";
import {
  getRun,
  getRunEvents,
  listAgents,
  listPendingApprovals,
  listRuns,
  type RunListRow,
} from "./queries";

/* ---------- Shared ---------- */

export type StepState = "done" | "working" | "next" | "failed";
export interface Step {
  name: string;
  state: StepState;
}
export interface FeedItem {
  id: string;
  at: string;
  who: string;
  text: string;
}
export interface HistoryItem {
  id: string;
  at: string;
  ts: string;
  who: string;
  agentId?: string;
  kind: "thought" | "thinking" | "tool" | "handoff" | "spawn";
  text: string;
  tool?: string;
  status?: string;
}

const ACTIVE: ReadonlySet<RunStatus> = new Set(["queued", "running"]);
const STOPPED: ReadonlySet<RunStatus> = new Set(["failed", "halted", "cancelled"]);

function clock(ts: string | Date): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function iso(ts: string | Date): string {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function clip(value: string, max = 280): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function previewArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([key, value]) => {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    return `${key}=${clip(raw ?? "", 80)}`;
  });
  return clip(parts.join(" · "), 280);
}

/** Fold a run event stream into a uniform activity log. Shared by run pages and the live graph. */
export function foldRunHistory(
  events: RunEvent[],
  nameOf: (id: string) => string,
): HistoryItem[] {
  const history: HistoryItem[] = [];
  for (const event of events) {
    const payload = event.payload;
    switch (payload.type) {
      case "input.requested": {
        history.push({ id: `input-${event.seq}`, at: clock(event.ts), ts: iso(event.ts), who: nameOf(payload.agentId), agentId: payload.agentId,
          kind: "thought", text: `Waiting for your answer: ${payload.question}\n${payload.reason}` });
        break;
      }
      case "input.answered": {
        history.push({ id: `answer-${event.seq}`, at: clock(event.ts), ts: iso(event.ts), who: payload.answeredBy, agentId: payload.agentId,
          kind: "thought", text: `Answer: ${payload.answer}` });
        break;
      }
      case "agent.message": {
        if (payload.delta || payload.role === "user" || !payload.text.trim()) break;
        history.push({
          id: `t-${event.seq}`,
          at: clock(event.ts),
          ts: iso(event.ts),
          who: nameOf(payload.agentId),
          agentId: payload.agentId,
          kind: "thought",
          text: payload.text,
        });
        break;
      }
      case "log": {
        if (payload.fields?.channel !== "thinking" || !payload.message.trim()) break;
        history.push({
          id: `k-${event.seq}`,
          at: clock(event.ts),
          ts: iso(event.ts),
          who: payload.agentId ? nameOf(payload.agentId) : "Agent",
          agentId: payload.agentId ?? undefined,
          kind: "thinking",
          text: payload.message,
        });
        break;
      }
      case "tool.requested": {
        history.push({
          id: `c-${event.seq}`,
          at: clock(event.ts),
          ts: iso(event.ts),
          who: nameOf(payload.agentId),
          agentId: payload.agentId,
          kind: "tool",
          text: previewArgs(payload.args),
          tool: payload.tool,
          status: "requested",
        });
        break;
      }
      case "tool.completed": {
        history.push({
          id: `d-${event.seq}`,
          at: clock(event.ts),
          ts: iso(event.ts),
          who: nameOf(payload.agentId),
          agentId: payload.agentId,
          kind: "tool",
          text: payload.error ?? payload.resultPreview ?? payload.tool,
          tool: payload.tool,
          status: payload.ok ? "done" : "failed",
        });
        break;
      }
      case "handoff": {
        history.push({
          id: `h-${event.seq}`,
          at: clock(event.ts),
          ts: iso(event.ts),
          who: nameOf(payload.fromAgentId),
          agentId: payload.fromAgentId,
          kind: "handoff",
          text: payload.summary,
          tool: `→ ${nameOf(payload.toAgentId)}`,
        });
        break;
      }
      case "agent.spawned": {
        history.push({
          id: `s-${event.seq}`,
          at: clock(event.ts),
          ts: iso(event.ts),
          who: payload.parentAgentId ? nameOf(payload.parentAgentId) : payload.name,
          agentId: payload.parentAgentId ?? payload.agentId,
          kind: "spawn",
          text: payload.name,
          tool: "spawn",
        });
        break;
      }
      case "memory.written": {
        history.push({
          id: `m-${event.seq}`,
          at: clock(event.ts),
          ts: iso(event.ts),
          who: payload.agentId ? nameOf(payload.agentId) : "Agent",
          agentId: payload.agentId ?? undefined,
          kind: "tool",
          text: payload.content,
          tool: "memory.write",
          status: payload.kind,
        });
        break;
      }
      default:
        break;
    }
  }
  return history;
}

/** A plain question for a permission request. */
export function askFor(resource: string): string {
  if (resource.startsWith("http:")) return `Send data to ${resource.slice(5)}?`;
  if (resource.startsWith("cli:")) return `Run ${resource.slice(4)}?`;
  const asks: Record<string, string> = {
    "shell.exec": "Run a shell command?",
    "secret.use": "Use a stored credential?",
    "fs.write": "Write a file?",
    "fs.delete": "Delete a file?",
    "http.fetch": "Reach an outside website?",
    "mcp.call": "Call an outside tool?",
    "connector.call": "Call a connected app?",
    "web.search": "Search the public web?",
    "cli.run": "Run a command-line tool?",
  };
  return asks[resource] ?? `Use ${resource}?`;
}

/** Plain words for a run's status. */
export function statusLabel(status: RunStatus): string {
  const labels: Record<RunStatus, string> = {
    queued: "Starting",
    running: "Running now",
    awaiting_approval: "Waiting for you",
    awaiting_input: "Waiting for your answer",
    succeeded: "Finished",
    failed: "Stopped",
    halted: "Stopped by budget",
    cancelled: "Cancelled",
  };
  return labels[status];
}

/* ---------- Run detail used by Home bars and the run page ---------- */

export interface RunLive {
  steps: Step[];
  feed: FeedItem[];
  history: HistoryItem[];
  draft: { who: string; text: string } | null;
  now: string;
  progress: number;
}

export async function runLive(
  runId: string,
  status: RunStatus,
  feedLimit = 6,
): Promise<RunLive> {
  const events = await getRunEvents(runId);
  const projection = projectRun(events, runId);
  const name = (id: string) => projection.agents.get(id)?.name ?? "Agent";
  const tasks = [...projection.tasks.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const steps: Step[] = tasks.map((task) => ({
    name: plainText(task.title),
    state:
      task.status === "succeeded" || task.status === "skipped"
        ? "done"
        : task.status === "running"
          ? "working"
          : task.status === "failed"
            ? "failed"
            : "next",
  }));
  const said = projection.transcript.filter((entry) => !entry.delta && entry.role === "assistant");
  const feed = said.slice(-feedLimit).map((entry) => ({
    id: String(entry.seq),
    at: clock(entry.ts),
    who: name(entry.agentId),
    text: entry.text,
  }));
  const history = foldRunHistory(events, name);
  const last = projection.transcript[projection.transcript.length - 1];
  const draft =
    ACTIVE.has(status) && last?.delta ? { who: name(last.agentId), text: last.text } : null;
  const working = tasks.find((task) => task.status === "running");
  const done = steps.filter((step) => step.state === "done").length;
  const progress = steps.length
    ? (done + (working ? 0.5 : 0)) / steps.length
    : TERMINAL_RUN_STATUSES.has(status)
      ? 1
      : 0.05;
  return {
    steps,
    feed,
    history,
    draft,
    now: working
      ? `${name(working.agentId)}: ${plainText(working.title)}`
      : status === "queued"
        ? "Getting ready"
        : short(said[said.length - 1]?.text ?? "Working", 160),
    progress,
  };
}

/* ---------- Home ---------- */

export interface HomeNeed {
  kind: "approval" | "input";
  id: string;
  runId: string;
  workflow: string;
  ask: string;
  preview: string;
  waiting: string;
  risk: string;
}
export interface HomeRun extends RunLive {
  id: string;
  agentId: string;
  name: string;
  goal: string;
  elapsed: string;
}
export interface HomeFinished {
  id: string;
  name: string;
  result: string;
  stopped: boolean;
  detail: string;
}
export interface HomeView {
  needs: HomeNeed[];
  running: HomeRun[];
  finished: HomeFinished[];
  agents: Array<{ id: string; name: string; status: string; defaultGoal: string }>;
  scripted: boolean;
}

function short(text: string, max = 90): string {
  // Agent output is Markdown with LaTeX; one-line summaries show it plain.
  const clean = plainText(text);
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

export async function homeView(workspaceId: string): Promise<HomeView> {
  const [approvals, recent, agents, questions] = await Promise.all([
    listPendingApprovals(workspaceId, 6),
    // Retests and security checks run on synthetic test data: they stay in Runs and Usage, not Home.
    listRuns(workspaceId, { limit: 60, excludeTests: true }),
    listAgents(workspaceId),
    listPendingInputs(workspaceId),
  ]);
  const agentName = new Map(agents.map((a) => [a.id, a.name]));

  const needs: HomeNeed[] = await Promise.all(
    approvals.map(async (approval) => {
      const run = await getRun(approval.runId);
      return {
        kind: "approval" as const,
        id: approval.id,
        runId: approval.runId,
        workflow: run?.agent?.name ?? agentName.get(approval.agentId) ?? "Agent",
        ask: askFor(approval.resource),
        preview: approval.reason,
        waiting: relativeTime(approval.requestedAt).replace(" ago", ""),
        risk: approval.risk,
      };
    }),
  );

  needs.unshift(...questions.map((question) => ({
    kind: "input" as const, id: question.id, runId: question.runId,
    workflow: agentName.get(question.agentId) ?? "Agent", ask: question.question, preview: question.reason,
    waiting: relativeTime(question.requestedAt).replace(" ago", ""), risk: "low",
  })));

  const running = await Promise.all(
    recent
      .filter((run) => ACTIVE.has(run.status))
      .map(async (run) => ({
        id: run.id,
        agentId: run.agentId,
        name: run.agentName,
        goal: run.goal,
        elapsed: duration(Date.now() - run.startedAt.getTime()),
        ...(await runLive(run.id, run.status)),
      })),
  );

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const finished = recent
    .filter(
      (run) => TERMINAL_RUN_STATUSES.has(run.status) && run.startedAt.getTime() >= dayAgo,
    )
    .map((run) => ({
      id: run.id,
      name: short(run.goal, 70),
      result: short(
        STOPPED.has(run.status)
          ? (run.failureReason ?? statusLabel(run.status))
          : (run.summary ?? statusLabel(run.status)),
        120,
      ),
      stopped: STOPPED.has(run.status),
      detail: `${run.agentName} · ${duration(
        (run.endedAt?.getTime() ?? Date.now()) - run.startedAt.getTime(),
      )} · ${(run.inputTokens + run.outputTokens).toLocaleString()} tokens`,
    }));

  return {
    needs,
    running,
    finished,
    agents: agents
      .filter((a) => a.parentAgentId === null)
      .map((a) => ({ id: a.id, name: a.name, status: a.status, defaultGoal: a.defaultGoal })),
    scripted: (process.env.MODEL_GATEWAY ?? "scripted") === "scripted",
  };
}

/* ---------- Runs ---------- */

export interface RunTile {
  id: string;
  name: string;
  goal: string;
  status: RunStatus;
  label: string;
  tone: "waiting" | "running" | "stopped" | "";
  group: "waiting" | "running" | "recent";
  when: string;
  detail: string;
  duration: string;
  spend: string;
  startedMs: number;
}

export function runTile(run: RunListRow): RunTile {
  const group: RunTile["group"] =
    run.status === "awaiting_approval" || run.status === "awaiting_input" ? "waiting" : ACTIVE.has(run.status) ? "running" : "recent";
  return {
    id: run.id,
    name: run.agentName,
    goal: run.goal,
    status: run.status,
    label: statusLabel(run.status),
    tone:
      group === "waiting"
        ? "waiting"
        : group === "running"
          ? "running"
          : STOPPED.has(run.status)
            ? "stopped"
            : "",
    group,
    when: relativeTime(run.startedAt),
    detail: `${(run.inputTokens + run.outputTokens).toLocaleString()} tokens · $${run.costUsd.toFixed(
      2,
    )}`,
    duration: duration((run.endedAt?.getTime() ?? Date.now()) - run.startedAt.getTime()),
    spend: usd(run.costUsd),
    startedMs: run.startedAt.getTime(),
  };
}

/* ---------- Usage ---------- */

export type UsageRange = "24h" | "7d" | "all";
export interface UsageView {
  overTime: Array<{ at: string; label: string; tokens: number }>;
  byAgent: Array<{ id: string; name: string; tokens: number }>;
  byWorkflow: Array<{ id: string; name: string; tokens: number }>;
  runs: number;
  spendUsd: number;
  avgDurationMs: number;
  ledger: "supabase" | "local";
}

function usageBuckets(range: UsageRange, now: number, timestamps: number[]) {
  const unit = range === "24h" ? 3600e3 : range === "7d" ? 24 * 3600e3 : 7 * 24 * 3600e3;
  const count =
    range === "all"
      ? Math.max(
          2,
          Math.min(
            26,
            Math.ceil((now - Math.min(...timestamps, now)) / unit) + 1,
          ),
        )
      : range === "24h"
        ? 24
        : 7;
  const start = now - (count - 1) * unit;
  const buckets = Array.from({ length: count }, (_, i) => {
    const at = new Date(start + i * unit);
    return {
      at: at.toISOString(),
      label:
        range === "24h"
          ? at.toLocaleTimeString("en-US", { hour: "numeric" })
          : at.toLocaleDateString("en-US", range === "7d" ? { weekday: "short" } : { month: "short", day: "numeric" }),
      tokens: 0,
    };
  });
  return { buckets, start, unit, count };
}

function fromCloud(rows: CloudUsageRow[], range: UsageRange, liveRuns: RunListRow[]): UsageView {
  const now = Date.now();
  const { buckets, start, unit, count } = usageBuckets(
    range,
    now,
    rows.map((row) => row.createdAt.getTime()),
  );
  const perAgent = new Map<string, { name: string; tokens: number }>();
  const perWorkflow = new Map<string, { name: string; tokens: number }>();
  const runIds = new Set<string>();
  let spendUsd = 0;
  for (const row of rows) {
    const tokens = row.inputTokens + row.outputTokens;
    spendUsd += row.costUsd;
    if (row.runId) runIds.add(row.runId);
    const index = Math.floor((row.createdAt.getTime() - start + unit / 2) / unit);
    const bucket = buckets[Math.max(0, Math.min(count - 1, index))];
    if (bucket) bucket.tokens += tokens;
    const agentKey = row.agentId ?? row.source;
    const agentName =
      row.agentName ?? (row.source === "builder" ? "Builder" : row.source === "compose" ? "Composer" : "Model");
    const agent = perAgent.get(agentKey) ?? { name: agentName, tokens: 0 };
    agent.tokens += tokens;
    perAgent.set(agentKey, agent);
    const workflowKey = row.agentId ?? row.source;
    const workflow = perWorkflow.get(workflowKey) ?? { name: agentName, tokens: 0 };
    workflow.tokens += tokens;
    perWorkflow.set(workflowKey, workflow);
  }
  const ended = liveRuns.filter((run) => run.endedAt);
  return {
    overTime: buckets,
    byAgent: [...perAgent.entries()].map(([id, value]) => ({ id, ...value })),
    byWorkflow: [...perWorkflow.entries()].map(([id, value]) => ({ id, ...value })),
    runs: runIds.size,
    spendUsd,
    avgDurationMs: ended.length
      ? ended.reduce((sum, run) => sum + (run.endedAt!.getTime() - run.startedAt.getTime()), 0) /
        ended.length
      : 0,
    ledger: "supabase",
  };
}

export async function usageView(workspaceId: string, range: UsageRange): Promise<UsageView> {
  const now = Date.now();
  const since =
    range === "24h" ? now - 24 * 3600e3 : range === "7d" ? now - 7 * 24 * 3600e3 : 0;
  const all = await listRuns(workspaceId, { limit: 1000 });
  const live = all.filter((run) => run.mode === "live" && run.startedAt.getTime() >= since);

  const cloud = await listUsageEvents(workspaceId, range);
  if (cloud && cloud.length > 0) return fromCloud(cloud, range, live);

  const { buckets, start, unit, count } = usageBuckets(
    range,
    now,
    live.map((run) => run.startedAt.getTime()),
  );
  for (const run of live) {
    const index = Math.floor((run.startedAt.getTime() - start + unit / 2) / unit);
    const bucket = buckets[Math.max(0, Math.min(count - 1, index))];
    if (bucket) bucket.tokens += run.inputTokens + run.outputTokens;
  }

  const usage = await getDb()
    .select({ payload: runEvents.payload, agentId: runEvents.agentId })
    .from(runEvents)
    .innerJoin(runs, eq(runs.id, runEvents.runId))
    .where(
      and(
        eq(runs.workspaceId, workspaceId),
        eq(runs.mode, "live"),
        eq(runEvents.type, "model.usage"),
        gte(runs.startedAt, new Date(since)),
      ),
    );
  const agents = await listAgents(workspaceId);
  const perAgent = new Map<string, number>();
  for (const row of usage) {
    const payload = row.payload as { agentId?: string; inputTokens?: number; outputTokens?: number };
    const id = payload.agentId ?? row.agentId ?? "unknown";
    perAgent.set(id, (perAgent.get(id) ?? 0) + (payload.inputTokens ?? 0) + (payload.outputTokens ?? 0));
  }
  const byAgent = agents
    .filter((agent) => perAgent.has(agent.id))
    .map((agent) => ({ id: agent.id, name: agent.name, tokens: perAgent.get(agent.id) ?? 0 }));

  const perWorkflow = new Map<string, { name: string; tokens: number }>();
  for (const run of live) {
    const entry = perWorkflow.get(run.agentId) ?? { name: run.agentName, tokens: 0 };
    entry.tokens += run.inputTokens + run.outputTokens;
    perWorkflow.set(run.agentId, entry);
  }

  const ended = live.filter((run) => run.endedAt);
  return {
    overTime: buckets,
    byAgent,
    byWorkflow: [...perWorkflow.entries()].map(([id, value]) => ({ id, ...value })),
    runs: live.length,
    spendUsd: live.reduce((sum, run) => sum + run.costUsd, 0),
    avgDurationMs: ended.length
      ? ended.reduce((sum, run) => sum + (run.endedAt!.getTime() - run.startedAt.getTime()), 0) /
        ended.length
      : 0,
    ledger: "local",
  };
}

/* ---------- Agents ---------- */

/** The model the router would pick for this agent today, as a display label. */
export function routedModel(agent: AgentRow, deniedModelIds: readonly string[] = []): string {
  try {
    const result = routeModel({
      complexity: agent.complexity as TaskComplexity,
      dataClass: agent.dataClass as DataClass,
      requiredCapabilities: ["tool_calling"],
      estimatedInputTokens: 4000,
      estimatedOutputTokens: 900,
      costSensitivity: agent.modelPolicy.costSensitivity,
      latencySensitivity: agent.modelPolicy.latencySensitivity,
      pinnedModelId:
        agent.modelPolicy.mode === "pinned"
          ? (agent.modelPolicy.pinnedModelId ?? undefined)
          : undefined,
      deniedModelIds: [...deniedModelIds, ...agent.modelPolicy.deniedModelIds],
    });
    return MODEL_BY_ID.get(result.chosenModel)?.label ?? result.chosenModel;
  } catch {
    return "Muse Spark 1.3";
  }
}

/* ---------- Workflows ---------- */

/** A workflow is a top-level agent with its team, its standing task and its runs. */
export interface WorkflowTile {
  id: string;
  name: string;
  task: string;
  label: string;
  tone: RunTile["tone"];
  group: RunTile["group"];
  team: number;
  runs: number;
  edited: string;
  archived: boolean;
}

export interface WorkflowNode {
  id: string;
  name: string;
  role: string;
  job: string;
  instructions: string;
  tools: string[];
  children: WorkflowNode[];
}

export interface WorkflowView {
  id: string;
  name: string;
  status: string;
  task: string;
  tree: WorkflowNode;
  /** Every agent in the team, so activation can cover all of them. */
  agentIds: string[];
  liveRunId: string | null;
  runs: Array<{ id: string; label: string; when: string }>;
}

function teamOf(all: AgentRow[], rootId: string): AgentRow[] {
  // Retired helpers and their descendants are not part of the active team.
  return descendantsOf(all.filter((agent) => agent.status !== "archived"), rootId);
}

export async function workflowTiles(workspaceId: string): Promise<WorkflowTile[]> {
  const [agents, runs] = await Promise.all([
    listAgents(workspaceId),
    listRuns(workspaceId, { limit: 1000 }),
  ]);
  return agents
    .filter((agent) => agent.parentAgentId === null)
    .map((agent) => {
      const own = runs.filter((run) => run.agentId === agent.id);
      const latest = own[0] ? runTile(own[0]) : null;
      return {
        id: agent.id,
        name: agent.name,
        task: latest?.goal || agent.defaultGoal || agent.summary,
        label: latest ? `${latest.label}${latest.group === "recent" ? ` ${latest.when}` : ""}` : "Not run yet",
        tone: latest?.tone ?? "",
        group: latest?.group ?? "recent",
        team: teamOf(agents, agent.id).length,
        runs: own.length,
        edited: relativeTime(agent.updatedAt),
        archived: agent.status === "archived",
      };
    });
}

export async function workflowView(
  workspaceId: string,
  agentId: string,
): Promise<WorkflowView | null> {
  const [agents, runs] = await Promise.all([
    listAgents(workspaceId),
    listRuns(workspaceId, { limit: 200, agentId }),
  ]);
  const root = agents.find((agent) => agent.id === agentId && agent.parentAgentId === null);
  if (!root) return null;
  const node = (agent: AgentRow): WorkflowNode => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    job: agent.summary,
    instructions: agent.instructions,
    tools: agent.allowedTools,
    children: agents.filter((a) => a.parentAgentId === agent.id && a.status !== "archived").map(node),
  });
  return {
    id: root.id,
    name: root.name,
    status: root.status,
    task: root.defaultGoal || runs[0]?.goal || "",
    tree: node(root),
    agentIds: [root.id, ...teamOf(agents, root.id).map((a) => a.id)],
    liveRunId:
      runs.find(
        (run) => run.status === "queued" || run.status === "running" || run.status === "awaiting_approval" || run.status === "awaiting_input",
      )?.id ?? null,
    runs: runs.map((run) => {
      const tile = runTile(run);
      return { id: run.id, label: tile.label, when: tile.when };
    }),
  };
}
