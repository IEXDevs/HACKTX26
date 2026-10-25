import { NextRequest } from "next/server";
import { z } from "zod";
import { askBuilder } from "@/lib/runtime/builder";

export const dynamic = "force-dynamic";

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(6000),
      }),
    )
    .min(1)
    .max(40),
});

/** One builder turn: the conversation so far in, Muse's reply and optional draft out. */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { messages: [{ role, content }] }." }, { status: 400 });
  }
  try {
    return Response.json(await askBuilder(parsed.data.messages));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
