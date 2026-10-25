import Link from "next/link";
import { ArrowUpRight, FlaskConical, Gauge, GitBranch, Timer } from "lucide-react";
import { EvalRunner } from "@/components/evals/eval-runner";
import { AutoHealPanel } from "@/components/evals/auto-heal-panel";
import {
  EmptyState,
  Metric,
  PageHeader,
  Panel,
  PanelHeader,
  StatusBadge,
  Tag,
} from "@/components/ui/primitives";
import { pct, relativeTime } from "@/lib/format";
import {
  getWorkspaceContext,
  listAgents,
  listEvalSuites,
  listFindings,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) {
    return <span className="mono text-[9px] text-ink-4">no history</span>;
  }
  const width = 132;
  const height = 30;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => {
    const x = values.length > 1 ? index * step : width / 2;
    const y = height - Math.max(0, Math.min(1, value)) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const thresholdY = height - 0.8 * height;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={`Tool-call accuracy trend: ${values.map((value) => pct(value)).join(" → ")}`}
    >
      <line
        x1={0}
        x2={width}
        y1={thresholdY}
        y2={thresholdY}
        stroke="var(--color-line-strong)"
        strokeDasharray="3 3"
        strokeWidth={1}
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((point, index) => {
        const [x, y] = point.split(",");
        const latest = index === points.length - 1;
        return (
          <circle
            key={point}
            cx={x}
            cy={y}
            r={latest ? 2.4 : 1.4}
            fill={latest ? "var(--color-accent)" : "var(--color-ink-3)"}
          />
        );
      })}
    </svg>
  );
}

export default async function EvalsPage() {
  const ctx = await getWorkspaceContext();
  const wsId = ctx.workspace.id;
  const [suites, agents, findings] = await Promise.all([
    listEvalSuites(wsId),
    listAgents(wsId),
    listFindings(wsId, 100),
  ]);

  const healable = findings.filter(
    (finding) =>
      finding.status === "open" &&
      (finding.severity === "critical" || finding.severity === "high"),
  );

  const agentNames = Object.fromEntries(agents.map((agent) => [agent.id, agent.name]));
  const latest = suites
    .map((entry) => entry.history[0])
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const avgToolAccuracy = latest.length
    ? latest.reduce((sum, row) => sum + row.toolCallAccuracy, 0) / latest.length
    : 0;
  const avgSuccess = latest.length
    ? latest.reduce((sum, row) => sum + row.taskSuccess, 0) / latest.length
    : 0;
  const avgIntervention = latest.length
    ? latest.reduce((sum, row) => sum + row.interventionRate, 0) / latest.length
    : 0;
  const totalCases = suites.reduce((sum, entry) => sum + entry.suite.cases.length, 0);
  const totalRuns = suites.reduce((sum, entry) => sum + entry.history.length, 0);
  const uncovered = agents.filter(
    (agent) => !suites.some((entry) => entry.suite.agentId === agent.id),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Assure · evaluations"
        title="Evals that read the trace"
        description="Scores are computed from recorded runs, not written by hand. Each case is matched to the most similar trace for that agent and checked against the tools the case says are required."
        actions={
          <span className="mono flex items-center gap-1.5 text-[10px] text-ink-4">
            <FlaskConical size={11} /> {suites.length} suites · {totalCases} cases
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        {[
          {
            label: "Tool-call accuracy",
            value: pct(avgToolAccuracy),
            sub: "mean of latest suite run",
            icon: Gauge,
          },
          {
            label: "Task success",
            value: pct(avgSuccess),
            sub: "matched traces that closed clean",
            icon: GitBranch,
          },
          {
            label: "Intervention rate",
            value: pct(avgIntervention),
            sub: "runs that needed a human decision",
            icon: Timer,
          },
          {
            label: "Eval runs",
            value: String(totalRuns),
            sub: `${totalCases - latest.reduce((sum, row) => sum + row.casesPassed, 0)} case${totalCases - latest.reduce((sum, row) => sum + row.casesPassed, 0) === 1 ? "" : "s"} failing now`,
            icon: FlaskConical,
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

      {suites.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<FlaskConical size={22} />}
            title="No eval suites"
            description="An agent without evals cannot regress safely. Create a suite from the builder."
            action={
              <Link href="/build" className="focus-ring micro text-accent">
                open builder
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {suites.map(({ suite, history }) => {
            const latestRun = history[0] ?? null;
            const ascending = [...history].reverse();
            const agent = agents.find((entry) => entry.id === suite.agentId);
            return (
              <Panel key={suite.id} className="flex min-w-0 flex-col">
                <PanelHeader
                  title={
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate">{suite.name}</span>
                      {latestRun ? <StatusBadge status={latestRun.status} /> : <Tag tone="muted">never run</Tag>}
                    </span>
                  }
                  hint={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/agents/${suite.agentId}`}
                        className="focus-ring text-ink-2 hover:text-accent"
                      >
                        {agentNames[suite.agentId] ?? suite.agentId}
                      </Link>
                      <span className="text-line-strong">·</span>
                      <span className="mono">{suite.cases.length} cases</span>
                      <span className="text-line-strong">·</span>
                      <span className="mono">{history.length} runs</span>
                    </span>
                  }
                  actions={
                    <span className="mono text-[9px] text-ink-4">{suite.id}</span>
                  }
                />
                <div className="p-4">
                  <p className="text-[11px] leading-relaxed text-ink-3">{suite.description}</p>

                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div>
                      <div className="micro">Tool accuracy</div>
                      <div className="mono mt-1 text-[15px] text-ink">
                        {latestRun ? pct(latestRun.toolCallAccuracy) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="micro">Task success</div>
                      <div className="mono mt-1 text-[15px] text-ink">
                        {latestRun ? pct(latestRun.taskSuccess) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="micro">Intervention</div>
                      <div className="mono mt-1 text-[15px] text-warn">
                        {latestRun ? pct(latestRun.interventionRate) : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <div className="micro mb-1">Trend · tool accuracy</div>
                      <Sparkline values={ascending.map((row) => row.toolCallAccuracy)} />
                    </div>
                    <div className="text-right">
                      <div className="micro">Cases passed</div>
                      <div className="mono mt-1 text-[13px] text-ink-2">
                        {latestRun
                          ? `${latestRun.casesPassed}/${latestRun.casesTotal}`
                          : `0/${suite.cases.length}`}
                      </div>
                      <div className="mono mt-0.5 text-[9px] text-ink-4">
                        threshold 80%
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="micro mb-1.5">Coverage</div>
                    <div className="flex flex-wrap gap-1">
                      {suite.cases.map((testCase) => (
                        <Tag key={testCase.id} tone="muted">
                          {testCase.name}
                          <span className="text-ink-4">
                            {" · "}
                            {testCase.expectedTools.length}
                          </span>
                        </Tag>
                      ))}
                    </div>
                  </div>
                </div>

                {history.length > 0 ? (
                  <div className="border-t border-line">
                    <div className="micro px-4 pt-3 pb-1">History</div>
                    <ul className="divide-y divide-line/60">
                      {history.slice(0, 4).map((row) => (
                        <li
                          key={row.id}
                          className="flex items-center justify-between gap-2 px-4 py-1.5"
                        >
                          <span className="mono text-[9.5px] text-ink-4">
                            {relativeTime(row.startedAt)}
                          </span>
                          <span className="mono text-[9.5px] text-ink-3">
                            {pct(row.toolCallAccuracy)} · {row.casesPassed}/{row.casesTotal} ·{" "}
                            {pct(row.interventionRate)} intervention
                          </span>
                          {row.runId ? (
                            <Link
                              href={`/runs/${row.runId}`}
                              className="focus-ring mono flex items-center gap-0.5 text-[9px] text-accent"
                            >
                              trace <ArrowUpRight size={8} />
                            </Link>
                          ) : (
                            <span className="mono text-[9px] text-ink-4">—</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-auto">
                  <EvalRunner suiteId={suite.id} />
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <Panel>
        <PanelHeader
          title="Evaluate & auto-heal"
          hint="Turn a red-team finding into a locked company rule, then score the trace again"
          actions={
            <Link href="/security" className="focus-ring micro text-accent">
              findings
            </Link>
          }
        />
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-3">
            <p className="text-[11.5px] leading-relaxed text-ink-2">
              A finding without a landed mitigation is a report, not a fix. Auto-heal synthesizes
              the deterministic boundary implied by the finding, writes it as a locked org prompt
              block, and attaches it to every agent before marking the finding fixed.
            </p>
            <ol className="space-y-2">
              {[
                "Read the highest-severity open finding and its evidence.",
                "Synthesize the matching hard rule (retrieval fencing, egress, escalation, budget).",
                "Write the rule as a locked company block and attach it to every agent.",
                "Mark the finding fixed and record the decision in the audit log.",
                "Re-run the suite: the new trace either respects the rule or it does not.",
              ].map((step, index) => (
                <li key={step} className="flex gap-2 text-[10.5px] leading-relaxed text-ink-3">
                  <span className="mono shrink-0 text-accent">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <div className="mono text-[9.5px] text-ink-4">
              {healable.length} high or critical open finding
              {healable.length === 1 ? "" : "s"} eligible · no schema change
            </div>
          </div>
          <Panel className="self-start bg-void/40">
            <div className="border-b border-line px-3 py-2">
              <span className="panel-title">Guardrail synthesis</span>
            </div>
            <div className="p-3">
              <AutoHealPanel
                findings={healable.map((finding) => ({
                  id: finding.id,
                  title: finding.title,
                  category: finding.category,
                  severity: finding.severity,
                }))}
              />
            </div>
          </Panel>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="How a score is produced"
            hint="No synthetic pass rates"
          />
          <ol className="divide-y divide-line">
            {[
              [
                "Match the case to a trace",
                "The suite case text is tokenised and compared against the goal of every recent run for that agent; the most similar trace wins. No similar trace means the case fails with a reason.",
              ],
              [
                "Compare tool coverage",
                "Tool-call accuracy is the fraction of the case's expected tools that the matched trace actually requested. A tool the model never called is a miss, even if the final answer looked right.",
              ],
              [
                "Task success from run status",
                "Task success is the share of matched traces that closed with `succeeded` — a halted or failed run cannot count as success.",
              ],
              [
                "Intervention from approvals",
                "Intervention rate is the share of the agent's recent runs that opened an approval. It measures how often the guardrails had to stop the run.",
              ],
            ].map(([title, detail], index) => (
              <li key={title} className="flex gap-3 px-4 py-3">
                <span className="mono mt-0.5 text-[9px] text-ink-4">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <div className="text-[11.5px] text-ink">{title}</div>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel>
          <PanelHeader
            title="Coverage gaps"
            hint="Agents that can run but cannot be scored"
            actions={
              <span className="mono text-[10px] text-warn">
                {uncovered.length} uncovered
              </span>
            }
          />
          {uncovered.length === 0 ? (
            <EmptyState
              icon={<Gauge size={18} />}
              title="Every agent is covered"
              description="Each runnable agent has at least one suite that can score its trace."
            />
          ) : (
            <ul className="divide-y divide-line">
              {uncovered.map((agent) => (
                <li key={agent.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-warn"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/agents/${agent.id}`}
                      className="focus-ring block truncate text-[11.5px] text-ink hover:text-accent"
                    >
                      {agent.name}
                    </Link>
                    <span className="mono text-[9px] text-ink-4">
                      {agent.role} · {agent.complexity} · {agent.allowedTools.length} tools
                    </span>
                  </div>
                  <Link
                    href="/build"
                    className="focus-ring mono shrink-0 text-[9px] text-accent"
                  >
                    add suite
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line px-4 py-2.5">
            <p className="text-[10px] leading-relaxed text-ink-4">
              An uncovered agent still runs. It just cannot prove it still works after a
              prompt or model change.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
