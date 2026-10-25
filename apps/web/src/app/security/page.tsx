import Link from "next/link";
import {
  ArrowUpRight,
  FileWarning,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Swords,
} from "lucide-react";
import { ApprovalInbox, type ApprovalView } from "@/components/security/approval-inbox";
import { FindingsBoard, type FindingView } from "@/components/security/findings-board";
import {
  Divider,
  EmptyState,
  KeyValue,
  Meter,
  Metric,
  PageHeader,
  Panel,
  PanelHeader,
  RoleTag,
  StatusBadge,
  Tag,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { pct, relativeTime } from "@/lib/format";
import {
  getSecuritySummary,
  getWorkspaceContext,
  listAgents,
  listFindings,
  listPendingApprovals,
  listRuns,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const SEVERITY_TONE = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "info",
} as const;

export default async function SecurityPage() {
  const ctx = await getWorkspaceContext();
  const wsId = ctx.workspace.id;

  const [agents, findings, approvals, runs, summary] = await Promise.all([
    listAgents(wsId),
    listFindings(wsId, 200),
    listPendingApprovals(wsId, 20),
    listRuns(wsId, { limit: 200 }),
    getSecuritySummary(wsId),
  ]);

  const agentNames = Object.fromEntries(agents.map((agent) => [agent.id, agent.name]));
  const securityAgents = agents.filter((agent) => agent.role === "security");
  const securityRuns = runs.filter((run) =>
    securityAgents.some((agent) => agent.id === run.agentId),
  );

  const findingViews: FindingView[] = findings.map((finding) => ({
    id: finding.id,
    title: finding.title,
    detail: finding.detail,
    evidence: finding.evidence,
    remediation: finding.remediation,
    severity: finding.severity,
    category: finding.category,
    status: finding.status,
    runId: finding.runId,
    agentId: finding.agentId,
    targetAgentId: finding.targetAgentId,
    createdAt: finding.createdAt.toISOString(),
  }));

  const approvalViews: ApprovalView[] = approvals.map((approval) => ({
    id: approval.id,
    runId: approval.runId,
    agentId: approval.agentId,
    resource: approval.resource,
    scopes: approval.scopes,
    risk: approval.risk,
    reason: approval.reason,
    requestedAt: approval.requestedAt.toISOString(),
  }));

  const categories = [...new Set(findings.map((finding) => finding.category))].map(
    (category) => {
      const rows = findings.filter((finding) => finding.category === category);
      return {
        category,
        total: rows.length,
        open: rows.filter((finding) => finding.status === "open").length,
        worst: rows.some((finding) => finding.severity === "critical")
          ? "critical"
          : rows.some((finding) => finding.severity === "high")
            ? "high"
            : rows.some((finding) => finding.severity === "medium")
              ? "medium"
              : "low",
      };
    },
  );

  const resolved = findings.filter(
    (finding) => finding.status === "fixed" || finding.status === "false_positive",
  ).length;
  const highOpen = findings.filter(
    (finding) =>
      finding.status === "open" &&
      (finding.severity === "high" || finding.severity === "critical"),
  ).length;
  const coverage = findings.length ? resolved / findings.length : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Assure · adversarial testing"
        title="Security posture"
        description="Red-teaming is an agent, not a checklist. It probes retrieval, escalation, and egress paths against real configurations, and every finding carries a reproduction and a remediation."
        actions={
          <Link
            href="/runs?agent=agt_red_team"
            className="focus-ring mono flex items-center gap-1.5 rounded-xs border border-line-strong px-2 py-1 text-[10px] text-ink-2 hover:border-audit/60 hover:text-audit"
          >
            <Swords size={11} /> red team runs
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        {[
          {
            label: "Open findings",
            value: String(summary.open),
            sub: `${summary.total} recorded all time`,
            icon: FileWarning,
            tone: summary.open > 0 ? "danger" : "default",
          },
          {
            label: "High or critical",
            value: String(highOpen),
            sub: `${summary.bySeverity.critical ?? 0} critical · ${summary.bySeverity.high ?? 0} high`,
            icon: ShieldAlert,
            tone: highOpen > 0 ? "danger" : "default",
          },
          {
            label: "Pending approvals",
            value: String(approvals.length),
            sub: "capability requests held by policy",
            icon: ShieldCheck,
            tone: approvals.length > 0 ? "warn" : "default",
          },
          {
            label: "Probes dispatched",
            value: String(securityRuns.length),
            sub: `${securityAgents.length} security agent${securityAgents.length === 1 ? "" : "s"}`,
            icon: Radar,
            tone: "default",
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
                  tone={item.tone === "danger" ? "danger" : item.tone === "warn" ? "warn" : "default"}
                />
                <Icon size={14} className="mt-0.5 text-ink-4" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Panel className="min-w-0">
          <PanelHeader
            title="Approval queue"
            hint="A blocked run is polling for this decision right now"
            actions={
              <span className="mono text-[10px] text-ink-4">{approvals.length} pending</span>
            }
          />
          <ApprovalInbox approvals={approvalViews} agentNames={agentNames} />
        </Panel>

        <div className="space-y-6">
          <Panel className="self-start">
            <PanelHeader
              title="Red team"
              hint="The adversarial agent in this workspace"
              actions={<Swords size={13} className="text-audit" />}
            />
            {securityAgents.length === 0 ? (
              <EmptyState
                icon={<Swords size={18} />}
                title="No security agent"
                description="Add one from the builder so the platform can attack itself on a schedule."
                action={
                  <Link href="/build" className="focus-ring micro text-accent">
                    open builder
                  </Link>
                }
              />
            ) : (
              securityAgents.map((agent) => {
                const agentRuns = runs.filter((run) => run.agentId === agent.id);
                const latest = agentRuns[0];
                const found = findings.filter((finding) => finding.agentId === agent.id);
                return (
                  <div key={agent.id}>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/agents/${agent.id}`}
                            className="focus-ring text-[13px] text-ink hover:text-audit"
                          >
                            {agent.name}
                          </Link>
                          <div className="mt-1 flex items-center gap-2">
                            <RoleTag role={agent.role} />
                            <StatusBadge status={agent.status} />
                            <Tag tone="audit">{agent.modelPolicy.floorComplexity} floor</Tag>
                          </div>
                        </div>
                        <Link
                          href={`/agents/${agent.id}/console`}
                          className="focus-ring micro shrink-0 text-accent"
                        >
                          console
                        </Link>
                      </div>
                      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                        {agent.summary}
                      </p>
                      <Divider className="my-3" />
                      <KeyValue label="Probes run">{agentRuns.length}</KeyValue>
                      <KeyValue label="Findings published">{found.length}</KeyValue>
                      <KeyValue label="Open">
                        <span className={found.some((f) => f.status === "open") ? "text-warn" : ""}>
                          {found.filter((finding) => finding.status === "open").length}
                        </span>
                      </KeyValue>
                      <KeyValue label="Last probe">
                        {latest ? relativeTime(latest.startedAt) : "never"}
                      </KeyValue>
                      <KeyValue label="Data class">
                        <span className="mono">{agent.dataClass}</span>
                      </KeyValue>
                    </div>
                    <div className="border-t border-line px-4 py-2.5">
                      <p className="text-[10px] leading-relaxed text-ink-4">
                        Structurally denied production credentials. A refused lease is
                        recorded as evidence, never retried.
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Attack surface" hint="Findings grouped by probe class" />
            <ul className="divide-y divide-line">
              {categories.map((category) => (
                <li key={category.category} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono text-[10.5px] text-ink-2">
                      {category.category.replaceAll("_", " ")}
                    </span>
                    <span className="mono text-[10px] text-ink-4">
                      {category.open} open / {category.total}
                    </span>
                  </div>
                  <Meter
                    value={category.total ? category.open / category.total : 0}
                    tone={SEVERITY_TONE[category.worst as keyof typeof SEVERITY_TONE] ?? "muted"}
                    className="mt-1.5"
                    label={`${category.category} open findings`}
                  />
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
              <div className="p-3">
                <Metric label="Dispositioned" value={pct(coverage)} />
              </div>
              <div className="p-3">
                <Metric
                  label="Open high+"
                  value={String(highOpen)}
                  tone={highOpen > 0 ? "danger" : "default"}
                />
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <Panel>
        <PanelHeader
          title="Findings"
          hint="Severity, reproduction, and remediation — triage is audited"
          actions={
            <span className="mono text-[10px] text-ink-4">
              {findings.filter((finding) => finding.status === "open").length} open
            </span>
          }
        />
        <FindingsBoard findings={findingViews} agentNames={agentNames} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Security-agent runs"
            hint="Every probe is a normal run with a normal trace"
          />
          {securityRuns.length === 0 ? (
            <EmptyState
              icon={<Radar size={18} />}
              title="No probe has been dispatched"
              description="Run the red team to populate this ledger."
            />
          ) : (
            <ul className="divide-y divide-line">
              {securityRuns.slice(0, 6).map((run) => (
                <li key={run.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      run.status === "succeeded"
                        ? "bg-ok"
                        : run.status === "awaiting_approval"
                          ? "bg-warn"
                          : "bg-danger",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/runs/${run.id}`}
                      className="focus-ring block truncate text-[11px] text-ink hover:text-accent"
                    >
                      {run.goal}
                    </Link>
                    <span className="mono mt-0.5 flex items-center gap-1.5 text-[9px] text-ink-4">
                      <span>{agentNames[run.agentId] ?? run.agentId}</span>
                      <span className="text-line-strong">·</span>
                      <span>{relativeTime(run.startedAt)}</span>
                      <span className="text-line-strong">·</span>
                      <span>{run.eventCount} events</span>
                    </span>
                  </div>
                  <StatusBadge status={run.status} />
                  <ArrowUpRight size={10} className="shrink-0 text-ink-4" />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Controls enforced by the runtime"
            hint="Not documentation — these are checks in the execution path"
          />
          <ul className="divide-y divide-line">
            {[
              [
                "Default deny",
                "An agent with no matching grant or rule goes to approval. Nothing is implicitly allowed.",
              ],
              [
                "High and critical are per-run",
                "A standing grant can pre-authorise low and medium risk only. High and critical always block.",
              ],
              [
                "Deny outranks grants",
                "A hard deny rule wins over every grant and every model request, with no override path.",
              ],
              [
                "Path-confined filesystem",
                "Every path is resolved against the agent root; traversal and absolute paths are rejected.",
              ],
              [
                "Secret leases, never values",
                "`secret.use` mints an in-process lease; the plaintext never enters the trace or the model context.",
              ],
              [
                "Budget is a hard stop",
                "The ledger halts the run mid-step rather than letting it overspend, and emits a halt event.",
              ],
            ].map(([title, detail]) => (
              <li key={title} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={12} className="shrink-0 text-ok" />
                  <span className="text-[11.5px] text-ink">{title}</span>
                </div>
                <p className="mt-1 pl-5 text-[10.5px] leading-relaxed text-ink-3">{detail}</p>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-2.5">
            <Link
              href="/policy"
              className="focus-ring micro flex items-center gap-1 text-accent hover:text-accent/80"
            >
              see the rule matrix <ArrowUpRight size={10} />
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}
