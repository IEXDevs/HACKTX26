import { NextRequest } from "next/server";
import { z } from "zod";
import { AssetError, assetFailure, requireAssetAccount } from "@/lib/account-assets";
import { serviceApiKey } from "@/lib/service-keys";
import { builderSearch } from "@/lib/runtime/builder";

export const dynamic = "force-dynamic";

const Body = z.object({ query: z.string().trim().min(2).max(200) });

/** Web search for the voice builder: { query } in, { hits: [{ title, url, snippet }] } out. */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { query }." }, { status: 400 });
  }
  try {
    const account = await requireAssetAccount();
    if (!await serviceApiKey("serpapi", account.accountId)) {
      return Response.json({ error: "Add a SerpAPI key under Saved keys to use web search." }, { status: 503 });
    }
    return Response.json({ hits: await builderSearch(parsed.data.query, account.accountId) });
  } catch (error) {
    if (error instanceof AssetError) return assetFailure(error);
    return Response.json({ error: "Web search failed. Check your SerpAPI key and try again." }, { status: 502 });
  }
}
