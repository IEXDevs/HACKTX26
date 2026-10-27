import { NextRequest } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { voiceApiKey } from "@/lib/gemini-account";
import { mintLiveToken } from "@/lib/gemini";
import {
  DEFAULT_VOICE_TIME_ZONE,
  resolveVoiceApps,
  startVoiceCall,
  validTimeZone,
  VOICE_GREETING,
  voiceSessionConfig,
} from "@/lib/voice-line";
import { voiceContext } from "../../_shared";

export const dynamic = "force-dynamic";

const Body = z.object({
  allowBooking: z.boolean(),
  /** IANA timezone of the business, e.g. America/Chicago. */
  timeZone: z.string().max(64).optional(),
});

/** Start a call: mint a short-lived Live token and open the run the call is recorded on. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await context.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { allowBooking }." }, { status: 400 });
  }
  const ctx = await voiceContext(agentId);
  if (!ctx.ok) return ctx.response;
  const { agent, operatorUserId } = ctx;
  const apiKey = await voiceApiKey(operatorUserId);
  if (!apiKey) {
    return Response.json({ error: "Add your Gemini (voice) API key under Saved keys on the Apps page." }, { status: 503 });
  }

  const allowBooking = parsed.data.allowBooking;
  const timeZone = validTimeZone(parsed.data.timeZone) ?? DEFAULT_VOICE_TIME_ZONE;
  const apps = await resolveVoiceApps(agent, operatorUserId).catch(() => []);
  const config = voiceSessionConfig(agent, apps, { now: new Date(), timeZone, allowBooking });

  let live: Awaited<ReturnType<typeof mintLiveToken>>;
  try {
    live = await mintLiveToken(config, { apiKey });
  } catch {
    console.warn("[voice] could not mint a Live token");
    return Response.json({ error: "Could not start the call. Try again." }, { status: 502 });
  }

  const runId = await startVoiceCall({
    agent,
    operatorUserId,
    settings: { allowBooking, timeZone, apps },
    model: live.model,
  });

  if (allowBooking) {
    await writeAudit({
      workspaceId: ctx.workspace.id,
      actor: ctx.actor,
      userId: ctx.userId,
      action: "voice.booking_allowed",
      targetType: "run",
      targetId: runId,
      detail: { agentId: agent.id, agentName: agent.name, timeZone },
    });
  }

  return Response.json({
    runId,
    token: live.token,
    model: live.model,
    expiresAt: live.expiresAt,
    agent: { name: agent.name, greeting: VOICE_GREETING },
  }, { headers: { "Cache-Control": "no-store" } });
}
