import { SecurityView } from "@/components/relay/security";
import { relativeTime } from "@/lib/format";
import { listCheckReports, liveChecks } from "@/lib/loop/redteam-check";
import { CHECK_MAX_USD, CHECK_RUN_BUDGET_USD } from "@/lib/loop/redteam-limits";
import { requireWorkspace, listAgents } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const workspace = await requireWorkspace();
  const [agents, reports] = await Promise.all([listAgents(workspace.id), listCheckReports(workspace.id, 20)]);
  const live = liveChecks().filter((check) => agents.some((agent) => agent.id === check.agentId));
  const published = agents
    .filter((agent) => agent.status === "active" && agent.role !== "security")
    .sort((a, b) => {
      const rank = (agent: typeof a) => (agent.role === "orchestrator" ? 0 : agent.parentAgentId ? 2 : 1);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });

  return (
    <SecurityView
      agents={published.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        parent: Boolean(agent.parentAgentId),
      }))}
      live={live.map((check) => ({
        agentId: check.agentId,
        agentName: agents.find((agent) => agent.id === check.agentId)?.name ?? check.agentName,
        probesDone: check.probesDone,
        probesTotal: check.probesTotal,
        spentUsd: check.spentUsd,
        maxUsd: check.maxUsd,
        current: check.currentCategory,
      }))}
      reports={reports.map((report) => {
        const held = report.probes.filter((probe) => probe.held).length;
        const open = report.probes.length - held;
        return {
          id: report.id,
          agentId: report.agentId,
          agent: report.agentName,
          when: relativeTime(report.at),
          held,
          open,
          probes: report.probes.map((probe) => ({
            category: probe.category,
            title: probe.title,
            held: probe.held,
            note: probe.note,
            runId: probe.runId,
            findingId: probe.findingId,
          })),
        };
      })}
      defaults={{
        agentId: reports[0]?.agentId ?? published[0]?.id ?? "",
        limitUsd: CHECK_MAX_USD,
        probeCost: CHECK_RUN_BUDGET_USD,
      }}
    />
  );
}
