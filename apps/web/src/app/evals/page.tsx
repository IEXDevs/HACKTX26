import { EvalsView, type SuiteCard } from "@/components/relay/evals";
import { relativeTime } from "@/lib/format";
import { getWorkspaceContext, listAgents, listEvalSuites, listFindings } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function EvalsPage() {
  const { workspace } = await getWorkspaceContext();
  const [suites, agents, findings] = await Promise.all([
    listEvalSuites(workspace.id),
    listAgents(workspace.id),
    listFindings(workspace.id, 200),
  ]);
  const name = new Map(agents.map((a) => [a.id, a.name]));

  const cards: SuiteCard[] = suites.map(({ suite, history }) => {
    const latest = history[0];
    return {
      id: suite.id,
      name: suite.name,
      description: suite.description,
      agentId: suite.agentId,
      agent: name.get(suite.agentId) ?? "Agent",
      passed: latest?.casesPassed ?? 0,
      total: latest?.casesTotal ?? suite.cases.length,
      status: latest ? (latest.status === "failed" ? "failed" : "passed") : "never",
      when: latest ? `Last run ${relativeTime(latest.startedAt)}` : "Never run",
      accuracy: history
        .slice(0, 8)
        .reverse()
        .map((run) => run.toolCallAccuracy),
      toolAccuracy: latest?.toolCallAccuracy ?? 0,
      taskSuccess: latest?.taskSuccess ?? 0,
      intervention: latest?.interventionRate ?? 0,
      cases: suite.cases.map((c) => c.name),
    };
  });

  const ran = cards.filter((c) => c.status !== "never");
  const avg = (pick: (c: SuiteCard) => number) =>
    ran.length ? ran.reduce((sum, c) => sum + pick(c), 0) / ran.length : 0;

  return (
    <EvalsView
      suites={cards}
      totals={{
        toolAccuracy: avg((c) => c.toolAccuracy),
        taskSuccess: avg((c) => c.taskSuccess),
        intervention: avg((c) => c.intervention),
      }}
      healable={
        findings.filter(
          (f) => (f.status === "open" || f.status === "accepted") && (f.severity === "high" || f.severity === "critical"),
        ).length
      }
    />
  );
}
