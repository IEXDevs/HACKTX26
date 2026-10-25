import { NextRequest } from "next/server";
import { z } from "zod";
import { serpApiEnabled } from "@/lib/env";
import { requireWorkspace } from "@/lib/queries";
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
    await requireWorkspace();
    if (!serpApiEnabled()) {
      return Response.json({ error: "Web search is not configured." }, { status: 503 });
    }
    return Response.json({ hits: await builderSearch(parsed.data.query) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
