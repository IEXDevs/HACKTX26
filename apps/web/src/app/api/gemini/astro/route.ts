import { astroSessionConfig } from "@/lib/astro";
import { AssetError, assetFailure, requireAssetAccount } from "@/lib/account-assets";
import { voiceApiKey } from "@/lib/gemini-account";
import { mintLiveToken } from "@/lib/gemini";

export const dynamic = "force-dynamic";

/** A one-use Gemini Live token for Astro: { token, model, expiresAt }. */
export async function POST() {
  try {
    const account = await requireAssetAccount();
    const apiKey = await voiceApiKey(account.accountId);
    if (!apiKey) {
      return Response.json({ error: "Add your Gemini (voice) API key under Saved keys on the Apps page." }, { status: 503 });
    }
    const token = await mintLiveToken(await astroSessionConfig(), { apiKey });
    return Response.json(token, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AssetError) return assetFailure(error);
    return Response.json({ error: "Could not start voice. Check your Gemini key and try again." }, { status: 502 });
  }
}
