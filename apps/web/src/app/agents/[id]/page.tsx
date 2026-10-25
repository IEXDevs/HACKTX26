import { notFound } from "next/navigation";
import { hardwareForComplexity, type TaskComplexity } from "@agent-os/core";
import { AgentDetail } from "@/components/relay/agent-detail";
import { usd } from "@/lib/format";
import { getAgentDetail, listBudgetPolicies, listRuns } from "@/lib/queries";
import { routedModel, runTile } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getAgentDetail(id);
  if (!detail) notFound();
  const { agent, parent, children, blocks } = detail;
  const [policies, runs] = await Promise.all([
    listBudgetPolicies(agent.workspaceId),
    listRuns(agent.workspaceId, { agentId: agent.id, limit: 10 }),
  ]);
  const runPolicy = policies.find((p) => p.agentId === agent.id && p.period === "run");

  return (
    <AgentDetail
      agent={{
        id: agent.id,
        name: agent.name,
        summary: agent.summary,
        instructions: agent.instructions,
        status: agent.status,
        parent: parent ? { id: parent.id, name: parent.name } : null,
        team: children.map((child) => ({
          id: child.id,
          name: child.name,
          summary: child.summary,
          role: child.role,
          status: child.status,
        })),
        runs: runs.map(runTile),
        advanced: {
          model: routedModel(agent),
          hardware: hardwareForComplexity(agent.complexity as TaskComplexity).label,
          dataClass: agent.dataClass,
          complexity: agent.complexity,
          budget: runPolicy ? usd(runPolicy.limitUsd) : "Workspace default",
          tools: agent.allowedTools,
          grants: agent.grants.map((g) => ({ resource: g.resource, scopes: g.scopes.join(", ") })),
          prompt: blocks
            .filter((b) => agent.inheritedPromptBlockIds.includes(b.id))
            .map((b) => ({ name: b.name, level: b.level, locked: b.locked })),
        },
      }}
    />
  );
}
