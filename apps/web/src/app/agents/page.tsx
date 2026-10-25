import { AgentDashboard } from "@/components/relay/agent-dashboard";
import { requireWorkspace } from "@/lib/queries";
import { homeView } from "@/lib/views";

export default async function AgentsPage() {
  const workspace = await requireWorkspace();
  return <AgentDashboard data={await homeView(workspace.id)} />;
}
