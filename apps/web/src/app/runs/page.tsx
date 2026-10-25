import Link from "next/link";
import { ArrowUpRight, CircleDollarSign, Gauge, ListTree, ShieldAlert } from "lucide-react";
import {
  DataTable,
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
import { getWorkspaceContext, listRuns } from "@/lib/queries";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = [
  "all",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "halted",
] as const;

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; agent?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getWorkspaceContext();
  const all = await listRuns(ctx.workspace.id, { limit: 200 });
  const agents = [...new Map(all.map((run) => [run.agentId, run.agentName])).entries()];

  const status = STATUS_FILTERS.includes((query.status ?? "all") as (typeof STATUS_FILTERS)[number])
    ? (query.status ?? "all")
    : "all";
  const runs = all.filter((run) => {
    if (status !== "all" && run.status !== status) return false;
    if (query.agent && run.agentId !== query.agent) return false;
    return true;
  });

  const spent = all.reduce((sum, run) => sum + run.costUsd, 0);
  const succeeded = all.filter((run) => run.status === "succeeded").length;
  const awaiting = all.filter((run) => run.status === "awaiting_approval").length;
  const halted = all.filter((run) => run.status === "halted").length;
  const live = all.filter((run) => run.status === "running" || run.status === "queued").length;

  const href = (next: { status?: string; agent?: string }) => {
    const params = new URLSearchParams();
    const nextStatus = next.status ?? status;
    const nextAgent = next.agent ?? query.agent;
    if (nextStatus && nextStatus !== "all") params.set("status", nextStatus);
    if (nextAgent) params.set("agent", nextAgent);
    const suffix = params.toString();
    return suffix ? `/runs?${suffix}` : "/runs";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Run ledger"
        title="Every execution, replayable"
        description="A run is an append-only event stream with a hash chain. Filters read the same table the trace reducer reads, so nothing here is a cached aggregate."
        actions={
          <span className="mono flex items-center gap-1.5 text-[10px] text-ink-4">
            <ListTree size={11} /> {all.length} runs
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        {[
          { label: "Runs on record", value: String(all.length), sub: `${live} live now`, icon: ListTree },
          {
            label: "Closed clean",
            value: pct(all.length ? succeeded / all.length : 0),
            sub: `${succeeded} succeeded · ${halted} halted`,
            icon: Gauge,
          },
          { label: "Spend", value: usd(spent, { precise: true }), sub: "all recorded runs", icon: CircleDollarSign },
          { label: "Waiting on a human", value: String(awaiting), sub: `${ctx.pendingApprovals} approvals pending`, icon: ShieldAlert },
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

      <Panel>
        <PanelHeader
          title={status === "all" ? "All runs" : `Runs · ${status.replaceAll("_", " ")}`}
          hint="Newest first. Click a row to replay its event stream."
          actions={
            <div className="flex flex-wrap items-center gap-1">
              {STATUS_FILTERS.map((value) => (
                <Link
                  key={value}
                  href={href({ status: value })}
                  className={cn(
                    "focus-ring rounded-xs px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.06em] transition-colors",
                    status === value
                      ? "bg-surface-3 text-ink"
                      : "text-ink-4 hover:bg-surface-2 hover:text-ink-2",
                  )}
                >
                  {value.replaceAll("_", " ")}
                </Link>
              ))}
            </div>
          }
        />

        {agents.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-1.5">
            <span className="micro mr-1">agent</span>
            <Link
              href={href({ agent: "" })}
              className={cn(
                "focus-ring rounded-xs px-1.5 py-0.5 font-mono text-[9.5px]",
                !query.agent ? "bg-surface-3 text-ink" : "text-ink-4 hover:text-ink-2",
              )}
            >
              all
            </Link>
            {agents.map(([id, name]) => (
              <Link
                key={id}
                href={href({ agent: id })}
                className={cn(
                  "focus-ring rounded-xs px-1.5 py-0.5 font-mono text-[9.5px]",
                  query.agent === id ? "bg-surface-3 text-ink" : "text-ink-4 hover:text-ink-2",
                )}
              >
                {name}
              </Link>
            ))}
          </div>
        ) : null}

        <DataTable>
          <thead>
            <tr>
              <Th>Run</Th>
              <Th className="hidden md:table-cell">Agent</Th>
              <Th className="hidden lg:table-cell">Mode</Th>
              <Th className="hidden sm:table-cell" align="right">
                Cost
              </Th>
              <Th className="hidden lg:table-cell" align="right">
                Tokens
              </Th>
              <Th className="hidden sm:table-cell" align="right">
                Duration
              </Th>
              <Th align="right">Status</Th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <Tr>
                <Td className="px-3 py-10 text-center text-[11px] text-ink-4">
                  No runs match this filter.
                </Td>
              </Tr>
            ) : (
              runs.map((run) => (
                <Tr key={run.id} className="group">
                  <Td className="max-w-[420px]">
                    <Link href={`/runs/${run.id}`} className="block min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] text-ink group-hover:text-accent">
                          {run.goal}
                        </span>
                        <ArrowUpRight
                          size={10}
                          className="shrink-0 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      </span>
                      <span className="mono mt-1 flex flex-wrap items-center gap-2 text-[9.5px] text-ink-4">
                        <span>{run.id}</span>
                        <span className="text-line-strong">·</span>
                        <span>{relativeTime(run.startedAt)}</span>
                        <span className="text-line-strong">·</span>
                        <span>{run.dataClass}</span>
                        <span className="text-line-strong">·</span>
                        <span>{run.eventCount} events</span>
                      </span>
                    </Link>
                  </Td>
                  <Td className="hidden max-w-[160px] md:table-cell">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[11px] text-ink-2">{run.agentName}</span>
                      <RoleTag role={run.agentRole} />
                    </span>
                  </Td>
                  <Td className="mono hidden text-[10px] text-ink-3 lg:table-cell">
                    {run.mode}
                  </Td>
                  <Td align="right" className="hidden sm:table-cell">
                    <div className="mono text-[11px] text-ink-2">
                      {usd(run.costUsd, { precise: true })}
                    </div>
                    <Meter
                      value={run.budgetUsd > 0 ? run.costUsd / run.budgetUsd : 0}
                      tone={
                        run.costUsd / Math.max(run.budgetUsd, 0.0001) > 0.9
                          ? "danger"
                          : run.costUsd / Math.max(run.budgetUsd, 0.0001) > 0.7
                            ? "warn"
                            : "accent"
                      }
                      className="ml-auto mt-1 w-16"
                      label={`${run.goal} budget`}
                    />
                  </Td>
                  <Td align="right" className="mono hidden text-[11px] text-ink-3 lg:table-cell">
                    {tokens(run.inputTokens + run.outputTokens)}
                  </Td>
                  <Td align="right" className="mono hidden text-[11px] text-ink-3 sm:table-cell">
                    {duration(
                      run.endedAt ? run.endedAt.getTime() - run.startedAt.getTime() : null,
                    )}
                  </Td>
                  <Td align="right">
                    <StatusBadge status={run.status} />
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </DataTable>
      </Panel>
    </div>
  );
}
