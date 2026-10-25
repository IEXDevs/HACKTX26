import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowUpRight,
  Boxes,
  Cpu,
  FileText,
  GitBranch,
  Lock,
  ShieldAlert,
  Terminal,
  Users,
} from "lucide-react";
import {
  MODEL_BY_ID,
  hardwareForComplexity,
  resolvePrompt,
  routeModel,
  type DataClass,
  type TaskComplexity,
} from "@agent-os/core";
import { DispatchPanel } from "@/components/dispatch/dispatch-panel";
import {
  DataTable,
  Divider,
  KeyValue,
  Metric,
  PageHeader,
  Panel,
  PanelHeader,
  RiskTag,
  RoleTag,
  StatusBadge,
  Tag,
  Td,
  Th,
  Tr,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { duration, relativeTime, tokens, usd } from "@/lib/format";
import { getAgentDetail, getWorkspaceContext, listBudgetPolicies } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAgentDetail(id);
  if (!detail) notFound();

  const { agent, parent, children, blocks, runs, suites, findings, triggers, budget } = detail;
  const ctx = await getWorkspaceContext();
  const policies = await listBudgetPolicies(agent.workspaceId);

  const config = {
    ...agent,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
  const prompt = resolvePrompt(config, blocks);

  let routing: ReturnType<typeof routeModel> | null = null;
  let routingError: string | null = null;
  try {
    routing = routeModel({
      complexity: agent.complexity as TaskComplexity,
      dataClass: agent.dataClass as DataClass,
      requiredCapabilities: ["tool_calling"],
      estimatedInputTokens: Math.max(3_000, Math.ceil((prompt.text.length + agent.summary.length) / 4) + 2_000),
      estimatedOutputTokens: 900,
      costSensitivity: agent.modelPolicy.costSensitivity,
      latencySensitivity: agent.modelPolicy.latencySensitivity,
      pinnedModelId:
        agent.modelPolicy.mode === "pinned"
          ? (agent.modelPolicy.pinnedModelId ?? undefined)
          : undefined,
      deniedModelIds: agent.modelPolicy.deniedModelIds,
    });
  } catch (error) {
    routingError = (error as Error).message;
  }

  const openFindings = findings.filter((finding) => finding.status === "open");
  const hardware = hardwareForComplexity(agent.complexity as TaskComplexity);
  const totalCost = runs.reduce((sum, run) => sum + run.costUsd, 0);
  const totalTokens = runs.reduce((sum, run) => sum + run.inputTokens + run.outputTokens, 0);
  const latestRun = runs[0] ?? null;
  const runPolicy = policies.find(
    (policy) => policy.agentId === agent.id && policy.period === "run",
  );
  const dayPolicy = policies.find((policy) => policy.agentId === null && policy.period === "day");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${agent.role} · ${agent.id} · v${agent.version}`}
        title={agent.name}
        description={agent.summary}
        actions={
          <>
            <Link
              href={`/agents/${agent.id}/console`}
              className="focus-ring"
            >
              <span className="inline-flex h-8 items-center gap-2 rounded-sm border border-line-strong bg-surface-2 px-3 text-[12px] text-ink hover:bg-surface-3">
                <Terminal size={12} /> Console
              </span>
            </Link>
            {parent ? (
              <Link href={`/agents/${parent.id}`} className="focus-ring">
                <span className="inline-flex h-8 items-center gap-2 rounded-sm border border-line-strong bg-surface-2 px-3 text-[12px] text-ink hover:bg-surface-3">
                  <Users size={12} /> {parent.name}
                </span>
              </Link>
            ) : null}
            <Link
              href="/graph"
              className="focus-ring mono flex items-center gap-1 text-[10px] text-accent hover:text-accent/80"
            >
              graph <ArrowUpRight size={10} />
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-5">
        {[
          {
            label: "Runs recorded",
            value: String(runs.length),
            sub: latestRun ? `last ${relativeTime(latestRun.startedAt)}` : "never dispatched",
            icon: GitBranch,
          },
          {
            label: "Spend",
            value: usd(totalCost, { precise: true }),
            sub: `${tokens(totalTokens)} tokens`,
            icon: Cpu,
          },
          {
            label: "Open findings",
            value: String(openFindings.length),
            sub: `${findings.length} ever raised`,
            icon: ShieldAlert,
            tone: openFindings.length > 0 ? ("danger" as const) : ("default" as const),
          },
          {
            label: "Capabilities",
            value: String(agent.allowedTools.length),
            sub: `${agent.grants.length} standing grants`,
            icon: Lock,
          },
          {
            label: "Eval suites",
            value: String(suites.length),
            sub: suites.length ? "trace-scored" : "no coverage",
            icon: FileText,
            tone: suites.length ? ("default" as const) : ("warn" as const),
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-surface p-4">
              <div className="flex items-start justify-between">
                <Metric
                  label={item.label}
                  value={item.value}
                  sub={item.sub}
                  tone={item.tone ?? "default"}
                />
                <Icon size={14} className="mt-0.5 text-ink-4" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <Panel className="min-w-0">
          <PanelHeader
            title="Resolved prompt stack"
            hint={`${prompt.blocks.length} inherited block${prompt.blocks.length === 1 ? "" : "s"} + agent instructions`}
            actions={
              <Link href="/policy" className="focus-ring micro text-accent">
                policy
              </Link>
            }
          />
          <div className="border-b border-line bg-void/40 px-4 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {prompt.blocks.map((block) => (
                <Tag
                  key={block.id}
                  tone={block.level === "org" ? "warn" : block.level === "team" ? "info" : "muted"}
                >
                  {block.level} · {block.name}
                </Tag>
              ))}
              {prompt.blocks.length === 0 ? (
                <span className="mono text-[9.5px] text-warn">
                  no inherited company policy — unusual for an active agent
                </span>
              ) : null}
            </div>
          </div>
          <pre className="mono max-h-[340px] overflow-auto whitespace-pre-wrap px-4 py-3 text-[10.5px] leading-relaxed text-ink-2">
            {prompt.text}
          </pre>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title="Model routing"
              hint="Computed from the same pure router the runtime calls"
            />
            <div className="p-4">
              {routing ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono truncate text-[11.5px] text-accent">
                      {routing.chosenModel}
                    </span>
                    <Tag tone="muted">
                      {MODEL_BY_ID.get(routing.chosenModel)?.tier ?? "custom"}
                    </Tag>
                  </div>
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">
                    {routing.reason}
                  </p>
                  <KeyValue label="Estimated cost">
                    {usd(routing.estimatedCostUsd, { precise: true })}
                  </KeyValue>
                  <KeyValue label="Candidates considered">
                    {routing.candidates.length}
                  </KeyValue>
                  <KeyValue label="Hardware envelope">
                    <span className="flex items-center justify-end gap-1">
                      <Tag tone={hardware.tier === "heavy" ? "audit" : "muted"}>
                        {hardware.tier}
                      </Tag>
                      <span className="mono text-[10px] text-ink-3">{hardware.label}</span>
                    </span>
                  </KeyValue>
                  <Divider className="my-2" />
                  <div className="space-y-1">
                    {routing.candidates
                      .slice()
                      .sort((a, b) => b.score - a.score)
                      .slice(0, 5)
                      .map((candidate) => (
                        <div
                          key={candidate.model}
                          className="flex items-center justify-between gap-2"
                        >
                          <span
                            className={cn(
                              "mono truncate text-[9.5px]",
                              candidate.rejectedReason ? "text-ink-4" : "text-ink-2",
                            )}
                          >
                            {candidate.model}
                          </span>
                          <span className="mono shrink-0 text-[9px] text-ink-4">
                            {candidate.rejectedReason
                              ? candidate.rejectedReason
                              : candidate.score.toFixed(3)}
                          </span>
                        </div>
                      ))}
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-danger">{routingError}</p>
              )}
            </div>
            <div className="border-t border-line px-4 py-2 text-[10px] leading-relaxed text-ink-4">
              Policy: {agent.modelPolicy.mode}
              {agent.modelPolicy.mode === "pinned"
                ? ` → ${agent.modelPolicy.pinnedModelId}`
                : ` · ${agent.complexity} floor · cost ${agent.modelPolicy.costSensitivity.toFixed(2)} / latency ${agent.modelPolicy.latencySensitivity.toFixed(2)}`}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Budget" hint="Caps are enforced before each model call" />
            <div className="space-y-1 px-4 py-3">
              <KeyValue label="Run ceiling">
                {runPolicy ? usd(runPolicy.limitUsd) : `${usd(ctx.workspace.defaultRunBudgetUsd)} default`}
              </KeyValue>
              <KeyValue label="Workspace day">
                {dayPolicy ? `${usd(ctx.spendTodayUsd)} / ${usd(dayPolicy.limitUsd)}` : "—"}
              </KeyValue>
              <KeyValue label="Latest run">
                {latestRun ? usd(latestRun.costUsd, { precise: true }) : "—"}
              </KeyValue>
              <KeyValue label="Hard stop">{budget?.hardStop ? "yes" : "no policy"}</KeyValue>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="min-w-0 lg:col-span-2">
          <PanelHeader
            title="Capabilities and grants"
            hint="A grant pre-authorises low/medium risk. High and critical remain per-run decisions."
          />
          <div className="grid gap-px bg-line sm:grid-cols-2">
            <div className="bg-surface p-4">
              <div className="micro mb-2">Allowed tools</div>
              {agent.allowedTools.length === 0 ? (
                <p className="text-[10.5px] text-warn">No tools. The agent cannot act.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {agent.allowedTools.map((tool) => (
                    <span
                      key={tool}
                      className="mono rounded-xs border border-line bg-surface-2 px-1.5 py-0.5 text-[9.5px] text-ink-3"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-surface p-4">
              <div className="micro mb-2">Standing grants</div>
              {agent.grants.length === 0 ? (
                <p className="text-[10.5px] text-ink-4">
                  None. Every call escalates to a human.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {agent.grants.map((grant) => (
                    <li key={grant.resource}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="mono truncate text-[10px] text-ink-2">
                          {grant.resource}
                        </span>
                        <span className="mono shrink-0 text-[9px] text-ink-4">
                          {grant.scopes.join(",")}
                        </span>
                      </div>
                      {grant.constraints?.paths?.length || grant.constraints?.hosts?.length ? (
                        <div className="mono mt-0.5 text-[8.5px] text-ink-4">
                          {[
                            grant.constraints?.paths?.length
                              ? `paths ${grant.constraints.paths.join(", ")}`
                              : null,
                            grant.constraints?.hosts?.length
                              ? `hosts ${grant.constraints.hosts.join(", ")}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="border-t border-line px-4 py-2 text-[10px] leading-relaxed text-ink-4">
            Default deny. A tool must be in the allowed list and pass the policy engine. Security
            agents are structurally denied production credentials.
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Triggers" hint="How this agent starts" />
            {triggers.length === 0 ? (
              <p className="px-4 py-4 text-[10.5px] text-ink-4">
                No triggers. This agent only runs when dispatched manually.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {triggers.map((trigger) => (
                  <li key={trigger.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="mono flex items-center gap-1.5 text-[10.5px] text-ink-2">
                        <span className="text-accent">{trigger.kind}</span>
                        <span className="text-ink-4">·</span>
                        <span className="truncate">
                          {trigger.cron ?? trigger.eventFilter ?? "manual"}
                        </span>
                      </div>
                      <div className="mono mt-0.5 text-[9px] text-ink-4">
                        last fired {relativeTime(trigger.lastFiredAt)}
                      </div>
                    </div>
                    <StatusBadge status={trigger.enabled ? "active" : "paused"} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Reports to"
              hint={parent ? "Delegation edge" : "Root of a crew"}
            />
            <div className="p-4">
              {parent ? (
                <Link
                  href={`/agents/${parent.id}`}
                  className="focus-ring flex items-center gap-2 rounded-xs border border-line bg-surface-2/50 px-2.5 py-2 hover:border-line-strong"
                >
                  <Boxes size={12} className="text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] text-ink">{parent.name}</span>
                    <span className="mono block text-[9px] text-ink-4">{parent.id}</span>
                  </span>
                  <ArrowUpRight size={10} className="text-ink-4" />
                </Link>
              ) : (
                <p className="mono text-[10px] text-ink-4">root orchestrator</p>
              )}

              {children.length > 0 ? (
                <>
                  <Divider className="my-3" />
                  <div className="micro mb-2">Subagents</div>
                  <div className="flex flex-wrap gap-1.5">
                    {children.map((child) => (
                      <Link
                        key={child.id}
                        href={`/agents/${child.id}`}
                        className="focus-ring flex items-center gap-1.5 rounded-xs border border-line px-1.5 py-1 hover:border-line-strong"
                      >
                        <span className="text-[10.5px] text-ink-2">{child.name}</span>
                        <RoleTag role={child.role} />
                      </Link>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          title="Recent runs"
          hint="Newest first. Open one to replay the stream."
          actions={
            <Link href={`/runs?agent=${agent.id}`} className="focus-ring micro text-accent">
              all runs
            </Link>
          }
        />
        <DataTable>
          <thead>
            <tr>
              <Th>Goal</Th>
              <Th className="hidden md:table-cell">Started</Th>
              <Th className="hidden lg:table-cell">Mode</Th>
              <Th align="right">Cost</Th>
              <Th className="hidden sm:table-cell" align="right">
                Duration
              </Th>
              <Th align="right">Status</Th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <Tr>
                <Td className="px-3 py-8 text-center text-[11px] text-ink-4">
                  No runs yet. Dispatch this agent below to produce a trace.
                </Td>
              </Tr>
            ) : (
              runs.map((run) => (
                <Tr key={run.id}>
                  <Td className="max-w-[420px]">
                    <Link href={`/runs/${run.id}`} className="focus-ring block truncate text-[11.5px] text-ink hover:text-accent">
                      {run.goal}
                    </Link>
                    <div className="mono mt-0.5 text-[9px] text-ink-4">{run.id}</div>
                  </Td>
                  <Td className="mono hidden text-[10px] text-ink-3 md:table-cell">
                    {relativeTime(run.startedAt)}
                  </Td>
                  <Td className="mono hidden text-[10px] text-ink-3 lg:table-cell">
                    {run.mode}
                  </Td>
                  <Td align="right" className="mono text-[10.5px] text-ink-2">
                    {usd(run.costUsd, { precise: true })}
                  </Td>
                  <Td align="right" className="mono hidden text-[10px] text-ink-3 sm:table-cell">
                    {duration(run.endedAt ? run.endedAt.getTime() - run.startedAt.getTime() : null)}
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="min-w-0">
          <PanelHeader
            title="Findings against this agent"
            hint="Red-team probes that targeted this node"
            actions={
              <Link href="/security" className="focus-ring micro text-accent">
                queue
              </Link>
            }
          />
          {findings.length === 0 ? (
            <p className="px-4 py-6 text-center text-[10.5px] text-ink-4">
              No findings target this agent.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {findings.slice(0, 6).map((finding) => (
                <li key={finding.id} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] leading-snug text-ink-2">{finding.title}</span>
                    <RiskTag risk={finding.severity} />
                  </div>
                  <div className="mono mt-1 flex items-center gap-2 text-[9px] text-ink-4">
                    <StatusBadge status={finding.status} />
                    <span>{finding.category.replaceAll("_", " ")}</span>
                    <span>·</span>
                    <Link
                      href={`/runs/${finding.runId}`}
                      className="focus-ring text-accent hover:text-accent/80"
                    >
                      {finding.runId}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="min-w-0">
          <PanelHeader title="Eval coverage" hint="Suites that score this agent's traces" />
          {suites.length === 0 ? (
            <p className="px-4 py-6 text-center text-[10.5px] text-ink-4">
              No eval suite. This agent is unmeasured.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {suites.map((suite) => (
                <li key={suite.id} className="px-4 py-2.5">
                  <div className="text-[11px] text-ink-2">{suite.name}</div>
                  <div className="mono mt-0.5 text-[9px] text-ink-4">
                    {suite.cases.length} cases · {suite.description}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line px-4 py-2">
            <Link href="/evals" className="focus-ring mono text-[10px] text-accent hover:text-accent/80">
              open evaluations →
            </Link>
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Dispatch"
          hint="Runs real tools in this agent's sandbox; the scripted planner is deterministic"
        />
        <div className="p-4">
          <DispatchPanel
            agents={[
              {
                id: agent.id,
                name: agent.name,
                role: agent.role,
                status: agent.status,
                dataClass: agent.dataClass,
                runBudgetUsd: runPolicy?.limitUsd ?? null,
              },
            ]}
            defaultAgentId={agent.id}
          />
        </div>
      </Panel>
    </div>
  );
}
