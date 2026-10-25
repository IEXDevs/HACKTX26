import Link from "next/link";
import {
  ArrowUpRight,
  CircleDollarSign,
  Database,
  Gavel,
  Route,
  ScrollText,
  Wallet,
} from "lucide-react";
import {
  DEFAULT_POLICY_RULES,
  MODEL_CATALOG,
  evaluatePermission,
  type DataClass,
  type Risk,
} from "@agent-os/core";
import {
  DataTable,
  Divider,
  Meter,
  Metric,
  PageHeader,
  Panel,
  PanelHeader,
  RiskTag,
  StatusBadge,
  Tag,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { dateTime, pct, relativeTime, usd } from "@/lib/format";
import {
  getWorkspaceContext,
  getWorkspaceStats,
  listAgents,
  listAuditLog,
  listBudgetPolicies,
  listRuns,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const DATA_CLASSES: DataClass[] = ["public", "internal", "confidential", "restricted"];

const EFFECT_STYLE: Record<string, string> = {
  allow: "text-ok",
  allow_with_log: "text-info",
  require_approval: "text-warn",
  deny: "text-danger",
};

const SAMPLE_REQUESTS: Array<{ resource: string; risk: Risk; scopes: Array<"read" | "write" | "execute" | "net" | "secret"> }> = [
  { resource: "fs.read", risk: "low", scopes: ["read"] },
  { resource: "fs.write", risk: "medium", scopes: ["write"] },
  { resource: "http.fetch", risk: "medium", scopes: ["net", "read"] },
  { resource: "shell.exec", risk: "high", scopes: ["execute"] },
  { resource: "secret.use", risk: "critical", scopes: ["secret"] },
  { resource: "cli:prod-deploy", risk: "high", scopes: ["execute"] },
];

export default async function PolicyPage() {
  const ctx = await getWorkspaceContext();
  const wsId = ctx.workspace.id;

  const [policies, agents, runs, audit, stats] = await Promise.all([
    listBudgetPolicies(wsId),
    listAgents(wsId),
    listRuns(wsId, { limit: 200 }),
    listAuditLog(wsId, 40),
    getWorkspaceStats(wsId),
  ]);

  const agentNames = Object.fromEntries(agents.map((agent) => [agent.id, agent.name]));
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const spendFor = (agentId: string | null, period: "run" | "day" | "month") => {
    const scoped = runs.filter((run) => (agentId ? run.agentId === agentId : true));
    if (period === "month") {
      return scoped
        .filter((run) => run.startedAt.getTime() >= monthStart.getTime())
        .reduce((sum, run) => sum + run.costUsd, 0);
    }
    if (period === "day") return ctx.spendTodayUsd;
    // A per-run policy is visualised against the most recent run it governed.
    return scoped[0]?.costUsd ?? 0;
  };

  const evalRows = SAMPLE_REQUESTS.map((request) => ({
    ...request,
    decision: evaluatePermission(request, DEFAULT_POLICY_RULES),
  }));

  const deniedModels = new Set(ctx.workspace.deniedModelIds);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Build · policy and audit"
        title="Budget, permission, and routing policy"
        description="These are the rules the execution path actually evaluates: the budget ledger, the permission engine, and the model router. Every change to them lands in the audit log."
        actions={
          <span className="mono flex items-center gap-1.5 text-[10px] text-ink-4">
            <Gavel size={11} /> {DEFAULT_POLICY_RULES.length} rules ·{" "}
            {policies.length} budgets
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        {[
          {
            label: "Spend today",
            value: usd(ctx.spendTodayUsd, { precise: true }),
            sub: `${pct(ctx.spendTodayUsd / 40)} of the workspace day ceiling`,
            icon: CircleDollarSign,
          },
          {
            label: "All-time spend",
            value: usd(stats.totalCostUsd),
            sub: `${stats.totalRuns} runs`,
            icon: Wallet,
          },
          {
            label: "Org model denials",
            value: String(deniedModels.size),
            sub: [...deniedModels][0] ?? "none",
            icon: Route,
          },
          {
            label: "Audit entries",
            value: String(audit.length),
            sub: "most recent 40 shown",
            icon: ScrollText,
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

      {/* Budgets ------------------------------------------------------------ */}
      <Panel id="budgets">
        <PanelHeader
          title="Budget policies"
          hint="The ledger checks before each model call; a hard stop halts the run mid-step"
          actions={
            <span className="mono text-[10px] text-ink-4">
              default run ceiling {usd(ctx.workspace.defaultRunBudgetUsd)}
            </span>
          }
        />
        <DataTable>
          <thead>
            <tr>
              <Th>Scope</Th>
              <Th>Period</Th>
              <Th align="right">Limit</Th>
              <Th align="right" className="hidden sm:table-cell">Warn at</Th>
              <Th align="right" className="hidden md:table-cell">Hard stop</Th>
              <Th className="w-[220px]">Observed</Th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => {
              const spent = spendFor(policy.agentId, policy.period);
              const utilization = spent / Math.max(policy.limitUsd, 0.0001);
              const tone =
                utilization >= 1 ? "danger" : utilization >= policy.warnAt ? "warn" : "accent";
              return (
                <Tr key={policy.id}>
                  <Td>
                    {policy.agentId ? (
                      <Link
                        href={`/agents/${policy.agentId}`}
                        className="text-[11.5px] text-ink hover:text-accent"
                      >
                        {agentNames[policy.agentId] ?? policy.agentId}
                      </Link>
                    ) : (
                      <span className="text-[11.5px] text-ink">Workspace</span>
                    )}
                    <div className="mono mt-0.5 text-[9px] text-ink-4">{policy.id}</div>
                  </Td>
                  <Td>
                    <Tag tone={policy.period === "run" ? "muted" : "info"}>
                      {policy.period}
                    </Tag>
                  </Td>
                  <Td align="right" className="mono text-[11px]">
                    {usd(policy.limitUsd)}
                  </Td>
                  <Td align="right" className="mono hidden text-[10px] text-ink-3 sm:table-cell">
                    {pct(policy.warnAt)}
                  </Td>
                  <Td align="right" className="hidden md:table-cell">
                    <span
                      className={cn(
                        "mono text-[9.5px] uppercase tracking-[0.06em]",
                        policy.hardStop ? "text-danger" : "text-ink-4",
                      )}
                    >
                      {policy.hardStop ? "halt" : "warn only"}
                    </span>
                  </Td>
                  <Td>
                    <div className="mono flex items-center justify-between text-[9.5px] text-ink-4">
                      <span>{usd(spent, { precise: true })}</span>
                      <span>{pct(utilization)}</span>
                    </div>
                    <Meter
                      value={utilization}
                      tone={tone}
                      className="mt-1"
                      label={`${policy.period} budget utilization`}
                    />
                    <div className="mono mt-0.5 text-[8.5px] text-ink-4">
                      {policy.period === "run"
                        ? "most recent governed run"
                        : policy.period === "day"
                          ? "workspace spend today"
                          : "spend this calendar month"}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
        <div className="border-t border-line px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] leading-relaxed text-ink-4">
              A workspace day policy caps every agent combined. A per-agent run policy is
              clamped when a run starts — a caller cannot raise it.
            </p>
            <Link href="/runs?status=halted" className="focus-ring micro flex items-center gap-1 text-accent">
              halted runs <ArrowUpRight size={10} />
            </Link>
          </div>
        </div>
      </Panel>

      {/* Rules -------------------------------------------------------------- */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel id="rules" className="min-w-0">
          <PanelHeader
            title="Permission rules"
            hint="Highest priority first. Deny always wins, in every tier."
            actions={
              <span className="mono text-[10px] text-ink-4">
                default-deny below the table
              </span>
            }
          />
          <DataTable>
            <thead>
              <tr>
                <Th>Rule</Th>
                <Th>Resource</Th>
                <Th align="right" className="hidden sm:table-cell">Risk band</Th>
                <Th align="right">Effect</Th>
                <Th align="right" className="hidden md:table-cell">Priority</Th>
              </tr>
            </thead>
            <tbody>
              {[...DEFAULT_POLICY_RULES]
                .sort((a, b) => b.priority - a.priority)
                .map((rule) => (
                  <Tr key={rule.id}>
                    <Td>
                      <div className="mono text-[10.5px] text-ink">{rule.id}</div>
                      {rule.reason ? (
                        <div className="mt-0.5 line-clamp-2 max-w-[320px] text-[10px] leading-relaxed text-ink-4">
                          {rule.reason}
                        </div>
                      ) : null}
                    </Td>
                    <Td className="mono text-[10.5px] text-ink-2">{rule.resource}</Td>
                    <Td align="right" className="hidden sm:table-cell">
                      {rule.risk ? <RiskTag risk={rule.risk} /> : <Tag tone="muted">all</Tag>}
                    </Td>
                    <Td align="right">
                      <span
                        className={cn(
                          "mono text-[9.5px] uppercase tracking-[0.06em]",
                          EFFECT_STYLE[rule.effect],
                        )}
                      >
                        {rule.effect.replaceAll("_", " ")}
                      </span>
                    </Td>
                    <Td align="right" className="mono hidden text-[10px] text-ink-4 md:table-cell">
                      {rule.priority}
                    </Td>
                  </Tr>
                ))}
            </tbody>
          </DataTable>
          <div className="border-t border-line px-4 py-2.5">
            <p className="text-[10px] leading-relaxed text-ink-4">
              Anything with no matching rule and no matching grant resolves to{" "}
              <span className="text-warn">require approval</span> — the platform never
              infers permission from absence of a prohibition.
            </p>
          </div>
        </Panel>

        <Panel className="self-start">
          <PanelHeader
            title="Evaluated against the live engine"
            hint="Same function, same rules, no grants attached"
            actions={<Gavel size={13} className="text-ink-4" />}
          />
          <ul className="divide-y divide-line">
            {evalRows.map((row) => (
              <li key={row.resource} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="mono text-[10.5px] text-ink">{row.resource}</span>
                  <span
                    className={cn(
                      "mono text-[9px] uppercase tracking-[0.06em]",
                      EFFECT_STYLE[row.decision.effect],
                    )}
                  >
                    {row.decision.effect.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="mono mt-0.5 flex items-center gap-1.5 text-[8.5px] text-ink-4">
                  <RiskTag risk={row.risk} />
                  <span className="truncate">{row.decision.reason}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-2.5">
            <p className="text-[10px] leading-relaxed text-ink-4">
              Attaching a standing grant changes only low and medium rows. High and
              critical still block for a human decision.
            </p>
          </div>
        </Panel>
      </div>

      {/* Routing matrix ----------------------------------------------------- */}
      <Panel id="routing">
        <PanelHeader
          title="Data class × model routing"
          hint="The router filters on this matrix before it scores cost or latency"
          actions={<Database size={13} className="text-ink-4" />}
        />
        <DataTable>
          <thead>
            <tr>
              <Th>Model</Th>
              <Th className="hidden sm:table-cell">Tier</Th>
              {DATA_CLASSES.map((dataClass) => (
                <Th key={dataClass} align="right">
                  {dataClass}
                </Th>
              ))}
              <Th align="right" className="hidden lg:table-cell">
                $ / Mtok in → out
              </Th>
            </tr>
          </thead>
          <tbody>
            {MODEL_CATALOG.map((model) => {
              const denied = deniedModels.has(model.id);
              return (
                <Tr key={model.id} className={denied ? "opacity-60" : undefined}>
                  <Td>
                    <div className="mono text-[10.5px] text-ink">{model.id}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-[10px] text-ink-4">{model.label}</span>
                      {model.selfHosted ? <Tag tone="ok">in-VPC</Tag> : null}
                      {denied ? <Tag tone="danger">org denied</Tag> : null}
                    </div>
                  </Td>
                  <Td className="mono hidden text-[10px] text-ink-3 sm:table-cell">
                    {model.tier}
                  </Td>
                  {DATA_CLASSES.map((dataClass) => {
                    const allowed = model.allowedDataClasses.includes(dataClass) && !denied;
                    return (
                      <Td key={dataClass} align="right">
                        <span
                          className={cn(
                            "mono text-[9.5px] uppercase",
                            allowed ? "text-ok" : "text-ink-4",
                          )}
                          title={
                            denied
                              ? "blocked by workspace policy"
                              : allowed
                                ? "approved"
                                : `not approved for ${dataClass}`
                          }
                        >
                          {allowed ? "allowed" : "blocked"}
                        </span>
                      </Td>
                    );
                  })}
                  <Td
                    align="right"
                    className="mono hidden text-[10px] text-ink-3 lg:table-cell"
                  >
                    ${model.inputPerMTok} → ${model.outputPerMTok}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
        <div className="grid gap-0 border-t border-line sm:grid-cols-3">
          <div className="border-b border-line p-3 sm:border-b-0 sm:border-r">
            <Metric label="Workspace default data class" value={ctx.workspace.defaultDataClass} />
          </div>
          <div className="border-b border-line p-3 sm:border-b-0 sm:border-r">
            <Metric
              label="Models approved for restricted"
              value={String(MODEL_CATALOG.filter((model) => model.allowedDataClasses.includes("restricted")).length)}
            />
          </div>
          <div className="p-3">
            <Metric label="Self-hosted options" value={String(MODEL_CATALOG.filter((model) => model.selfHosted).length)} />
          </div>
        </div>
      </Panel>

      {/* Audit -------------------------------------------------------------- */}
      <Panel id="audit">
        <PanelHeader
          title="Audit log"
          hint="Configuration, credential, approval, and triage events — not run execution"
          actions={<ScrollText size={13} className="text-ink-4" />}
        />
        {audit.length === 0 ? (
          <p className="p-4 text-[11px] text-ink-4">No audit entries yet.</p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th className="hidden md:table-cell">Target</Th>
                <Th align="right" className="hidden lg:table-cell">Detail</Th>
              </tr>
            </thead>
            <tbody>
              {audit.map((entry) => (
                <Tr key={entry.id}>
                  <Td className="mono whitespace-nowrap text-[9.5px] text-ink-4">
                    <div>{relativeTime(entry.at)}</div>
                    <div className="text-[8.5px]">{dateTime(entry.at)}</div>
                  </Td>
                  <Td className="text-[10.5px] text-ink-2">{entry.actor}</Td>
                  <Td>
                    <span className="mono text-[10px] text-ink">{entry.action}</span>
                  </Td>
                  <Td className="mono hidden max-w-[220px] truncate text-[9.5px] text-ink-4 md:table-cell">
                    {entry.targetType}
                    <span className="text-line-strong"> · </span>
                    {entry.targetId}
                  </Td>
                  <Td
                    align="right"
                    className="mono hidden max-w-[320px] truncate text-[9px] text-ink-4 lg:table-cell"
                  >
                    {JSON.stringify(entry.detail)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <div className="border-t border-line px-4 py-2.5">
          <p className="text-[10px] leading-relaxed text-ink-4">
            Run execution is <span className="text-ink-2">not</span> in this table. It lives
            in the append-only, hash-chained event stream and is replayed on{" "}
            <Link href="/runs" className="text-accent hover:text-accent/80">
              the run page
            </Link>
            .
          </p>
        </div>
      </Panel>

      <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
        {[
          ["Default-deny", "No rule, no grant → approval required"],
          ["Per-run high risk", "Grants never cover high or critical"],
          ["Hard stop", "Budget halts the run, not the invoice"],
        ].map(([label, detail]) => (
          <div key={label} className="bg-surface p-4">
            <div className="micro">{label}</div>
            <div className="mt-1 text-[11px] text-ink-2">{detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
