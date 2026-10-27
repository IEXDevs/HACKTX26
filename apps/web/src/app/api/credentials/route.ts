import { z } from "zod";
import { addAccountKey, assetFailure, listAccountKeys, requireAssetAccount } from "@/lib/account-assets";

export const dynamic = "force-dynamic";
const Body = z.object({ purpose: z.enum(["muse", "gemini"]), key: z.string().trim().min(8).max(8192).regex(/^\S+$/) }).strict();

export async function GET() {
  try {
    return Response.json({ keys: await listAccountKeys(await requireAssetAccount()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return assetFailure(error); }
}

export async function POST(request: Request) {
  try {
    const account = await requireAssetAccount();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Choose Muse or Gemini and enter a valid key." }, { status: 400 });
    const saved = await addAccountKey(account, parsed.data.purpose, parsed.data.key);
    return Response.json(saved, { status: 201 });
  } catch (error) { return assetFailure(error); }
}
