import { Workflows } from "@/components/relay/workflows";
import { requireWorkspace } from "@/lib/queries";
import { workflowTiles } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const workspace = await requireWorkspace();
  return <Workflows workflows={await workflowTiles(workspace.id)} />;
}
