import { NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { getWorkspaceUser, requireWorkspace } from "@/lib/queries";
import { removeKbDocument } from "@/lib/runtime/kb";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const workspace = await requireWorkspace();
  const removed = await removeKbDocument(workspace.id, id);
  if (!removed) return Response.json({ error: "Document not found." }, { status: 404 });

  const { user } = await getWorkspaceUser();
  await writeAudit({
    workspaceId: workspace.id,
    actor: user?.email ?? "operator@local",
    action: "kb.document_removed",
    targetType: "kb_document",
    targetId: id,
    detail: {},
  });

  return Response.json({ ok: true });
}
