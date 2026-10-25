// Pure helpers for the voice line page: labels, error wording, and the
// payload sent when a call ends. No browser APIs, so they are unit tested.

import type { LiveStatus, LiveTranscript } from "./live-state";
import type { VoiceSphereState } from "./voice-sphere";

/** Limits the end route accepts; lines past them would fail the whole request. */
const MAX_LINES = 1_000;
const MAX_LINE_CHARS = 4_000;

export interface EndPayload {
  runId: string;
  transcript: { role: "caller" | "agent"; text: string }[];
}

/** The body for POST /api/voice/[agentId]/end. Drops empty lines and clips to the route's limits. */
export function endPayload(runId: string, lines: LiveTranscript[]): EndPayload {
  const transcript: EndPayload["transcript"] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    transcript.push({ role: line.role === "user" ? "caller" : "agent", text: text.slice(0, MAX_LINE_CHARS) });
  }
  return { runId, transcript: transcript.slice(-MAX_LINES) };
}

/** What the sphere should show for a session status. A failed call rests like an idle one. */
export function sphereState(status: LiveStatus): VoiceSphereState {
  return status === "error" ? "idle" : status;
}

export function inCall(status: LiveStatus): boolean {
  return status === "connecting" || status === "listening" || status === "thinking" || status === "speaking";
}

/** The one-word call state under the agent's name. `ended` is true once a call has been placed. */
export function callStateLabel(status: LiveStatus, ended: boolean): string {
  switch (status) {
    case "connecting":
      return "Connecting…";
    case "listening":
      return "Listening";
    case "thinking":
      return "Thinking";
    case "speaking":
      return "Speaking";
    default:
      return ended ? "Call ended" : "Ready";
  }
}

/** Plain wording for a failed start-call request. */
export function sessionErrorMessage(status: number, serverError?: string | null): string {
  if (status === 503) return "Voice isn't set up yet.";
  if (status === 401) return "Sign in to start a call.";
  if (status === 404) return "This agent can't take calls.";
  if (status === 502) return "Could not start the call. Try again.";
  if (serverError && serverError.length < 140) return serverError;
  return "Could not start the call. Try again.";
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/** Reads a booking start: "YYYY-MM-DDTHH:MM" is the caller's local time; anything with an offset is parsed as is. */
export function parseBookingStart(start: string): Date | null {
  const value = start.trim();
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const local = LOCAL_TIME.exec(value);
  if (local && !hasZone) {
    const [, y, mo, d, h, mi] = local.map(Number) as [number, number, number, number, number, number];
    const date = new Date(y, mo - 1, d, h, mi);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The inline note shown when book_appointment succeeds, e.g. "Booked: Tue, Oct 27, 2:30 PM".
 * Returns null for any other tool, a refused booking, or a start time that can't be read.
 */
export function bookedLabel(
  name: string,
  args: Record<string, unknown>,
  ok: boolean,
  locale?: string,
): string | null {
  if (name !== "book_appointment" || !ok) return null;
  const start = typeof args.start === "string" ? parseBookingStart(args.start) : null;
  if (!start) return null;
  const when = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
  return `Booked: ${when}`;
}
