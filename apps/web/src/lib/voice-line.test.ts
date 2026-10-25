import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { grantsFor, ORCHESTRATOR_TOOLS, policyFor } from "@/lib/agent-factory";
import { getDb } from "@/lib/db/client";
import { agents, auditLog, runEvents, runs, taskLog, type AgentRow } from "@/lib/db/schema";
import { freshDb } from "@/lib/loop/test-support";
import { listRuns } from "@/lib/queries";
import { liveRuns } from "@/lib/runtime/reaper";
import {
  CREATE_EVENT,
  FIND_FREE_SLOTS,
  endVoiceCall,
  executeVoiceAction,
  startVoiceCall,
  translateVoiceCall,
  voiceAppsFor,
  voiceCallSettings,
  voiceSessionConfig,
  type VoiceDeps,
} from "./voice-line";

const WS = "ws_astronom";
const TZ = "America/Chicago";

async function insertAgent(overrides: Partial<AgentRow> = {}): Promise<AgentRow> {
  const now = new Date();
  const row = {
    id: `agt_voice_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: WS,
    name: "After-hours receptionist",
    slug: `receptionist-${Math.random().toString(36).slice(2, 8)}`,
    role: "orchestrator" as const,
    rank: "orchestrator" as const,
    instructions: "You answer after-hours calls for a car dealership.",
    modelPolicy: policyFor("standard", "orchestrator"),
    grants: grantsFor(ORCHESTRATOR_TOOLS),
    allowedTools: [...ORCHESTRATOR_TOOLS],
    dataClass: "internal" as const,
    status: "draft" as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await getDb().insert(agents).values(row);
  const [stored] = await getDb().select().from(agents).where(eq(agents.id, row.id));
  if (!stored) throw new Error("agent was not stored");
  return stored;
}

function fakeComposio(preview = "{}") {
  const calls: Array<{ userId: string; toolkit: string; action: string; arguments?: Record<string, unknown> }> = [];
  const deps: VoiceDeps = {
    execute: async (input) => {
      calls.push(input);
      return { ok: true, preview };
    },
  };
  return { calls, deps };
}

async function eventsOf(runId: string) {
  const rows = await getDb().select().from(runEvents).where(eq(runEvents.runId, runId));
  return rows.sort((a, b) => a.seq - b.seq).map((row) => row.payload);
}

async function openCall(agent: AgentRow, allowBooking: boolean, apps = ["googlecalendar"]) {
  return startVoiceCall({
    agent,
    operatorUserId: "local:usr_test",
    settings: { allowBooking, timeZone: TZ, apps },
    model: "gemini-live-test",
  });
}

describe("voice line apps and session", () => {
  it("offers only apps the operator linked, within the agent's own scope", () => {
    const agent = { role: "orchestrator" as const, allowedConnectors: [] as string[] };
    expect(voiceAppsFor(agent, ["googlecalendar", "gmail", "serpapi"])).toEqual(["googlecalendar", "gmail"]);
    expect(voiceAppsFor(agent, ["googlecalendar", "gmail"], ["googlecalendar"])).toEqual(["googlecalendar"]);
    expect(voiceAppsFor({ ...agent, allowedConnectors: ["googlecalendar"] }, ["gmail"])).toEqual([]);
    expect(voiceAppsFor({ role: "worker", allowedConnectors: [] }, ["googlecalendar"])).toEqual([]);
  });

  it("frames the agent for a phone call with calendar functions", () => {
    const config = voiceSessionConfig(
      { name: "After-hours receptionist", instructions: "Answer calls for a dealership." },
      ["googlecalendar"],
      { now: "2026-10-25T02:00:00Z", timeZone: TZ, allowBooking: true },
    );
    expect(config.systemInstruction).toContain("Answer calls for a dealership.");
    expect(config.systemInstruction).toContain("phone call");
    expect(config.systemInstruction).toContain(TZ);
    // 02:00 UTC on Oct 25 is 9 PM on Oct 24 in Chicago.
    expect(config.systemInstruction).toContain("2026-10-24T21:00:00");
    expect(config.functions.map((f) => f.name)).toEqual(["find_open_times", "book_appointment"]);
  });

  it("adds use_app only for other linked apps, and nothing when none are linked", () => {
    const withGmail = voiceSessionConfig({ name: "A", instructions: "x" }, ["googlecalendar", "gmail"], {
      now: new Date(),
      timeZone: TZ,
      allowBooking: false,
    });
    expect(withGmail.functions.map((f) => f.name)).toContain("use_app");
    expect(withGmail.systemInstruction).toContain("Booking is off");
    const none = voiceSessionConfig({ name: "A", instructions: "x" }, [], { now: new Date(), timeZone: TZ, allowBooking: false });
    expect(none.functions).toEqual([]);
  });

  it("maps friendly functions onto Composio calendar actions", () => {
    const find = translateVoiceCall("find_open_times", { date: "2026-10-27", duration_minutes: 30 }, TZ, "R");
    expect(find).toMatchObject({
      action: FIND_FREE_SLOTS,
      arguments: { time_min: "2026-10-27T00:00:00", time_max: "2026-10-28T00:00:00", timezone: TZ, items: ["primary"] },
    });
    const book = translateVoiceCall(
      "book_appointment",
      { start: "2026-10-27T15:30", duration_minutes: 30, customer_name: "Jane Doe", phone: "512-555-0100", reason: "Test drive" },
      TZ,
      "R",
    );
    expect(book).toMatchObject({
      action: CREATE_EVENT,
      arguments: { start_datetime: "2026-10-27T15:30:00", end_datetime: "2026-10-27T16:00:00", timezone: TZ, calendar_id: "primary" },
    });
    expect(translateVoiceCall("book_appointment", { start: "2026-10-27T15:30" }, TZ, "R")).toHaveProperty("error");
  });
});

describe("voice line permissions", () => {
  beforeEach(freshDb);

  it("lets a calendar read through and logs it like the run engine", async () => {
    const agent = await insertAgent();
    const runId = await openCall(agent, false);
    const slots = JSON.stringify({
      calendars: { primary: { free: [{ start: "2026-10-27T14:00:00Z", end: "2026-10-27T16:00:00Z" }] } },
    });
    const { calls, deps } = fakeComposio(slots);
    const outcome = await executeVoiceAction(
      { runId, agent, operatorUserId: "local:usr_test", name: "find_open_times", args: { date: "2026-10-27" }, allowBooking: false },
      deps,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result).toContain("9:00");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ userId: "local:usr_test", toolkit: "googlecalendar", action: FIND_FREE_SLOTS });

    const types = (await eventsOf(runId)).map((p) => p.type);
    expect(types).toContain("tool.requested");
    const completed = (await eventsOf(runId)).find((p) => p.type === "tool.completed");
    expect(completed).toMatchObject({ ok: true, tool: "connector.call" });
  });

  it("books when the owner allowed booking for the call, and audits it", async () => {
    const agent = await insertAgent();
    const runId = await openCall(agent, true);
    const { calls, deps } = fakeComposio('{"id":"evt"}');
    const outcome = await executeVoiceAction(
      {
        runId,
        agent,
        operatorUserId: "local:usr_test",
        name: "book_appointment",
        args: { start: "2026-10-27T15:30", customer_name: "Jane Doe", phone: "512-555-0100", reason: "Test drive" },
        allowBooking: true,
      },
      deps,
    );
    expect(outcome).toMatchObject({ ok: true });
    if (outcome.ok) expect(outcome.result).toContain("Tuesday, October 27");
    expect(calls[0]?.action).toBe(CREATE_EVENT);
    const audits = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, runId), eq(auditLog.action, "voice.appointment_booked")));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.detail).toMatchObject({ customerName: "Jane Doe", start: "2026-10-27T15:30:00" });
    const logs = (await eventsOf(runId)).filter((p) => p.type === "log").map((p) => (p.type === "log" ? p.message : ""));
    expect(logs.some((m) => m.startsWith("Booking allowed"))).toBe(true);
  });

  it("refuses a booking when booking was not allowed, without calling the app", async () => {
    const agent = await insertAgent();
    const runId = await openCall(agent, false);
    const { calls, deps } = fakeComposio();
    const outcome = await executeVoiceAction(
      {
        runId,
        agent,
        operatorUserId: "local:usr_test",
        name: "book_appointment",
        args: { start: "2026-10-27T15:30", customer_name: "Jane", phone: "555", reason: "Service" },
        allowBooking: false,
      },
      deps,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("Booking is off");
    expect(calls).toHaveLength(0);
    const completed = (await eventsOf(runId)).find((p) => p.type === "tool.completed");
    expect(completed).toMatchObject({ ok: false });
  });

  it("refuses an app the operator did not link for the line", async () => {
    const agent = await insertAgent();
    const runId = await openCall(agent, true);
    const { calls, deps } = fakeComposio();
    const outcome = await executeVoiceAction(
      {
        runId,
        agent,
        operatorUserId: "local:usr_test",
        name: "use_app",
        args: { toolkit: "gmail", action: "GMAIL_FETCH_EMAILS", arguments_json: "{}" },
        allowBooking: true,
      },
      deps,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("isn't connected");
    expect(calls).toHaveLength(0);
  });

  it("refuses other app writes even when booking is allowed", async () => {
    const agent = await insertAgent();
    const runId = await openCall(agent, true, ["googlecalendar", "gmail"]);
    const { calls, deps } = fakeComposio();
    const outcome = await executeVoiceAction(
      {
        runId,
        agent,
        operatorUserId: "local:usr_test",
        name: "use_app",
        args: { toolkit: "gmail", action: "GMAIL_SEND_EMAIL", arguments_json: "{}" },
        allowBooking: true,
      },
      deps,
    );
    expect(outcome.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("voice call lifecycle", () => {
  beforeEach(freshDb);

  it("opens a live run, keeps it from the reaper, and closes it with the transcript", async () => {
    const agent = await insertAgent();
    const runId = await openCall(agent, true);

    const [open] = await getDb().select().from(runs).where(eq(runs.id, runId));
    expect(open).toMatchObject({ status: "running", mode: "live", goal: "Voice call", operatorUserId: "local:usr_test" });
    expect(liveRuns().has(runId)).toBe(true);
    expect(await voiceCallSettings(runId)).toEqual({ allowBooking: true, timeZone: TZ, apps: ["googlecalendar"] });

    const { deps } = fakeComposio('{"id":"evt"}');
    await executeVoiceAction(
      {
        runId,
        agent,
        operatorUserId: "local:usr_test",
        name: "book_appointment",
        args: { start: "2026-10-27T15:30", customer_name: "Jane", phone: "555", reason: "Service" },
        allowBooking: true,
      },
      deps,
    );

    await endVoiceCall(runId, [
      { role: "agent", text: "Thanks for calling. How can I help you today?" },
      { role: "caller", text: "I'd like a service appointment." },
    ]);

    const [closed] = await getDb().select().from(runs).where(eq(runs.id, runId));
    expect(closed?.status).toBe("succeeded");
    expect(closed?.endedAt).toBeInstanceOf(Date);
    expect(closed?.summary).toBe("Call ended. Booked 1 appointment.");
    expect(liveRuns().has(runId)).toBe(false);

    const messages = (await eventsOf(runId)).filter((p) => p.type === "agent.message");
    expect(messages.map((p) => (p.type === "agent.message" ? p.role : ""))).toEqual(["assistant", "user"]);
    expect((await eventsOf(runId)).some((p) => p.type === "run.completed")).toBe(true);
    expect(await getDb().select().from(taskLog).where(eq(taskLog.runId, runId))).toHaveLength(1);

    const listed = (await listRuns(WS)).find((row) => row.id === runId);
    expect(listed).toMatchObject({ agentName: "After-hours receptionist", status: "succeeded" });

    // Hanging up twice changes nothing.
    const before = (await eventsOf(runId)).length;
    await endVoiceCall(runId, [{ role: "caller", text: "bye" }]);
    expect((await eventsOf(runId)).length).toBe(before);
  });
});
