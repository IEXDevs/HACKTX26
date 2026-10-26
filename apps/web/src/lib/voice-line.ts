/**
 * Voice lines.
 *
 * A voice line stands in for a phone number: opening it starts a spoken call
 * with one agent over the Gemini Live API. The browser holds the audio; the
 * server holds everything that matters: which apps the agent may touch, the
 * permission check on every action, and the run record the call leaves behind.
 *
 * Every action the model asks for is translated into a `connector.call` and
 * checked exactly as the run engine checks one. The one difference: when the
 * owner turned booking on before the call, a calendar event creation that
 * policy would hold for approval goes through, because that approval was given
 * up front. Everything else that needs approval is refused, since nobody is
 * watching the queue while a caller waits.
 */
import {
  TOOL_BY_NAME,
  connectorActionRisk,
  evaluatePermission,
  resolveActionEffects,
  type RunEventPayload,
  type Scope,
} from "@agent-os/core";
import { and, asc, eq } from "drizzle-orm";
import { writeAudit } from "./audit";
import { executeComposioAction, POPULAR_TOOLKITS, SERPAPI_TOOLKIT } from "./composio";
import { connectedToolkitsFor } from "./connectors";
import { getDb } from "./db/client";
import { runEvents, runs, taskLog, templates, workspaces, type AgentRow } from "./db/schema";
import { newId } from "./env";
import { RunLogger } from "./runtime/emitter";
import { liveRuns } from "./runtime/reaper";
import { redactSecrets } from "./secrets";
import type { LiveFunction, LiveSessionConfig } from "./gemini";

export const VOICE_GOAL = "Voice call";
export const CALENDAR_TOOLKIT = "googlecalendar";
/** Composio Google Calendar actions. See https://docs.composio.dev/toolkits/googlecalendar */
export const FIND_FREE_SLOTS = "GOOGLECALENDAR_FIND_FREE_SLOTS";
export const CREATE_EVENT = "GOOGLECALENDAR_CREATE_EVENT";
/** Used when the page does not say where the business is. */
export const DEFAULT_VOICE_TIME_ZONE = "America/Chicago";
/** A call that never says goodbye is handed back to the reaper after this long. */
const MAX_CALL_MS = 45 * 60 * 1000;
const MAX_RANGE_DAYS = 14;

export type VoiceAgent = Pick<
  AgentRow,
  | "id"
  | "workspaceId"
  | "name"
  | "instructions"
  | "grants"
  | "dataClass"
  | "role"
  | "allowedConnectors"
  | "templateId"
>;

export type VoiceActionResult = { ok: true; result: string } | { ok: false; error: string };

export interface TranscriptLine {
  role: "caller" | "agent";
  text: string;
}

/** What the session stored about this call, read back on every action. */
export interface VoiceCallSettings {
  allowBooking: boolean;
  timeZone: string;
  apps: string[];
}

/** Seams for tests: nothing here reaches Composio unless these defaults run. */
export interface VoiceDeps {
  execute?: typeof executeComposioAction;
  linkedToolkits?: (workspaceId: string, userId: string) => Promise<string[]>;
}

/* -------------------------------------------------------------------------- */
/* Time                                                                       */
/* -------------------------------------------------------------------------- */

export function validTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() });
    return value.trim();
  } catch {
    return null;
  }
}

/** Wall-clock time in a timezone, as `YYYY-MM-DDTHH:MM:SS` with no offset. */
export function localDateTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

function spokenTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function shortTime(date: Date, timeZone: string, withDay: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...(withDay ? { weekday: "short", month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const NAIVE_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A time the model gave, as local wall-clock time in the business timezone.
 * Times without an offset are already local; times with one are converted.
 */
export function toLocalDateTime(input: string, timeZone: string): string | null {
  const raw = input.trim();
  const naive = raw.match(NAIVE_RE);
  if (naive) return `${naive[1]}T${naive[2]}:${naive[3]}:${naive[4] ?? "00"}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return localDateTime(parsed, timeZone);
}

/** Wall-clock arithmetic on a `YYYY-MM-DDTHH:MM:SS` value. */
function addMinutes(local: string, minutes: number): string {
  const shifted = new Date(new Date(`${local}Z`).getTime() + minutes * 60_000);
  return shifted.toISOString().slice(0, 19);
}

function addDays(date: string, days: number): string {
  return addMinutes(`${date}T00:00:00`, days * 24 * 60).slice(0, 10);
}

/** The instant a `YYYY-MM-DDTHH:MM:SS` wall-clock time happens in a timezone. */
export function localToInstant(local: string, timeZone: string): Date {
  const asUtc = new Date(`${local}Z`).getTime();
  const offsetAt = (instant: number) => new Date(`${localDateTime(new Date(instant), timeZone)}Z`).getTime() - instant;
  // Twice, so a guess that lands across a daylight-saving change settles.
  const guess = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(guess));
}

/* -------------------------------------------------------------------------- */
/* Which apps a call may use                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Apps the operator linked that this agent may use on a call. An agent's own
 * list wins, then its template's; an orchestrator with neither gets every
 * linked app, as it would in a run. Web search is not a phone tool.
 */
export function voiceAppsFor(
  agent: Pick<VoiceAgent, "role" | "allowedConnectors">,
  linked: readonly string[],
  templateConnectors: readonly string[] = [],
): string[] {
  const usable = [...new Set(linked)].filter((slug) => slug !== SERPAPI_TOOLKIT);
  const scope =
    agent.allowedConnectors.length > 0
      ? agent.allowedConnectors
      : templateConnectors.length > 0
        ? templateConnectors
        : agent.role === "orchestrator"
          ? usable
          : [];
  return usable.filter((slug) => scope.includes(slug));
}

export async function resolveVoiceApps(
  agent: VoiceAgent,
  operatorUserId: string,
  deps: VoiceDeps = {},
): Promise<string[]> {
  const linked = await (deps.linkedToolkits ?? connectedToolkitsFor)(agent.workspaceId, operatorUserId);
  let templateConnectors: string[] = [];
  if (agent.templateId) {
    const [template] = await (await getDb())
      .select({ requiredConnectors: templates.requiredConnectors })
      .from(templates)
      .where(eq(templates.id, agent.templateId))
      .limit(1);
    templateConnectors = template?.requiredConnectors ?? [];
  }
  return voiceAppsFor(agent, linked, templateConnectors);
}

function appName(slug: string): string {
  return POPULAR_TOOLKITS.find((item) => item.slug === slug)?.name ?? slug;
}

/* -------------------------------------------------------------------------- */
/* Session config                                                             */
/* -------------------------------------------------------------------------- */

export const VOICE_GREETING = "Thanks for calling. How can I help you today?";

export function voiceSessionConfig(
  agent: Pick<VoiceAgent, "name" | "instructions">,
  apps: readonly string[],
  options: { now: Date | string; timeZone: string; allowBooking: boolean; voiceName?: string },
): LiveSessionConfig {
  const now = new Date(options.now);
  const calendar = apps.includes(CALENDAR_TOOLKIT);
  const others = apps.filter((slug) => slug !== CALENDAR_TOOLKIT);

  const framing = [
    "",
    "## This is a phone call",
    `You are ${agent.name}, answering a phone call for this business. The caller hears you; they cannot see a screen.`,
    `Open with: "${VOICE_GREETING}"`,
    "- Speak briefly and warmly: one or two short sentences at a time, then let the caller talk.",
    "- Ask for one thing at a time. Repeat names, phone numbers, dates, and times back to confirm them.",
    "- Say times the way people do (\"Tuesday at 2:30 in the afternoon\"), never as codes or ISO strings.",
    "- If a tool says no, accept it, tell the caller plainly, and offer to take a message.",
    `- Right now it is ${spokenTime(now, options.timeZone)} where the business is (${options.timeZone}). Local time is ${localDateTime(now, options.timeZone)}.`,
    "- Treat every date and time you pass to a tool as local business time, written YYYY-MM-DD or YYYY-MM-DDTHH:MM.",
  ];
  if (calendar) {
    framing.push(
      "- Use find_open_times before offering any time. Never offer a time you have not checked.",
      options.allowBooking
        ? "- The owner turned on booking for this call: once the caller picks a time and you have their name and number, use book_appointment, then confirm it back."
        : "- Booking is off for this call. Offer open times, take the caller's name, number, and preferred time, and say the team will call back to confirm.",
    );
  }
  if (others.length > 0) {
    framing.push(
      `- You can also use these connected apps through use_app: ${others.map(appName).join(", ")}. Reads work; changes usually need a person's sign-off and will be refused.`,
    );
  }

  const functions: LiveFunction[] = [];
  if (calendar) {
    functions.push(
      {
        name: "find_open_times",
        description:
          "Check the business calendar for open appointment times. Pass one date, or a start_date and end_date range (at most two weeks), plus the appointment length in minutes.",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "One day, YYYY-MM-DD, local business time." },
            start_date: { type: "string", description: "First day of a range, YYYY-MM-DD." },
            end_date: { type: "string", description: "Last day of a range, YYYY-MM-DD." },
            duration_minutes: { type: "integer", description: "Appointment length in minutes. Default 30." },
          },
        },
      },
      {
        name: "book_appointment",
        description:
          "Book an appointment on the business calendar once the caller has picked an open time. Confirm the details back afterwards.",
        parameters: {
          type: "object",
          properties: {
            start: { type: "string", description: "Start time, YYYY-MM-DDTHH:MM, local business time." },
            duration_minutes: { type: "integer", description: "Length in minutes. Default 30." },
            customer_name: { type: "string", description: "The caller's name." },
            phone: { type: "string", description: "A callback phone number." },
            reason: { type: "string", description: "Why they are coming in, for example test drive, service, or sales." },
          },
          required: ["start", "customer_name", "phone", "reason"],
        },
      },
    );
  }
  if (others.length > 0) {
    functions.push({
      name: "use_app",
      description:
        "Run one action on another connected app. Pass the app, the action name (for example GMAIL_FETCH_EMAILS), and its arguments as a JSON object string.",
      parameters: {
        type: "object",
        properties: {
          toolkit: { type: "string", enum: others, description: "Which app." },
          action: { type: "string", description: "The app action name." },
          arguments_json: { type: "string", description: "The action's arguments as a JSON object, or {}." },
        },
        required: ["toolkit", "action"],
      },
    });
  }

  return {
    systemInstruction: `${agent.instructions.trim()}\n${framing.join("\n")}`,
    functions,
    ...(options.voiceName ? { voiceName: options.voiceName } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Translating a function call into connector.call                            */
/* -------------------------------------------------------------------------- */

interface ConnectorCall {
  toolkit: string;
  action: string;
  arguments: Record<string, unknown>;
  /** Present for book_appointment, for the audit row and the confirmation. */
  booking?: { start: string; durationMinutes: number; customerName: string; reason: string };
  durationMinutes?: number;
}

function text(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function minutes(args: Record<string, unknown>, fallback = 30): number {
  const raw = Number(args.duration_minutes ?? args.durationMinutes ?? fallback);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(8 * 60, Math.round(raw));
}

export function translateVoiceCall(
  name: string,
  args: Record<string, unknown>,
  timeZone: string,
  agentName: string,
): ConnectorCall | { error: string } {
  if (name === "find_open_times") {
    const durationMinutes = minutes(args);
    const date = text(args, "date");
    const startDate = text(args, "start_date") ?? date;
    const endDate = text(args, "end_date") ?? startDate;
    if (!startDate || !endDate || !DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
      return { error: "Give a date as YYYY-MM-DD, or a start_date and end_date." };
    }
    if (endDate < startDate) return { error: "end_date is before start_date." };
    const lastDay = endDate > addDays(startDate, MAX_RANGE_DAYS - 1) ? addDays(startDate, MAX_RANGE_DAYS - 1) : endDate;
    return {
      toolkit: CALENDAR_TOOLKIT,
      action: FIND_FREE_SLOTS,
      arguments: {
        items: ["primary"],
        // Exact instants: Google reads times without an offset as UTC.
        time_min: localToInstant(`${startDate}T00:00:00`, timeZone).toISOString(),
        time_max: localToInstant(`${addDays(lastDay, 1)}T00:00:00`, timeZone).toISOString(),
        timezone: timeZone,
      },
      durationMinutes,
    };
  }

  if (name === "book_appointment") {
    const startRaw = text(args, "start");
    const customerName = text(args, "customer_name");
    const phone = text(args, "phone");
    const reason = text(args, "reason") ?? "Appointment";
    const missing = [
      !startRaw && "the start time",
      !customerName && "the caller's name",
      !phone && "a callback number",
    ].filter(Boolean);
    if (missing.length > 0) return { error: `Still need ${missing.join(" and ")} before booking.` };
    const start = toLocalDateTime(startRaw as string, timeZone);
    if (!start) return { error: "The start time was not a date and time. Use YYYY-MM-DDTHH:MM." };
    const durationMinutes = minutes(args);
    return {
      toolkit: CALENDAR_TOOLKIT,
      action: CREATE_EVENT,
      arguments: {
        calendar_id: "primary",
        summary: `${reason}: ${customerName}`,
        description: [
          `Booked by phone through ${agentName}.`,
          `Caller: ${customerName}`,
          `Phone: ${phone}`,
          `Reason: ${reason}`,
        ].join("\n"),
        start_datetime: start,
        end_datetime: addMinutes(start, durationMinutes),
        timezone: timeZone,
        create_meeting_room: false,
        send_updates: "none",
      },
      booking: { start, durationMinutes, customerName: customerName as string, reason },
    };
  }

  if (name === "use_app") {
    const toolkit = text(args, "toolkit")?.toLowerCase() ?? "";
    const action = text(args, "action") ?? "";
    if (!toolkit || !action) return { error: "use_app needs a toolkit and an action." };
    let actionArgs: Record<string, unknown> = {};
    const rawArgs = args.arguments_json ?? args.arguments;
    if (typeof rawArgs === "string" && rawArgs.trim()) {
      try {
        const parsed: unknown = JSON.parse(rawArgs);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { error: "arguments_json must be a JSON object." };
        }
        actionArgs = parsed as Record<string, unknown>;
      } catch {
        return { error: "arguments_json was not valid JSON." };
      }
    } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
      actionArgs = rawArgs as Record<string, unknown>;
    }
    return { toolkit, action, arguments: actionArgs };
  }

  return { error: `There is no "${name}" tool on this line.` };
}

/* -------------------------------------------------------------------------- */
/* Reading results back to the model                                          */
/* -------------------------------------------------------------------------- */

interface Slot {
  start: Date;
  end: Date;
}

/** Time ranges found under keys matching `kind` (such as free or busy), at any depth. */
function rangesIn(value: unknown, kind: RegExp, under = false, out: Slot[] = []): Slot[] {
  if (Array.isArray(value)) {
    for (const item of value) rangesIn(item, kind, under, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;
  const record = value as Record<string, unknown>;
  if (under) {
    const start = record.start ?? record.start_time ?? record.startTime;
    const end = record.end ?? record.end_time ?? record.endTime;
    if (typeof start === "string" && typeof end === "string") {
      const s = new Date(start);
      const e = new Date(end);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) out.push({ start: s, end: e });
      return out;
    }
  }
  for (const [key, child] of Object.entries(record)) {
    rangesIn(child, kind, under || kind.test(key), out);
  }
  return out;
}

function parseJson(preview: string): unknown {
  try {
    return JSON.parse(preview);
  } catch {
    return null;
  }
}

const STEP_MS = 30 * 60_000;
/** Earliest and latest start hours worth listing; the agent's own business hours narrow them further. */
const FIRST_HOUR = 7;
const LAST_HOUR = 20;

/** Start times on the half hour where an appointment of `durationMinutes` fits inside a free gap. */
function openStarts(free: Slot[], durationMinutes: number, timeZone: string): Date[] {
  const starts: Date[] = [];
  for (const gap of [...free].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    for (let t = Math.ceil(gap.start.getTime() / STEP_MS) * STEP_MS; t + durationMinutes * 60_000 <= gap.end.getTime(); t += STEP_MS) {
      const hour = Number(localDateTime(new Date(t), timeZone).slice(11, 13));
      if (hour >= FIRST_HOUR && hour < LAST_HOUR) starts.push(new Date(t));
    }
  }
  return starts;
}

/**
 * Free time as exact start times the agent may offer, with what is taken.
 * Ranges read badly aloud ("free until 10" became "10 is free"), so the agent
 * gets a list to pick from. Falls back to the raw preview if the shape is unfamiliar.
 */
export function describeFreeSlots(preview: string, durationMinutes: number, timeZone: string): string {
  const parsed = parseJson(preview);
  const free = parsed ? rangesIn(parsed, /free/i) : [];
  const busy = parsed ? rangesIn(parsed, /busy/i) : [];
  if (free.length === 0 && busy.length === 0) {
    return `Calendar free time (${timeZone}). Only offer gaps of at least ${durationMinutes} minutes inside business hours:\n${preview.slice(0, 2_500)}`;
  }
  const byDay = new Map<string, string[]>();
  for (const start of openStarts(free, durationMinutes, timeZone)) {
    const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(start);
    const list = byDay.get(day) ?? [];
    if (list.length < 16) list.push(shortTime(start, timeZone, false));
    byDay.set(day, list);
  }
  const taken = busy
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, 20)
    .map((slot) => `- ${shortTime(slot.start, timeZone, true)} to ${shortTime(slot.end, timeZone, false)}`);
  const open = [...byDay].map(([day, times]) => `- ${day}: ${times.join(", ")}`);
  return [
    `Open start times for a ${durationMinutes}-minute appointment (${timeZone}). Offer only times from this list, and only inside business hours. Any time not listed is taken.`,
    open.length ? open.join("\n") : "- None in that window.",
    ...(taken.length ? ["Already taken:", ...taken] : []),
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Running one action                                                         */
/* -------------------------------------------------------------------------- */

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === "string" ? redactSecrets(value).slice(0, 600) : value;
  }
  return out;
}

export function isCalendarBooking(toolkit: string, action: string): boolean {
  return toolkit === CALENDAR_TOOLKIT && action.toUpperCase() === CREATE_EVENT;
}

/** The settings the session stored on the call's run, or null if this is not a voice call. */
export async function voiceCallSettings(runId: string): Promise<VoiceCallSettings | null> {
  const rows = await (await getDb())
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "log")))
    .orderBy(asc(runEvents.seq));
  for (const { payload } of rows) {
    if (payload.type !== "log") continue;
    const stored = payload.fields?.voiceCall as Partial<VoiceCallSettings> | undefined;
    if (stored && typeof stored === "object") {
      return {
        allowBooking: stored.allowBooking === true,
        timeZone: validTimeZone(stored.timeZone) ?? DEFAULT_VOICE_TIME_ZONE,
        apps: Array.isArray(stored.apps) ? stored.apps.filter((s): s is string => typeof s === "string") : [],
      };
    }
  }
  return null;
}

export async function executeVoiceAction(
  input: {
    runId: string;
    agent: VoiceAgent;
    operatorUserId: string | null;
    name: string;
    args: Record<string, unknown>;
    allowBooking: boolean;
    /** Apps this call may use. Read from the call's run when omitted. */
    apps?: string[];
    timeZone?: string;
  },
  deps: VoiceDeps = {},
): Promise<VoiceActionResult> {
  const { runId, agent } = input;
  const db = await getDb();
  const started = Date.now();
  const settings = input.apps && input.timeZone ? null : await voiceCallSettings(runId);
  const apps = input.apps ?? settings?.apps ?? [];
  const timeZone = input.timeZone ?? settings?.timeZone ?? DEFAULT_VOICE_TIME_ZONE;

  await db.update(runs).set({ heartbeatAt: new Date() }).where(eq(runs.id, runId));
  const logger = await RunLogger.open(runId);
  const emit = (payload: RunEventPayload) => logger.emit(payload, agent.id);

  const call = translateVoiceCall(input.name, input.args, timeZone, agent.name);
  if ("error" in call) {
    await emit({
      type: "log",
      level: "warn",
      message: `${input.name} was not run: ${call.error}`,
      agentId: agent.id,
    });
    return { ok: false, error: call.error };
  }

  const callId = newId("call");
  const manifest = TOOL_BY_NAME.get("connector.call");
  const scopes = (manifest?.scopes ?? ["execute", "net"]) as Scope[];
  const risk = connectorActionRisk(call.action);
  await emit({
    type: "tool.requested",
    callId,
    agentId: agent.id,
    taskId: null,
    tool: "connector.call",
    args: redactArgs({ toolkit: call.toolkit, action: call.action, arguments: call.arguments }),
    risk,
    scopes,
  });

  const refuse = async (error: string, detail: string): Promise<VoiceActionResult> => {
    await emit({
      type: "tool.completed",
      callId,
      agentId: agent.id,
      tool: "connector.call",
      ok: false,
      durationMs: Math.max(1, Date.now() - started),
      error: detail,
    });
    await emit({ type: "log", level: "warn", message: `connector.call refused: ${detail}`, agentId: agent.id });
    return { ok: false, error };
  };

  if (!apps.includes(call.toolkit)) {
    return refuse(
      "That app isn't connected to this line, so I can't use it. Offer to take a message instead.",
      `${appName(call.toolkit)} is not linked for this voice line.`,
    );
  }

  const [workspace] = await db
    .select({ actionEffects: workspaces.actionEffects })
    .from(workspaces)
    .where(eq(workspaces.id, agent.workspaceId))
    .limit(1);
  const decision = evaluatePermission(
    { resource: "connector.call", scopes, risk, agentGrants: agent.grants },
    undefined,
    resolveActionEffects(workspace?.actionEffects),
  );

  if (decision.effect === "deny") {
    return refuse(
      "That isn't allowed on this line. Tell the caller plainly and offer to take a message.",
      `Denied by policy (${decision.matchedRuleId ?? "default"}): ${decision.reason}`,
    );
  }

  if (decision.effect === "require_approval") {
    if (isCalendarBooking(call.toolkit, call.action) && input.allowBooking) {
      await emit({
        type: "log",
        level: "info",
        message: "Booking allowed: the owner turned on booking for this call before it started.",
        agentId: agent.id,
        fields: { callId, policy: decision.reason },
      });
    } else if (isCalendarBooking(call.toolkit, call.action)) {
      return refuse(
        "Booking is off for this call. Take the caller's name, number, and preferred time, and say the team will call back to confirm.",
        `Needs approval and booking was not turned on for this call. ${decision.reason}`,
      );
    } else {
      return refuse(
        "That needs a person's sign-off, so it can't be done during the call. Offer to take a message.",
        `Needs approval, which a live call cannot wait for. ${decision.reason}`,
      );
    }
  } else if (decision.effect === "allow_with_log") {
    await emit({
      type: "log",
      level: "info",
      message: `policy allowed connector.call with logging (${decision.matchedRuleId ?? "grant"}).`,
      agentId: agent.id,
    });
  }

  if (!input.operatorUserId) {
    return refuse(
      "The line's apps aren't available right now. Offer to take a message.",
      "No operator identity on this call, so connected apps cannot run.",
    );
  }

  // The model can misread free time, so a booking is checked against the calendar first.
  if (call.booking) {
    const clash = await bookingClash(call.booking, timeZone, input.operatorUserId, agent.name, deps);
    if (clash) {
      return refuse(
        `That time is already taken on the calendar. Don't book it. Tell the caller and offer one of these instead.\n${clash}`,
        "The requested time overlaps an existing calendar event.",
      );
    }
  }

  let result: { ok: boolean; preview: string; error?: string };
  try {
    result = await (deps.execute ?? executeComposioAction)({
      userId: input.operatorUserId,
      toolkit: call.toolkit,
      action: call.action,
      arguments: call.arguments,
    });
  } catch (error) {
    result = { ok: false, preview: "", error: error instanceof Error ? error.message : "The app call failed." };
  }

  await emit({
    type: "tool.completed",
    callId,
    agentId: agent.id,
    tool: "connector.call",
    ok: result.ok,
    durationMs: Math.max(1, Date.now() - started),
    resultPreview: result.preview ? redactSecrets(result.preview).slice(0, 600) : undefined,
    error: result.ok ? undefined : redactSecrets(result.error ?? "The app call failed.").slice(0, 600),
  });

  if (!result.ok) {
    return {
      ok: false,
      error: `The calendar or app didn't respond as expected (${redactSecrets(result.error ?? "unknown error").slice(0, 200)}). Apologize and offer to take a message.`,
    };
  }

  if (call.booking) {
    await writeAudit({
      workspaceId: agent.workspaceId,
      actor: agent.name,
      action: "voice.appointment_booked",
      targetType: "run",
      targetId: runId,
      detail: {
        agentId: agent.id,
        start: call.booking.start,
        timeZone,
        durationMinutes: call.booking.durationMinutes,
        customerName: call.booking.customerName,
        reason: call.booking.reason,
      },
    });
    const when = new Date(`${call.booking.start}Z`);
    const spoken = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(when);
    return {
      ok: true,
      result: `Booked: ${call.booking.reason} for ${call.booking.customerName}, ${spoken}, ${call.booking.durationMinutes} minutes. Confirm it back to the caller.`,
    };
  }

  if (call.action === FIND_FREE_SLOTS) {
    return { ok: true, result: describeFreeSlots(result.preview, call.durationMinutes ?? 30, timeZone) };
  }
  return { ok: true, result: result.preview.slice(0, 3_000) || "Done." };
}

/**
 * The open times that day if the booking overlaps an existing event, else null.
 * If the calendar can't be read, the booking goes ahead as before.
 */
async function bookingClash(
  booking: NonNullable<ConnectorCall["booking"]>,
  timeZone: string,
  userId: string,
  agentName: string,
  deps: VoiceDeps,
): Promise<string | null> {
  const lookup = translateVoiceCall(
    "find_open_times",
    { date: booking.start.slice(0, 10), duration_minutes: booking.durationMinutes },
    timeZone,
    agentName,
  );
  if ("error" in lookup) return null;
  try {
    const result = await (deps.execute ?? executeComposioAction)({
      userId,
      toolkit: lookup.toolkit,
      action: lookup.action,
      arguments: lookup.arguments,
    });
    if (!result.ok) return null;
    const parsed = parseJson(result.preview);
    const busy = parsed ? rangesIn(parsed, /busy/i) : [];
    const start = localToInstant(booking.start, timeZone).getTime();
    const end = start + booking.durationMinutes * 60_000;
    const overlaps = busy.some((slot) => slot.start.getTime() < end && slot.end.getTime() > start);
    return overlaps ? describeFreeSlots(result.preview, booking.durationMinutes, timeZone) : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Call lifecycle                                                             */
/* -------------------------------------------------------------------------- */

export async function startVoiceCall(input: {
  agent: VoiceAgent;
  operatorUserId: string | null;
  settings: VoiceCallSettings;
  /** The Live model, recorded so the run shows what answered. */
  model: string;
}): Promise<string> {
  const { agent, settings } = input;
  const db = await getDb();
  const [workspace] = await db
    .select({ defaultRunBudgetUsd: workspaces.defaultRunBudgetUsd })
    .from(workspaces)
    .where(eq(workspaces.id, agent.workspaceId))
    .limit(1);

  const runId = newId("run");
  const now = new Date();
  await db.insert(runs).values({
    id: runId,
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    triggerId: null,
    goal: VOICE_GOAL,
    status: "running",
    dataClass: agent.dataClass,
    budgetUsd: workspace?.defaultRunBudgetUsd ?? 2.5,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    mode: "live",
    purpose: "standard",
    operatorUserId: input.operatorUserId,
    startedAt: now,
    heartbeatAt: now,
    eventCount: 0,
  });

  // The call lives in the browser, not in an engine loop, so this process
  // vouches for it until it ends, with a ceiling in case the page never says so.
  liveRuns().add(runId);
  const release = setTimeout(() => liveRuns().delete(runId), MAX_CALL_MS);
  release.unref?.();

  const logger = await RunLogger.open(runId);
  await logger.emit(
    {
      type: "run.started",
      goal: VOICE_GOAL,
      orchestratorAgentId: agent.id,
      trigger: "api",
      budgetUsd: workspace?.defaultRunBudgetUsd ?? 2.5,
      dataClass: agent.dataClass,
    },
    agent.id,
  );
  await logger.emit(
    { type: "agent.spawned", agentId: agent.id, parentAgentId: null, name: agent.name, role: agent.role, model: input.model },
    agent.id,
  );
  await logger.emit({ type: "agent.status", agentId: agent.id, status: "working" }, agent.id);
  await logger.emit(
    {
      type: "log",
      level: "info",
      message: settings.allowBooking
        ? "Voice call started. The owner turned on booking for this call."
        : "Voice call started. Booking is off for this call.",
      agentId: agent.id,
      fields: { voiceCall: settings },
    },
    agent.id,
  );
  return runId;
}

const TERMINAL = new Set(["succeeded", "failed", "halted", "cancelled"]);

export async function endVoiceCall(runId: string, transcript: TranscriptLine[]): Promise<void> {
  const db = await getDb();
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new Error("That call does not exist.");
  // Ending twice is harmless: the second time changes nothing.
  if (run.status === "succeeded" && run.endedAt) return;

  const logger = await RunLogger.open(runId);
  for (const line of transcript) {
    const said = redactSecrets(line.text.trim()).slice(0, 2_000);
    if (!said) continue;
    await logger.emit(
      {
        type: "agent.message",
        agentId: run.agentId,
        role: line.role === "caller" ? "user" : "assistant",
        text: said,
      },
      run.agentId,
    );
  }

  liveRuns().delete(runId);
  if (TERMINAL.has(run.status)) return;

  const bookings = await db
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "tool.requested")));
  const completed = await db
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "tool.completed")));
  const bookingCalls = new Set(
    bookings.flatMap(({ payload }) =>
      payload.type === "tool.requested" && payload.args.action === CREATE_EVENT ? [payload.callId] : [],
    ),
  );
  const booked = completed.filter(
    ({ payload }) => payload.type === "tool.completed" && payload.ok && bookingCalls.has(payload.callId),
  ).length;
  const summary =
    booked === 0
      ? "Call ended. No appointment booked."
      : booked === 1
        ? "Call ended. Booked 1 appointment."
        : `Call ended. Booked ${booked} appointments.`;

  const endedAt = new Date();
  await logger.emit({ type: "agent.status", agentId: run.agentId, status: "done" }, run.agentId);
  await logger.emit(
    {
      type: "run.completed",
      status: "succeeded",
      summary,
      totalCostUsd: run.costUsd,
      durationMs: Math.max(1, endedAt.getTime() - run.startedAt.getTime()),
    },
    run.agentId,
  );
  await db
    .update(runs)
    .set({ status: "succeeded", summary, failureReason: null, endedAt, heartbeatAt: endedAt, eventCount: logger.nextSeq })
    .where(eq(runs.id, runId));
  await db.insert(taskLog).values({
    id: newId("tl"),
    workspaceId: run.workspaceId,
    runId,
    agentId: run.agentId,
    title: VOICE_GOAL,
    summary,
    status: "succeeded",
    costUsd: run.costUsd,
    createdAt: endedAt,
  });
}
