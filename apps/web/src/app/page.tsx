import Link from "next/link";
import {
  ArrowUpRight,
  ChevronRight,
  CircleDollarSign,
  Gauge,
  GitBranch,
  ShieldAlert,
  Sparkles,
  Terminal,
} from "lucide-react";
import {
  Avatar,
  Button,
  DataTable,
  Divider,
  EmptyState,
  Meter,
  Metric,
  PageHeader,
  Panel,
  PanelHeader,
  RoleTag,
  StatusBadge,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { duration, pct, relativeTime, tokens, usd } from "@/lib/format";
import {
  getSecuritySummary,
  getWorkspaceContext,
  getWorkspaceStats,
  listAgents,
  listEvalSuites,
  listMemories,
  listPendingApprovals,
  listRuns,
  listTaskLog,
} from "@/lib/queries";

export default async function OverviewPage() {
  const ctx = await getWorkspaceContext();
  const wsId = ctx.workspace.id;

  const [runs, approvals, taskEntries, memories, security, stats, agents, suites] =
    await Promise.all([
      listRuns(wsId, { limit: 7 }),
      listPendingApprovals(wsId, 4),
      listTaskLog(wsId, 5),
      listMemories(wsId, { limit: 5 }),
      getSecuritySummary(wsId),
      getWorkspaceStats(wsId),
      listAgents(wsId),
      listEvalSuites(wsId),
    ]);

  const latestEvalScores = suites
    .map((entry) => entry.history[0])
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const avgToolAccuracy = latestEvalScores.length
    ? latestEvalScores.reduce((sum, row) => sum + row.toolCallAccuracy, 0) / latestEvalScores.length
    : 0;
  const avgIntervention = latestEvalScores.length
    ? latestEvalScores.reduce((sum, row) => sum + row.interventionRate, 0) / latestEvalScores.length
    : 0;

  const orchestrators = agents.filter((a) => a.role === "orchestrator");
  const workers = agents.filter((a) => a.role === "worker");
  const securityAgents = agents.filter((a) => a.role === "security");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Astronom Platform · internal AI"
        title="Workspace overview"
        description="One graph of agents, one event log, one budget. Everything below is derived from the append-only run stream."
        actions={
          <>
            <Link href="/security">
              <Button variant="secondary" size="md">
                <ShieldAlert size={13} />
                Review queue
                {ctx.pendingApprovals > 0 ? (
                  <span className="mono ml-1 rounded-xs bg-warn/20 px-1 text-[10px] text-warn">
                    {ctx.pendingApprovals}
                  </span>
                ) : null}
              </Button>
            </Link>
            <Link href="/build">
              <Button variant="primary" size="md">
                <Sparkles size={13} />
                Build an agent
              </Button>
            </Link>
          </>
        }
      />

      {/* Pulse ---------------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        {[
          {
            label: "Runs · 24h",
            value: String(runs.filter((r) => r.startedAt.getTime() > Date.now() - 86_400_000).length),
            sub: `${stats.totalRuns} all time · ${agents.length} agents`,
            icon: GitBranch,
          },
          {
            label: "Task success",
            value: pct(stats.successRate),
            sub: `${stats.succeededRuns}/${stats.totalRuns} runs closed clean`,
            icon: Gauge,
          },
          {
            label: "Spend today",
            value: usd(ctx.spendTodayUsd),
            sub: `${tokens(stats.totalTokens)} tokens all time`,
            icon: CircleDollarSign,
          },
          {
            label: "Open findings",
            value: String(security.open),
            sub: `${security.bySeverity.high ?? 0} high · ${security.bySeverity.critical ?? 0} critical`,
            icon: ShieldAlert,
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-surface p-4">
              <div className="flex items-start justify-between">
                <Metric label={item.label} value={item.value} sub={item.sub} />
                <Icon size={14} className="mt-0.5 text-ink-4" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        {/* Recent runs ------------------------------------------------------- */}
        <Panel className="min-w-0">
          <PanelHeader
            title="Recent runs"
            hint="Every execution, newest first"
            actions={
              <Link href="/runs" className="focus-ring micro flex items-center gap-1 hover:text-ink-2">
                all runs <ChevronRight size={11} />
              </Link>
            }
          />
          {runs.length === 0 ? (
            <EmptyState
              icon={<Terminal size={20} />}
              title="No runs yet"
              description="Dispatch an agent to see its event stream, cost, and approvals land here."
            />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <Th>Run</Th>
                  <Th className="hidden md:table-cell">Agent</Th>
                  <Th align="right" className="hidden sm:table-cell">Cost</Th>
                  <Th align="right" className="hidden lg:table-cell">Tokens</Th>
                  <Th align="right">Status</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <Tr key={run.id} className="group">
                    <Td className="max-w-[360px]">
                      <Link href={`/runs/${run.id}`} className="block min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[12px] text-ink group-hover:text-accent">
                            {run.goal}
                          </span>
                        </span>
                        <span className="mono mt-1 flex items-center gap-2 text-[10px] text-ink-4">
                          <span>{run.id}</span>
                          <span className="text-line-strong">·</span>
                          <span>{relativeTime(run.startedAt)}</span>
                          <span className="text-line-strong">·</span>
                          <span>{duration(
                            run.endedAt ? run.endedAt.getTime() - run.startedAt.getTime() : null,
                          )}</span>
                          <span className="text-line-strong md:hidden">·</span>
                          <span className="md:hidden">{run.agentName}</span>
                        </span>
                      </Link>
                    </Td>
                    <Td className="hidden max-w-[150px] md:table-cell">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[11px] text-ink-2">{run.agentName}</span>
                        <RoleTag role={run.agentRole} />
                      </span>
                    </Td>
                    <Td align="right" className="mono hidden text-[11px] sm:table-cell">
                      {usd(run.costUsd, { precise: true })}
                    </Td>
                    <Td align="right" className="mono hidden text-[11px] text-ink-3 lg:table-cell">
                      {tokens(run.inputTokens + run.outputTokens)}
                    </Td>
                    <Td align="right">
                      <StatusBadge status={run.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Panel>

        {/* Approval queue ---------------------------------------------------- */}
        <Panel className="min-w-0 self-start">
          <PanelHeader
            title="Waiting on a human"
            hint="Capability requests blocked by policy"
            actions={
              <span className="mono text-[10px] text-ink-4">{approvals.length} pending</span>
            }
          />
          {approvals.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert size={18} />}
              title="Nothing is blocked"
              description="Approval requests appear here the moment an agent asks for a capability above its grants."
            />
          ) : (
            <ul className="divide-y divide-line">
              {approvals.map((approval) => (
                <li key={approval.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "mono text-[10px] uppercase tracking-[0.08em]",
                            approval.risk === "critical" ? "text-danger" : "text-warn",
                          )}
                        >
                          {approval.risk}
                        </span>
                        <span className="mono truncate text-[11px] text-ink">{approval.resource}</span>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-ink-3">
                        {approval.reason}
                      </p>
                    </div>
                    <StatusBadge status={approval.status} />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="mono flex items-center gap-1.5 text-[10px] text-ink-4">
                      {approval.scopes.join(" · ")}
                    </span>
                    <Link
                      href={`/runs/${approval.runId}`}
                      className="focus-ring micro flex items-center gap-1 text-accent hover:text-accent/80"
                    >
                      open run <ArrowUpRight size={10} />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Task log ---------------------------------------------------------- */}
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Workspace task log"
            hint="The durable, human-readable record of what this workspace has done"
            actions={
              <span className="mono text-[10px] text-ink-4">{taskEntries.length} entries</span>
            }
          />
          <ol className="relative px-4 py-2">
            {taskEntries.map((entry, index) => (
              <li key={entry.id} className="relative flex gap-3 py-3">
                <div className="relative flex flex-col items-center">
                  <span
                    className={cn(
                      "mt-1 size-1.5 rounded-full",
                      entry.status === "succeeded"
                        ? "bg-ok"
                        : entry.status === "halted" || entry.status === "failed"
                          ? "bg-danger"
                          : "bg-warn",
                    )}
                  />
                  {index < taskEntries.length - 1 ? (
                    <span className="mt-1 w-px flex-1 bg-line" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/runs/${entry.runId}`}
                      className="focus-ring truncate text-[12px] text-ink hover:text-accent"
                    >
                      {entry.title}
                    </Link>
                    <span className="mono shrink-0 text-[10px] text-ink-4">
                      {relativeTime(entry.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-3">
                    {entry.summary}
                  </p>
                  <div className="mono mt-1.5 flex items-center gap-2 text-[10px] text-ink-4">
                    <span
                      className={cn(
                        "uppercase tracking-[0.08em]",
                        entry.status === "succeeded"
                          ? "text-ok"
                          : entry.status === "halted" || entry.status === "failed"
                            ? "text-danger"
                            : "text-warn",
                      )}
                    >
                      {entry.status}
                    </span>
                    <span className="text-line-strong">·</span>
                    <span>{usd(entry.costUsd, { precise: true })}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        {/* Memory ------------------------------------------------------------ */}
        <Panel>
          <PanelHeader
            title="Memory"
            hint="Durable facts carried into future runs"
            actions={<span className="mono text-[10px] text-ink-4">{memories.length}</span>}
          />
          <ul className="divide-y divide-line">
            {memories.map((memory) => (
              <li key={memory.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                    {memory.kind}
                  </span>
                  <span className="mono text-[10px] text-ink-4">
                    {memory.scope === "workspace" ? "workspace" : "agent"} ·{" "}
                    {memory.importance.toFixed(2)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink-2">
                  {memory.content}
                </p>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-2.5">
            <div className="flex items-center justify-between text-[10px] text-ink-4">
              <span className="mono">recall-weighted eviction</span>
              <span className="mono">retention 90d</span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Topology ---------------------------------------------------------- */}
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Topology"
            hint={`${orchestrators.length} orchestrators · ${workers.length} workers · ${securityAgents.length} security`}
            actions={
              <Link
                href="/graph"
                className="focus-ring micro flex items-center gap-1 text-accent hover:text-accent/80"
              >
                open graph <ArrowUpRight size={10} />
              </Link>
            }
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {orchestrators.map((agent) => {
              const children = agents.filter((a) => a.parentAgentId === agent.id);
              return (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="focus-ring group rounded-sm border border-line bg-surface-2/40 p-3 transition-colors hover:border-line-strong hover:bg-surface-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={agent.name} hue={78} size={22} />
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] text-ink group-hover:text-accent">
                          {agent.name}
                        </span>
                        <span className="block truncate text-[10px] text-ink-4">
                          {agent.modelPolicy.mode === "pinned"
                            ? agent.modelPolicy.pinnedModelId
                            : "auto-routed"}
                        </span>
                      </span>
                    </div>
                    <StatusBadge status={agent.status} />
                  </div>
                  <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-ink-3">
                    {agent.summary}
                  </p>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    {children.slice(0, 4).map((child) => (
                      <span
                        key={child.id}
                        className={cn(
                          "size-1.5 rounded-full",
                          child.role === "security" ? "bg-audit" : "bg-ink-4",
                        )}
                        title={child.name}
                      />
                    ))}
                    <span className="mono ml-1 text-[10px] text-ink-4">
                      {children.length} subagents
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </Panel>

        {/* Security + evals -------------------------------------------------- */}
        <div className="space-y-6">
          <Panel>
            <PanelHeader
              title="Security posture"
              actions={
                <Link href="/security" className="focus-ring micro text-accent">
                  detail
                </Link>
              }
            />
            <div className="space-y-3 p-4">
              {(["critical", "high", "medium", "low"] as const).map((severity) => {
                const count = security.bySeverity[severity] ?? 0;
                const max = Math.max(...Object.values(security.bySeverity), 1);
                return (
                  <div key={severity}>
                    <div className="flex items-center justify-between">
                      <span className="mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                        {severity}
                      </span>
                      <span className="mono text-[11px] text-ink-2">{count}</span>
                    </div>
                    <Meter
                      value={count / max}
                      tone={
                        severity === "critical" || severity === "high"
                          ? "danger"
                          : severity === "medium"
                            ? "warn"
                            : "info"
                      }
                      className="mt-1.5"
                      label={`${severity} findings`}
                    />
                  </div>
                );
              })}
            </div>
            <Divider />
            <div className="grid grid-cols-2 divide-x divide-line">
              <div className="p-3">
                <Metric label="Tool-call accuracy" value={pct(avgToolAccuracy)} />
              </div>
              <div className="p-3">
                <Metric label="Intervention rate" value={pct(avgIntervention)} tone="warn" />
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Graph health" />
            <div className="space-y-2 p-4 text-[11px] text-ink-3">
              <div className="flex items-center justify-between">
                <span>Agents active</span>
                <span className="mono text-ink-2">
                  {agents.filter((a) => a.status === "active").length}/{agents.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Pinned-model agents</span>
                <span className="mono text-ink-2">
                  {agents.filter((a) => a.modelPolicy.mode === "pinned").length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Agents without eval coverage</span>
                <span className="mono text-warn">
                  {agents.filter((a) => !suites.some((s) => s.suite.agentId === a.id)).length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Draft / paused</span>
                <span className="mono text-ink-2">
                  {agents.filter((a) => a.status === "draft" || a.status === "paused").length}
                </span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
