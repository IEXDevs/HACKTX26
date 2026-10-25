import { workflowGraph } from "@/lib/graph-data";
import { requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspace = await requireWorkspace();
  const snapshot = await workflowGraph(workspace.id, id);
  if (!snapshot) {
    return Response.json({ error: "Workflow not found." }, { status: 404 });
  }
  return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
