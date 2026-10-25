import { NewWorkflow } from "@/components/relay/new-workflow";
import { MODEL_BY_ID } from "@agent-os/core";
import { listAgents, requireWorkspace } from "@/lib/queries";
import { routedModel } from "@/lib/views";
import type { LibraryAgent } from "@/lib/workflow-selection";

export default async function NewWorkflowPage() {
  const workspace = await requireWorkspace();
  const library: LibraryAgent[] = (await listAgents(workspace.id))
    .filter((agent) => !agent.sourceAgentId && agent.status !== "archived")
    .map((agent) => {
      const model = routedModel(agent, workspace.deniedModelIds);
      const catalog = [...MODEL_BY_ID.values()].find((entry) => entry.label === model);
      return { id: agent.id, name: agent.name, summary: agent.summary, role: agent.role,
        model, modelId: catalog?.id ?? null, provider: catalog?.provider ?? "", complexity: agent.complexity,
        dataClass: agent.dataClass, tools: agent.allowedTools };
    });
  return <NewWorkflow library={library} />;
}
