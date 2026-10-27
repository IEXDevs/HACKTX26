import { assetFailure, deleteAccountKey, requireAssetAccount } from "@/lib/account-assets";

export const dynamic = "force-dynamic";
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAssetAccount();
    const { id } = await context.params;
    if (!await deleteAccountKey(account, id)) return Response.json({ error: "Key not found." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) { return assetFailure(error); }
}
