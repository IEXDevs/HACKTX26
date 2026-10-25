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
  type RunStatus,
  type TaskComplexity,
} from "@agent-os/core";
import { getDb } from "./db/client";
import { runEvents, runs, type AgentRow } from "./db/schema";
import { duration, relativeTime } from "./format";
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

const ACTIVE: ReadonlySet<RunStatus> = new Set(["queued", "running"]);
const STOPPED: ReadonlySet<RunStatus> = new Set(["failed", "halted", "cancelled"]);

function clock(ts: string | Date): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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
  draft: { who: string; text: string } | null;
  now: string;
  progress: number;
}

export async function runLive(
  runId: string,
  status: RunStatus,
  feedLimit = 6,
): Promise<RunLive> {
  const projection = projectRun(await getRunEvents(runId), runId);
  const name = (id: string) => projection.agents.get(id)?.name ?? "Agent";
  const tasks = [...projection.tasks.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const steps: Step[] = tasks.map((task) => ({
    name: task.title,
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
    draft,
    now: working
      ? `${name(working.agentId)}: ${working.title}`
      : status === "queued"
        ? "Getting ready"
        : (said[said.length - 1]?.text ?? "Working"),
    progress,
  };
}

/* ---------- Home ---------- */

export interface HomeNeed {
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
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

export async function homeView(workspaceId: string): Promise<HomeView> {
  const [approvals, recent, agents] = await Promise.all([
    listPendingApprovals(workspaceId, 6),
    listRuns(workspaceId, { limit: 60 }),
    listAgents(workspaceId),
  ]);
  const agentName = new Map(agents.map((a) => [a.id, a.name]));

  const needs = await Promise.all(
    approvals.map(async (approval) => {
      const run = await getRun(approval.runId);
      return {
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

  const running = await Promise.all(
    recent
      .filter((run) => ACTIVE.has(run.status))
      .map(async (run) => ({
        id: run.id,
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
}

export function runTile(run: RunListRow): RunTile {
  const group: RunTile["group"] =
    run.status === "awaiting_approval" ? "waiting" : ACTIVE.has(run.status) ? "running" : "recent";
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
  };
}

/* ---------- Usage ---------- */

export type UsageRange = "24h" | "7d" | "all";
export interface UsageView {
  overTime: Array<{ at: string; label: string; tokens: number }>;
  byAgent: Array<{ id: string; name: string; tokens: number }>;
  byWorkflow: Array<{ id: string; name: string; tokens: number }>;
  runs: number;
  problems: Array<{ id: string; name: string; result: string; when: string }>;
  spendUsd: number;
  avgDurationMs: number;
}

export async function usageView(workspaceId: string, range: UsageRange): Promise<UsageView> {
  const now = Date.now();
  const since =
    range === "24h" ? now - 24 * 3600e3 : range === "7d" ? now - 7 * 24 * 3600e3 : 0;
  const all = await listRuns(workspaceId, { limit: 1000 });
  const inRange = all.filter((run) => run.startedAt.getTime() >= since);

  // Buckets: hours for 24h, days for 7d, weeks for all time.
  const unit = range === "24h" ? 3600e3 : range === "7d" ? 24 * 3600e3 : 7 * 24 * 3600e3;
  const count =
    range === "all"
      ? Math.max(
          2,
          Math.min(
            26,
            Math.ceil((now - Math.min(...inRange.map((r) => r.startedAt.getTime()), now)) / unit) +
              1,
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
  for (const run of inRange) {
    const index = Math.floor((run.startedAt.getTime() - start + unit / 2) / unit);
    const bucket = buckets[Math.max(0, Math.min(count - 1, index))];
    if (bucket) bucket.tokens += run.inputTokens + run.outputTokens;
  }

  // Tokens per agent come from model.usage events, so workers are counted too.
  const usage = await getDb()
    .select({ payload: runEvents.payload, agentId: runEvents.agentId })
    .from(runEvents)
    .innerJoin(runs, eq(runs.id, runEvents.runId))
    .where(
      and(
        eq(runs.workspaceId, workspaceId),
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
  for (const run of inRange) {
    const entry = perWorkflow.get(run.agentId) ?? { name: run.agentName, tokens: 0 };
    entry.tokens += run.inputTokens + run.outputTokens;
    perWorkflow.set(run.agentId, entry);
  }

  const ended = inRange.filter((run) => run.endedAt);
  return {
    overTime: buckets,
    byAgent,
    byWorkflow: [...perWorkflow.entries()].map(([id, value]) => ({ id, ...value })),
    runs: inRange.length,
    problems: inRange
      .filter((run) => STOPPED.has(run.status))
      .map((run) => ({
        id: run.id,
        name: run.agentName,
        result: short(run.failureReason ?? statusLabel(run.status), 140),
        when: relativeTime(run.startedAt),
      })),
    spendUsd: inRange.reduce((sum, run) => sum + run.costUsd, 0),
    avgDurationMs: ended.length
      ? ended.reduce((sum, run) => sum + (run.endedAt!.getTime() - run.startedAt.getTime()), 0) /
        ended.length
      : 0,
  };
}

/* ---------- Agents ---------- */

/** The model the router would pick for this agent today, as a display label. */
export function routedModel(agent: AgentRow): string {
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
      deniedModelIds: agent.modelPolicy.deniedModelIds,
    });
    return MODEL_BY_ID.get(result.chosenModel)?.label ?? result.chosenModel;
  } catch {
    return "No approved model";
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
  runs: Array<{ id: string; label: string; when: string }>;
}

function teamOf(all: AgentRow[], rootId: string): AgentRow[] {
  const found: AgentRow[] = [];
  const walk = (id: string) => {
    // Retired helpers are not part of the team until they get work again.
    for (const child of all.filter((a) => a.parentAgentId === id && a.status !== "archived")) {
      found.push(child);
      walk(child.id);
    }
  };
  walk(rootId);
  return found;
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
    runs: runs.map((run) => {
      const tile = runTile(run);
      return { id: run.id, label: tile.label, when: tile.when };
    }),
  };
}
