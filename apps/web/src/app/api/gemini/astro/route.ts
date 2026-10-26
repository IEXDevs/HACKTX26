import { astroSessionConfig } from "@/lib/astro";
import { geminiEnabled } from "@/lib/env";
import { mintLiveToken } from "@/lib/gemini";
import { requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** A one-use Gemini Live token for Astro: { token, model, expiresAt }. */
export async function POST() {
  try {
    await requireWorkspace();
    if (!geminiEnabled()) {
      return Response.json({ error: "Voice is not set up yet." }, { status: 503 });
    }
    const token = await mintLiveToken(await astroSessionConfig());
    return Response.json(token, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
