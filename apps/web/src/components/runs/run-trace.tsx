"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  CircleDollarSign,
  Cpu,
  FileText,
  HandCoins,
  Loader2,
  Lock,
  MessageSquare,
  ShieldAlert,
  Terminal,
  Wrench,
  X,
} from "@/components/icons";
import { computeMetrics, projectRun } from "@agent-os/core/project";
import type { RunEvent } from "@agent-os/core/protocol";
import {
  Button,
  Divider,
  EmptyState,
  Meter,
  Metric,
  Panel,
  RiskTag,
  StatusBadge,
  Tag,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { clockTime, duration, pct, relativeTime, tokens, usd } from "@/lib/format";

export interface TraceAgent {
  id: string;
  name: string;
  role: string;
  parentAgentId: string | null;
}

export interface TraceRun {
  id: string;
  goal: string;
  status: string;
  dataClass: string;
  mode: string;
  trigger: string | null;
  budgetUsd: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: string;
  endedAt: string | null;
  failureReason: string | null;
  summary: string | null;
}

type Filter = "all" | "tools" | "messages" | "policy" | "security" | "files";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "tools", label: "Tools" },
  { id: "messages", label: "Transcript" },
  { id: "policy", label: "Policy" },
  { id: "files", label: "Files" },
  { id: "security", label: "Security" },
];

const TERMINAL = new Set(["succeeded", "failed", "halted", "cancelled"]);

interface ActivityItem {
  seq: number;
  ts: string;
  agentId: string | null;
  kind: Filter;
  icon: typeof Activity;
  title: string;
  detail?: string;
  mono?: string;
  tone?: "ok" | "warn" | "danger" | "audit" | "info" | "muted";
  approvalId?: string;
  approvalStatus?: string;
  expansion?: string;
}

function buildActivity(events: readonly RunEvent[]): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const event of events) {
    const p = event.payload;
    const base = { seq: event.seq, ts: event.ts };
    switch (p.type) {
      case "run.started":
        items.push({
          ...base,
          agentId: p.orchestratorAgentId,
          kind: "policy",
          icon: Activity,
          title: `Run started · ${p.trigger} trigger`,
          detail: `${p.dataClass} data · ceiling ${usd(p.budgetUsd)}`,
          tone: "info",
        });
        break;
      case "router.decision":
        items.push({
          ...base,
          agentId: p.agentId,
          kind: "policy",
          icon: Cpu,
          title: `Routed to ${p.chosenModel}`,
          detail: p.reason,
          mono: `${p.hwTier ? `HW ${p.hwTier} · ` : ""}$${p.estimatedCostUsd.toFixed(4)} est · ${p.candidates.length} candidates`,
          tone: "info",
          expansion: JSON.stringify(p.candidates, null, 2),
        });
        break;
      case "agent.message":
        if (p.role !== "assistant") break;
        items.push({
          ...base,
          agentId: p.agentId,
          kind: "messages",
          icon: MessageSquare,
          title: p.text,
          tone: "muted",
        });
        break;
      case "tool.requested":
        items.push({
          ...base,
          agentId: p.agentId,
          kind: "tools",
          icon: Wrench,
          title: `requested ${p.tool}`,
          detail: Object.entries(p.args)
            .map(([key, value]) => `${key}=${String(value).slice(0, 120)}`)
            .join("  "),
          mono: `${p.risk} risk · ${p.scopes.join(",")}`,
          tone: p.risk === "critical" ? "danger" : p.risk === "high" ? "warn" : "muted",
          expansion: JSON.stringify(p.args, null, 2),
        });
        break;
      case "tool.completed":
        items.push({
          ...base,
          agentId: p.agentId,
          kind: "tools",
          icon: p.ok ? Check : X,
          title: `${p.tool} ${p.ok ? "completed" : "failed"}`,
          detail: p.error ?? p.resultPreview,
          mono: `${p.durationMs}ms`,
          tone: p.ok ? "ok" : "danger",
          expansion: p.resultPreview ?? p.error ?? undefined,
        });
        break;
      case "permission.requested":
        items.push({
          ...base,
          agentId: p.agentId,
          kind: "policy",
          icon: Lock,
          title: `approval needed for ${p.resource}`,
          detail: p.reason,
          mono: `${p.risk} risk`,
          tone: p.risk === "critical" ? "danger" : "warn",
          approvalId: p.approvalId,
          approvalStatus: "pending",
        });
        break;
      case "permission.resolved":
        items.push({
          ...base,
          agentId: null,
          kind: "policy",
          icon: p.decision === "approved" ? Check : X,
          title: `approval ${p.decision} by ${p.decidedBy}`,
          detail: p.note,
          tone: p.decision === "approved" ? "ok" : "danger",
        });
        break;
      case "security.finding":
        items.push({
          ...base,
          agentId: p.agentId,
          kind: "security",
          icon: ShieldAlert,
          title: `[${p.severity}] ${p.title}`,
          detail: p.detail,
          tone: p.severity === "critical" || p.severity === "high" ? "danger" : "warn",
          expansion: [p.evidence, p.remediation].filter(Boolean).join("\n\n"),
        });
        break;
      case "handoff":
        items.push({
          ...base,
          agentId: p.toAgentId,
          kind: "tools",
          icon: HandCoins,
          title: "handoff",
          detail: p.summary,
          tone: "muted",
        });
        break;
      case "task.created":
        items.push({
          ...base,
          agentId: p.agentId,
          kind: "tools",
          icon: FileText,
          title: `task opened · ${p.title}`,
          detail: p.detail,
          mono: p.taskId,
          tone: "muted",
        });
        break;
      case "file.changed":
        items.push({
          ...base,
          agentId: p.agentId,
          kind: "files",
          icon: FileText,
          title: `${p.op} ${p.path}`,
          mono: p.bytes ? `${p.bytes} bytes` : undefined,
          tone: p.op === "read" ? "muted" : "ok",
        });
        break;
      case "budget.warning":
        items.push({
          ...base,
          agentId: null,
          kind: "policy",
          icon: CircleDollarSign,
          title: "budget warning",
          detail: `${usd(p.spentUsd, { precise: true })} of ${usd(p.limitUsd)} (${pct(p.threshold)})`,
          tone: "warn",
        });
        break;
      case "budget.halted":
        items.push({
          ...base,
          agentId: null,
          kind: "policy",
          icon: AlertTriangle,
          title: "run halted by budget",
          detail: `${usd(p.spentUsd, { precise: true })} spent against a ${usd(p.limitUsd)} ceiling`,
          tone: "danger",
        });
        break;
      case "run.completed":
        items.push({
          ...base,
          agentId: null,
          kind: "policy",
          icon: Activity,
          title: `run ${p.status}`,
          detail: p.summary,
          mono: `${usd(p.totalCostUsd, { precise: true })} · ${duration(p.durationMs)}`,
          tone:
            p.status === "succeeded"
              ? "ok"
              : p.status === "failed" || p.status === "halted"
                ? "danger"
                : "warn",
          expansion: p.reason ?? undefined,
        });
        break;
      case "log":
        if (p.level === "debug") break;
        items.push({
          ...base,
          agentId: p.agentId ?? null,
          kind: "policy",
          icon: Terminal,
          title: p.message,
          tone: p.level === "error" ? "danger" : p.level === "warn" ? "warn" : "muted",
        });
        break;
      default:
        break;
    }
  }

  return items;
}

const TONE_TEXT: Record<string, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  audit: "text-audit",
  info: "text-info",
  muted: "text-ink-3",
};

export function RunTrace({
  run,
  initialEvents,
  agents,
  chain,
}: {
  run: TraceRun;
  initialEvents: RunEvent[];
  agents: TraceAgent[];
  chain: { valid: boolean; checked: number; brokenAt: number | null };
}) {
  const router = useRouter();
  const [events, setEvents] = useState<RunEvent[]>(initialEvents);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [approvalsBusy, setApprovalsBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const projection = useMemo(() => projectRun(events, run.id), [events, run.id]);
  const metrics = useMemo(() => computeMetrics(projection), [projection]);
  const activity = useMemo(() => buildActivity(events), [events]);
  const status = events.length > 0 ? projection.status : (run.status as typeof projection.status);
  const live = !TERMINAL.has(status);
  const agentName = (id: string | null) =>
    id ? (agents.find((agent) => agent.id === id)?.name ?? id) : "run";

  useEffect(() => {
    const since = initialEvents.length ? (initialEvents[initialEvents.length - 1]?.seq ?? -1) : -1;
    const source = new EventSource(`/api/runs/${run.id}/stream?since=${since}`);

    const onEvent = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as RunEvent;
        setEvents((current) =>
          current.some((existing) => existing.seq === event.seq)
            ? current
            : [...current, event].sort((a, b) => a.seq - b.seq),
        );
      } catch {
        // A malformed frame is ignored; the log itself stays authoritative.
      }
    };

    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("run-event", onEvent as EventListener);
    source.addEventListener("ready", () => setConnected(true));
    source.addEventListener("end", () => {
      setConnected(false);
      source.close();
      router.refresh();
    });
    source.addEventListener("error", () => setConnected(false));

    return () => {
      source.close();
      setConnected(false);
    };
    // The `since` cursor is fixed at mount; replay dedupes by seq.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  useEffect(() => {
    if (!follow) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [activity.length, follow]);

  const visible = activity.filter((item) => {
    if (filter !== "all" && item.kind !== filter) return false;
    if (agentFilter && item.agentId && item.agentId !== agentFilter) return false;
    return true;
  });

  const pendingApprovals = [...projection.approvals.values()].filter(
    (approval) => approval.status === "pending",
  );

  async function decide(approvalId: string, decision: "approved" | "denied") {
    setApprovalsBusy((current) => ({ ...current, [approvalId]: true }));
    setError(null);
    try {
      const response = await fetch(`/api/approvals/${approvalId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          note:
            decision === "approved"
              ? "Scoped to the run; proceed."
              : "Denied from the run trace.",
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? `Decision failed (HTTP ${response.status}).`);
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setApprovalsBusy((current) => ({ ...current, [approvalId]: false }));
    }
  }

  const budgetUsed = projection.budgetUsd > 0 ? projection.costUsd / projection.budgetUsd : 0;

  return (
    <div className="space-y-4">
      {/* Header ------------------------------------------------------------- */}
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="mono flex items-center gap-2 text-[10px] text-ink-4">
              <Link href="/runs" className="hover:text-ink-2">
                runs
              </Link>
              <span>/</span>
              <span>{run.id}</span>
              <span>·</span>
              <span>{run.mode}</span>
              <span>·</span>
              <span>{run.trigger ?? "manual"}</span>
            </div>
            <h1 className="mt-1.5 max-w-3xl text-[16px] font-medium leading-snug text-ink">
              {projection.goal ?? run.goal}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                "mono flex items-center gap-1 text-[10px]",
                connected ? "text-accent" : "text-ink-4",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  live ? (connected ? "animate-pulse-dot bg-accent" : "bg-warn") : "bg-ink-4",
                )}
              />
              {live ? (connected ? "streaming" : "reconnecting") : "closed"}
            </span>
            <StatusBadge status={status} />
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
          <div className="p-3.5">
            <Metric label="Cost / ceiling" value={usd(projection.costUsd, { precise: true })} />
            <Meter
              value={budgetUsed}
              tone={budgetUsed > 0.9 ? "danger" : budgetUsed > 0.7 ? "warn" : "accent"}
              className="mt-2"
              label="Run budget used"
            />
            <div className="mono mt-1 text-[9.5px] text-ink-4">
              of {usd(projection.budgetUsd)}
            </div>
          </div>
          <div className="p-3.5">
            <Metric
              label="Tokens"
              value={tokens(projection.inputTokens + projection.outputTokens)}
              sub={`${tokens(projection.inputTokens)} in / ${tokens(projection.outputTokens)} out`}
            />
          </div>
          <div className="p-3.5">
            <Metric
              label="Duration"
              value={
                projection.endedAt
                  ? duration(
                      new Date(projection.endedAt).getTime() -
                        new Date(projection.startedAt ?? run.startedAt).getTime(),
                    )
                  : "running"
              }
              sub={`started ${relativeTime(projection.startedAt ?? run.startedAt)}`}
            />
          </div>
          <div className="p-3.5">
            <Metric
              label="Tool calls"
              value={String(metrics.toolCalls)}
              sub={`${pct(metrics.toolFailureRate)} failed`}
              tone={metrics.toolFailureRate > 0.2 ? "warn" : "default"}
            />
          </div>
          <div className="p-3.5">
            <Metric
              label="Human interventions"
              value={String(metrics.approvalsRequested)}
              sub={`${pct(metrics.interventionRate)} of tool calls`}
              tone={metrics.approvalsRequested > 0 ? "warn" : "default"}
            />
          </div>
          <div className="p-3.5">
            <Metric
              label="Findings"
              value={String(metrics.findings)}
              sub={`${metrics.criticalFindings} critical`}
              tone={metrics.findings > 0 ? "danger" : "default"}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-void/40 px-4 py-2">
          <div className="mono flex flex-wrap items-center gap-2 text-[10px] text-ink-4">
            <span className={chain.valid ? "text-ok" : "text-danger"}>
              {chain.valid ? "hash chain verified" : `chain broken at ${chain.brokenAt}`}
            </span>
            <span>·</span>
            <span>{chain.checked} events at load</span>
            <span>·</span>
            <span>{events.length} now</span>
            <span>·</span>
            <button
              type="button"
              onClick={() => setRawOpen((open) => !open)}
              className="focus-ring text-ink-3 underline decoration-line-strong underline-offset-2 hover:text-ink"
            >
              {rawOpen ? "hide raw" : "raw events"}
            </button>
          </div>
          {run.summary ? <span className="mono text-[10px] text-ink-4">{run.id}</span> : null}
        </div>
      </Panel>

      {error ? (
        <p className="rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
          {error}
        </p>
      ) : null}

      {pendingApprovals.length > 0 ? (
        <div className="space-y-2">
          {pendingApprovals.map((approval) => (
            <Panel
              key={approval.id}
              className="border-warn/40 bg-warn/[0.04] p-3"
              role="alert"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Lock size={12} className="text-warn" />
                    <span className="text-[12px] font-medium text-ink">
                      {agentName(approval.agentId)} is blocked on {approval.resource}
                    </span>
                    <RiskTag risk={approval.risk} />
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-2">{approval.reason}</p>
                  <div className="mono mt-1 text-[10px] text-ink-4">
                    call {approval.callId ?? "—"} · scopes {approval.scopes.join(", ")}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={approvalsBusy[approval.id]}
                    onClick={() => decide(approval.id, "denied")}
                  >
                    <X size={12} /> Deny
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={approvalsBusy[approval.id]}
                    onClick={() => decide(approval.id, "approved")}
                  >
                    {approvalsBusy[approval.id] ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Check size={12} />
                    )}
                    Approve for this run
                  </Button>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Timeline --------------------------------------------------------- */}
        <Panel className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div className="flex flex-wrap items-center gap-1">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    "focus-ring rounded-xs px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors",
                    filter === item.id
                      ? "bg-surface-3 text-ink"
                      : "text-ink-4 hover:bg-surface-2 hover:text-ink-2",
                  )}
                >
                  {item.label}
                  <span className="ml-1 text-ink-4">
                    {item.id === "all"
                      ? activity.length
                      : activity.filter((entry) => entry.kind === item.id).length}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {agentFilter ? (
                <button
                  type="button"
                  onClick={() => setAgentFilter(null)}
                  className="focus-ring mono flex items-center gap-1 rounded-xs border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9.5px] text-accent"
                >
                  {agentName(agentFilter)} <X size={9} />
                </button>
              ) : null}
              <label className="mono flex cursor-pointer items-center gap-1 text-[9.5px] text-ink-4">
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(event) => setFollow(event.target.checked)}
                  className="accent-accent"
                />
                follow
              </label>
            </div>
          </div>

          <div
            ref={scrollRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
              if (!atBottom && follow) setFollow(false);
            }}
            className="max-h-[640px] overflow-y-auto"
          >
            {visible.length === 0 ? (
              <EmptyState
                icon={live ? <Loader2 size={18} className="animate-spin" /> : <Activity size={18} />}
                title={live ? "Waiting for the first event" : "No events in this view"}
                description={
                  live
                    ? "The engine writes each step to the append-only log before it reaches this page."
                    : "Try another filter or clear the agent selection."
                }
              />
            ) : (
              <ol className="divide-y divide-line/60">
                {visible.map((item) => {
                  const Icon = item.icon;
                  const isOpen = expanded === item.seq;
                  return (
                    <li key={item.seq} className="group">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : item.seq)}
                        className="focus-ring flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-surface-2/50"
                      >
                        <span className="mono mt-0.5 w-10 shrink-0 text-[9.5px] text-ink-4">
                          {String(item.seq).padStart(3, "0")}
                        </span>
                        <Icon
                          size={12}
                          className={cn(
                            "mt-0.5 shrink-0",
                            TONE_TEXT[item.tone ?? "muted"] ?? "text-ink-3",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span
                              className={cn(
                                "min-w-0 truncate text-[11.5px]",
                                item.kind === "messages" ? "whitespace-normal text-ink-2" : "text-ink",
                                item.title.startsWith("requested ") && "mono",
                              )}
                            >
                              {item.title}
                            </span>
                            <span className="mono shrink-0 text-[9px] text-ink-4">
                              {clockTime(item.ts)}
                            </span>
                          </span>
                          {item.detail ? (
                            <span
                              className={cn(
                                "mt-0.5 block text-[10.5px] leading-relaxed text-ink-3",
                                item.kind === "messages" ? "line-clamp-2" : "truncate",
                              )}
                            >
                              {item.detail}
                            </span>
                          ) : null}
                          <span className="mono mt-0.5 flex items-center gap-2 text-[9px] text-ink-4">
                            <span>{agentName(item.agentId)}</span>
                            {item.mono ? (
                              <>
                                <span className="text-line-strong">·</span>
                                <span>{item.mono}</span>
                              </>
                            ) : null}
                          </span>
                        </span>
                        <ChevronDown
                          size={11}
                          className={cn(
                            "mt-1 shrink-0 text-ink-4 transition-transform",
                            isOpen && "rotate-180",
                          )}
                        />
                      </button>
                      {isOpen && item.expansion ? (
                        <pre className="mono mx-3 mb-2 max-h-64 overflow-auto rounded-xs border border-line bg-void p-2 text-[10px] leading-relaxed text-ink-2">
                          {item.expansion}
                        </pre>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </Panel>

        {/* Lanes + summary --------------------------------------------------- */}
        <div className="space-y-4">
          <Panel>
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="panel-title">Agents in this run</span>
              <span className="mono text-[10px] text-ink-4">{projection.agents.size}</span>
            </div>
            <ul className="divide-y divide-line">
              {[...projection.agents.values()].map((agent) => {
                const active = agentFilter === agent.id;
                return (
                  <li key={agent.id}>
                    <button
                      type="button"
                      onClick={() => setAgentFilter(active ? null : agent.id)}
                      className={cn(
                        "focus-ring flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left transition-colors",
                        active ? "bg-surface-2" : "hover:bg-surface-2/60",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[11.5px] text-ink">{agent.name}</span>
                          <Tag
                            tone={
                              agent.role === "orchestrator"
                                ? "accent"
                                : agent.role === "security"
                                  ? "audit"
                                  : "muted"
                            }
                          >
                            {agent.role}
                          </Tag>
                        </span>
                        <span className="mono mt-0.5 block truncate text-[9.5px] text-ink-4">
                          {agent.model}
                        </span>
                        <span className="mono mt-1 flex items-center gap-2 text-[9.5px] text-ink-4">
                          <span>{usd(agent.costUsd, { precise: true })}</span>
                          <span>·</span>
                          <span>{tokens(agent.promptTokens + agent.completionTokens)} tok</span>
                          <span>·</span>
                          <span>{agent.messages} msg</span>
                        </span>
                      </span>
                      <StatusBadge status={agent.status} />
                    </button>
                    <div className="px-3 pb-2">
                      <Meter
                        value={
                          projection.costUsd > 0 ? agent.costUsd / projection.costUsd : 0
                        }
                        tone={agent.role === "security" ? "audit" : "accent"}
                        label={`${agent.name} share of run cost`}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel>
            <div className="border-b border-line px-3 py-2">
              <span className="panel-title">Tasks</span>
            </div>
            {projection.tasks.size === 0 ? (
              <p className="px-3 py-3 text-[11px] text-ink-4">
                No delegated tasks. The root executed directly.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {[...projection.tasks.values()].map((task) => (
                  <li key={task.id} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[11.5px] leading-snug text-ink-2">{task.title}</span>
                      <StatusBadge status={task.status} />
                    </div>
                    <div className="mono mt-1 flex items-center gap-2 text-[9.5px] text-ink-4">
                      <span>{task.id}</span>
                      <span>·</span>
                      <span>{agentName(task.agentId)}</span>
                    </div>
                    {task.note ? (
                      <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-ink-4">
                        {task.note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {projection.memories.length > 0 ? (
            <Panel>
              <div className="border-b border-line px-3 py-2">
                <span className="panel-title">Memory written</span>
              </div>
              <ul className="divide-y divide-line">
                {projection.memories.map((memory) => (
                  <li key={memory.seq} className="px-3 py-2.5">
                    <div className="mono text-[9.5px] uppercase tracking-[0.08em] text-ink-4">
                      {memory.kind} · {memory.scope}
                    </div>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-2">
                      {memory.content}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {projection.findings.length > 0 ? (
            <Panel className="border-danger/30">
              <div className="border-b border-line px-3 py-2">
                <span className="panel-title text-danger">Findings from this run</span>
              </div>
              <ul className="divide-y divide-line">
                {projection.findings.map((finding) => (
                  <li key={finding.id} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[11.5px] leading-snug text-ink">{finding.title}</span>
                      <RiskTag risk={finding.severity} />
                    </div>
                    <p className="mt-1 line-clamp-3 text-[10.5px] leading-relaxed text-ink-3">
                      {finding.detail}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel>
            <div className="border-b border-line px-3 py-2">
              <span className="panel-title">Governance</span>
            </div>
            <div className="space-y-2 px-3 py-3 text-[11px] text-ink-3">
              <div className="flex items-center justify-between">
                <span>Approvals requested</span>
                <span className="mono text-ink-2">{metrics.approvalsRequested}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Denied by a human</span>
                <span className="mono text-ink-2">{metrics.approvalsDenied}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Data class</span>
                <span className="mono text-ink-2">{projection.dataClass ?? run.dataClass}</span>
              </div>
              <Divider />
              <div className="flex items-center justify-between">
                <span>Chain at load</span>
                <span className={cn("mono", chain.valid ? "text-ok" : "text-danger")}>
                  {chain.valid ? "valid" : `broken@${chain.brokenAt}`}
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="shrink-0">Summary</span>
                <span className="text-right text-[10.5px] leading-relaxed text-ink-2">
                  {projection.summary ?? run.summary ?? "—"}
                </span>
              </div>
              {projection.failureReason ?? run.failureReason ? (
                <p className="rounded-xs border border-danger/30 bg-danger/10 px-2 py-1.5 text-[10.5px] leading-relaxed text-danger">
                  {projection.failureReason ?? run.failureReason}
                </p>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>

      {rawOpen ? (
        <Panel>
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="panel-title">Append-only event log</span>
            <span className="mono text-[10px] text-ink-4">seq · type · hash</span>
          </div>
          <ol className="max-h-80 divide-y divide-line/60 overflow-y-auto">
            {events.map((event) => (
              <li
                key={event.seq}
                className="mono flex items-baseline gap-3 px-3 py-1 text-[10px] text-ink-3"
              >
                <span className="w-10 shrink-0 text-ink-4">
                  {String(event.seq).padStart(3, "0")}
                </span>
                <span className="w-40 shrink-0 text-ink-2">{event.payload.type}</span>
                <span className="min-w-0 flex-1 truncate">{event.hash.slice(0, 24)}…</span>
                <span className="shrink-0 text-ink-4">← {event.prevHash.slice(0, 12)}…</span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
    </div>
  );
}
