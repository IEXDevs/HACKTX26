import { NextRequest } from "next/server";
import { z } from "zod";
import { endVoiceCall } from "@/lib/voice-line";
import { voiceContext, voiceRun } from "../../_shared";

export const dynamic = "force-dynamic";

const Body = z.object({
  runId: z.string().min(1),
  transcript: z
    .array(z.object({ role: z.enum(["caller", "agent"]), text: z.string().max(4_000) }))
    .max(1_000)
    .default([]),
});

/** Hang up: store what was said and close the call's run. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { runId, transcript }." }, { status: 400 });
  }

  const ctx = await voiceContext(agentId);
  if (!ctx.ok) return ctx.response;

  const run = await voiceRun(ctx, parsed.data.runId);
  if (!run) return Response.json({ error: "That call was not found." }, { status: 404 });

  await endVoiceCall(run.id, parsed.data.transcript);
  return Response.json({ ok: true });
}
