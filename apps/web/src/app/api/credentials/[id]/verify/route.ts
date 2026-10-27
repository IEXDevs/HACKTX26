import { and, eq } from "drizzle-orm";
import { assetFailure, keyOwner, requireAssetAccount } from "@/lib/account-assets";
import { getDb } from "@/lib/db/client";
import { credentials } from "@/lib/db/schema";
import { openSecret } from "@/lib/secrets";

export const dynamic = "force-dynamic";
/** Legacy integrity check. No value, hint, ciphertext, or key length is returned. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAssetAccount();
    const { id } = await context.params;
    const [row] = await (await getDb()).select().from(credentials)
      .where(and(keyOwner(account), eq(credentials.id, id))).limit(1);
    if (!row) return Response.json({ error: "Key not found." }, { status: 404 });
    let ok = false;
    try { openSecret(row); ok = true; } catch { /* Do not return decryption errors. */ }
    return Response.json({ ok }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return assetFailure(error); }
}
