import { NextRequest } from "next/server";
import { z } from "zod";
import { executeVoiceAction, voiceCallSettings } from "@/lib/voice-line";
import { voiceContext, voiceRun } from "../../_shared";

export const dynamic = "force-dynamic";

const Body = z.object({
  runId: z.string().min(1),
  name: z.string().min(1).max(64),
  args: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Run one function call from the Live model. Refusals come back as 200 with
 * `ok: false`, so the browser can hand them straight to the model to say.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { runId, name, args }." }, { status: 400 });
  }

  const ctx = await voiceContext(agentId);
  if (!ctx.ok) return ctx.response;

  const run = await voiceRun(ctx, parsed.data.runId);
  const settings = run ? await voiceCallSettings(run.id) : null;
  if (!run || !settings) {
    return Response.json({ error: "That call was not found." }, { status: 404 });
  }
  if (run.status !== "running") {
    return Response.json({ ok: false, error: "This call has already ended." });
  }

  try {
    const outcome = await executeVoiceAction({
      runId: run.id,
      agent: ctx.agent,
      operatorUserId: run.operatorUserId,
      name: parsed.data.name,
      args: parsed.data.args,
      allowBooking: settings.allowBooking,
      apps: settings.apps,
      timeZone: settings.timeZone,
    });
    return Response.json(outcome);
  } catch (error) {
    console.warn("[voice] action failed:", error instanceof Error ? error.message : error);
    return Response.json({
      ok: false,
      error: "Something went wrong with that request. Apologize and offer to take a message.",
    });
  }
}
