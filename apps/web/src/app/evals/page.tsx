import { EvalsView, type SuiteCard, type TemplateGroup } from "@/components/relay/evals";
import { relativeTime } from "@/lib/format";
import { requireWorkspace, listAgents, listEvalSuites, listFindings, listTemplates } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function EvalsPage() {
  const workspace = await requireWorkspace();
  const [suites, agents, findings, templates] = await Promise.all([
    listEvalSuites(workspace.id),
    listAgents(workspace.id),
    listFindings(workspace.id, 200),
    listTemplates(),
  ]);
  const name = new Map(agents.map((a) => [a.id, a.name]));
  const templateName = new Map(templates.map((t) => [t.id, t.name]));
  const agentTemplate = new Map(agents.map((a) => [a.id, a.templateId]));

  const cards: SuiteCard[] = suites.map(({ suite, history }) => {
    const latest = history[0];
    const templateId = agentTemplate.get(suite.agentId) ?? null;
    return {
      id: suite.id,
      name: suite.name,
      description: suite.description,
      agentId: suite.agentId,
      agent: name.get(suite.agentId) ?? "Agent",
      templateId,
      template: templateId ? (templateName.get(templateId) ?? "Template") : "Other agents",
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

  const rollup = (rows: SuiteCard[]) => {
    const ran = rows.filter((c) => c.status !== "never");
    const avg = (pick: (c: SuiteCard) => number) =>
      ran.length ? ran.reduce((sum, c) => sum + pick(c), 0) / ran.length : 0;
    return {
      toolAccuracy: avg((c) => c.toolAccuracy),
      taskSuccess: avg((c) => c.taskSuccess),
      intervention: avg((c) => c.intervention),
    };
  };

  const grouped = new Map<string, TemplateGroup>();
  for (const card of cards) {
    const id = card.templateId ?? "other";
    const existing = grouped.get(id);
    if (existing) {
      existing.suites.push(card);
    } else {
      grouped.set(id, { id, name: card.template, suites: [card], totals: { toolAccuracy: 0, taskSuccess: 0, intervention: 0 } });
    }
  }
  const groups = [...grouped.values()]
    .map((group) => ({ ...group, totals: rollup(group.suites) }))
    .sort((a, b) => {
      if (a.id === "other") return 1;
      if (b.id === "other") return -1;
      return a.name.localeCompare(b.name);
    });

  return (
    <EvalsView
      suites={cards}
      groups={groups}
      totals={rollup(cards)}
      healable={
        findings.filter(
          (f) => (f.status === "open" || f.status === "accepted") && (f.severity === "high" || f.severity === "critical"),
        ).length
      }
    />
  );
}
