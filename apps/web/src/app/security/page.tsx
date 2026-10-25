import { SecurityView } from "@/components/relay/security";
import { relativeTime } from "@/lib/format";
import {
  getWorkspaceContext,
  listAgents,
  listFindings,
  listPendingApprovals,
  listRuns,
} from "@/lib/queries";
import { askFor } from "@/lib/views";

export const dynamic = "force-dynamic";

const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export default async function SecurityPage() {
  const { workspace } = await getWorkspaceContext();
  const [agents, findings, approvals, runs] = await Promise.all([
    listAgents(workspace.id),
    listFindings(workspace.id, 200),
    listPendingApprovals(workspace.id, 20),
    listRuns(workspace.id, { limit: 500 }),
  ]);
  const name = new Map(agents.map((a) => [a.id, a.name]));
  const checkers = agents.filter((a) => a.role === "security");

  return (
    <SecurityView
      approvals={approvals.map((a) => ({
        id: a.id,
        runId: a.runId,
        ask: askFor(a.resource),
        agent: name.get(a.agentId) ?? "Agent",
        reason: a.reason,
        risk: a.risk,
      }))}
      issues={[...findings]
        .sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9))
        .map((f) => ({
          id: f.id,
          title: f.title,
          detail: f.detail,
          remediation: f.remediation,
          evidence: f.evidence,
          severity: f.severity,
          category: f.category,
          status: f.status,
          agent: name.get(f.targetAgentId ?? f.agentId) ?? "Agent",
          runId: f.runId,
          when: relativeTime(f.createdAt),
        }))}
      probes={runs.filter((r) => checkers.some((c) => c.id === r.agentId)).length}
      checkers={checkers.map((c) => ({ id: c.id, name: c.name, status: c.status }))}
    />
  );
}
