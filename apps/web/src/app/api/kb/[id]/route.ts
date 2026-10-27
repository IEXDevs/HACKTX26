import { NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { removeKbDocument } from "@/lib/runtime/kb";
import { assetFailure, requireAssetAccount } from "@/lib/account-assets";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const account = await requireAssetAccount();
    const { id } = await context.params;
    const removed = await removeKbDocument(account.workspaceId, id, account.accountId);
    if (!removed) return Response.json({ error: "Document not found." }, { status: 404 });

    await writeAudit({
      workspaceId: account.workspaceId,
      actor: account.accountId,
      action: "kb.document_removed",
      targetType: "kb_document",
      targetId: id,
      detail: {},
    });

    return Response.json({ ok: true });
  } catch (error) { return assetFailure(error); }
}
