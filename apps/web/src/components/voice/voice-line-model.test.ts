import { describe, expect, it } from "vitest";
import {
  bookedLabel,
  callStateLabel,
  endPayload,
  parseBookingStart,
  sessionErrorMessage,
  sphereState,
} from "./voice-line-model";

describe("endPayload", () => {
  it("maps speakers to caller and agent and drops empty lines", () => {
    expect(
      endPayload("run_1", [
        { role: "agent", text: "Thanks for calling.", final: true },
        { role: "user", text: "  Hi, I need a test drive. ", final: true },
        { role: "user", text: "   ", final: true },
        { role: "agent", text: "Sure, when works?", final: false },
      ]),
    ).toEqual({
      runId: "run_1",
      transcript: [
        { role: "agent", text: "Thanks for calling." },
        { role: "caller", text: "Hi, I need a test drive." },
        { role: "agent", text: "Sure, when works?" },
      ],
    });
  });

  it("clips long lines and keeps the most recent lines within the route's limits", () => {
    const lines = Array.from({ length: 1_005 }, (_, i) => ({ role: "user" as const, text: `line ${i}`, final: true }));
    lines.push({ role: "user", text: "x".repeat(5_000), final: true });
    const { transcript } = endPayload("run_2", lines);
    expect(transcript).toHaveLength(1_000);
    expect(transcript[0]!.text).toBe("line 6");
    expect(transcript.at(-1)!.text).toHaveLength(4_000);
  });
});

describe("call state", () => {
  it("labels each status and the ended state", () => {
    expect(callStateLabel("idle", false)).toBe("Ready");
    expect(callStateLabel("connecting", false)).toBe("Connecting…");
    expect(callStateLabel("listening", false)).toBe("Listening");
    expect(callStateLabel("thinking", false)).toBe("Thinking");
    expect(callStateLabel("speaking", false)).toBe("Speaking");
    expect(callStateLabel("idle", true)).toBe("Call ended");
    expect(callStateLabel("error", true)).toBe("Call ended");
    expect(callStateLabel("error", false)).toBe("Ready");
  });

  it("rests the sphere when the call failed", () => {
    expect(sphereState("error")).toBe("idle");
    expect(sphereState("speaking")).toBe("speaking");
  });
});

describe("sessionErrorMessage", () => {
  it("uses plain wording by status", () => {
    expect(sessionErrorMessage(503, "Voice calls are not set up yet. Add a Gemini API key.")).toBe("Voice isn't set up yet.");
    expect(sessionErrorMessage(401)).toBe("Sign in to start a call.");
    expect(sessionErrorMessage(404)).toBe("This agent can't take calls.");
    expect(sessionErrorMessage(500, "Something specific.")).toBe("Something specific.");
    expect(sessionErrorMessage(500)).toBe("Could not start the call. Try again.");
  });
});

describe("booking", () => {
  it("reads a local start time as the caller's own clock", () => {
    const date = parseBookingStart("2026-10-27T14:30")!;
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]).toEqual([
      2026, 9, 27, 14, 30,
    ]);
  });

  it("keeps an explicit offset", () => {
    expect(parseBookingStart("2026-10-27T14:30:00Z")!.toISOString()).toBe("2026-10-27T14:30:00.000Z");
    expect(parseBookingStart("not a time")).toBeNull();
  });

  it("labels a successful booking in local time", () => {
    // ICU versions differ on the space before "PM", so compare with plain spaces.
    const label = bookedLabel("book_appointment", { start: "2026-10-27T14:30" }, true, "en-US");
    expect(label?.replace(/\s/g, " ")).toBe("Booked: Tue, Oct 27, 2:30 PM");
  });

  it("ignores refusals, other tools, and unreadable times", () => {
    expect(bookedLabel("book_appointment", { start: "2026-10-27T14:30" }, false, "en-US")).toBeNull();
    expect(bookedLabel("find_open_times", { start: "2026-10-27T14:30" }, true, "en-US")).toBeNull();
    expect(bookedLabel("book_appointment", { start: 42 }, true, "en-US")).toBeNull();
  });
});
