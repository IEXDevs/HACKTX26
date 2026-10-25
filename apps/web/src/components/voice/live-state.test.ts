import { describe, expect, it } from "vitest";
import {
  applyTranscript,
  initialLiveState,
  interpretMessage,
  reduceLive,
  type LiveAction,
  type LiveState,
  type LiveTranscript,
  type ServerMessageLike,
} from "./live-state";

function run(actions: LiveAction[], from: LiveState = initialLiveState) {
  let state = from;
  const transcripts: LiveTranscript[] = [];
  const statuses: string[] = [];
  for (const a of actions) {
    const step = reduceLive(state, a);
    state = step.state;
    transcripts.push(...step.transcripts);
    statuses.push(state.status);
  }
  return { state, transcripts, statuses };
}

function feed(messages: ServerMessageLike[]): LiveAction[] {
  return messages.flatMap((m) => interpretMessage(m));
}

const live: LiveAction[] = [{ type: "connecting" }, { type: "connected" }];

describe("interpretMessage", () => {
  it("reads audio, transcripts and turn flags in order", () => {
    const events = interpretMessage({
      serverContent: {
        interrupted: true,
        modelTurn: { parts: [{ inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" } }] },
        outputTranscription: { text: " Hi" },
        turnComplete: true,
      },
    });
    expect(events.map((e) => e.type)).toEqual(["interrupted", "audio", "transcript", "turn-complete"]);
  });

  it("reads tool calls and fills in missing fields", () => {
    const [e] = interpretMessage({ toolCall: { functionCalls: [{ id: "a1", name: "set_name", args: { name: "Pat" } }, {}] } });
    expect(e).toEqual({
      type: "tool-call",
      calls: [
        { id: "a1", name: "set_name", args: { name: "Pat" } },
        { id: "call-1", name: "", args: {} },
      ],
    });
  });

  it("ignores setup and empty messages", () => {
    expect(interpretMessage({ setupComplete: {} })).toEqual([]);
    expect(interpretMessage({ serverContent: {} })).toEqual([]);
  });

  it("reads goAway and cancellations", () => {
    expect(interpretMessage({ goAway: { timeLeft: "10s" }, toolCallCancellation: { ids: ["x"] } })).toEqual([
      { type: "tool-cancel", ids: ["x"] },
      { type: "go-away", timeLeft: "10s" },
    ]);
  });
});

describe("reduceLive", () => {
  it("connects into listening", () => {
    expect(run(live).statuses).toEqual(["connecting", "listening"]);
  });

  it("runs a spoken turn: listening, thinking, speaking, listening", () => {
    const { statuses, transcripts, state } = run([
      ...live,
      ...feed([
        { serverContent: { inputTranscription: { text: "Make me" } } },
        { serverContent: { inputTranscription: { text: " a scheduler" } } },
      ]),
      { type: "user-quiet" },
      ...feed([
        { serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAA=", mimeType: "audio/pcm;rate=24000" } }] } } },
        { serverContent: { outputTranscription: { text: "Sure," } } },
        { serverContent: { outputTranscription: { text: " what should" } } },
        { serverContent: { outputTranscription: { text: " it do?" } } },
        { serverContent: { generationComplete: true } },
      ]),
      { type: "playback", playing: false },
      ...feed([{ serverContent: { turnComplete: true } }]),
    ]);
    expect(statuses).toEqual([
      "connecting",
      "listening",
      "listening",
      "listening",
      "thinking",
      "speaking",
      "speaking",
      "speaking",
      "speaking",
      "speaking",
      "listening",
    ]);
    expect(transcripts).toEqual([
      { role: "user", text: "Make me", final: false },
      { role: "user", text: "Make me a scheduler", final: false },
      { role: "user", text: "Make me a scheduler", final: true },
      { role: "agent", text: "Sure,", final: false },
      { role: "agent", text: "Sure, what should", final: false },
      { role: "agent", text: "Sure, what should it do?", final: false },
      { role: "agent", text: "Sure, what should it do?", final: true },
    ]);
    expect(state.userText).toBe("");
    expect(state.agentText).toBe("");
  });

  it("keeps speaking until playback drains after the turn completes", () => {
    const { statuses } = run([
      ...live,
      { type: "audio", data: "AAA=" },
      { type: "turn-complete" },
      { type: "playback", playing: false },
    ]);
    expect(statuses.slice(2)).toEqual(["speaking", "speaking", "listening"]);
  });

  it("goes straight to thinking when the user transcript is marked finished", () => {
    const { state } = run([...live, { type: "transcript", role: "user", text: "hello", finished: true }]);
    expect(state.status).toBe("thinking");
  });

  it("does not think on silence when the person has not spoken", () => {
    expect(run([...live, { type: "user-quiet" }]).state.status).toBe("listening");
  });

  it("drops back to listening on interruption and finalizes what was said", () => {
    const { state, transcripts } = run([
      ...live,
      { type: "audio", data: "AAA=" },
      { type: "transcript", role: "agent", text: "Here is a long", finished: false },
      { type: "interrupted" },
    ]);
    expect(state.status).toBe("listening");
    expect(state.playing).toBe(false);
    expect(transcripts.at(-1)).toEqual({ role: "agent", text: "Here is a long", final: true });
  });

  it("thinks while tools run and settles when they finish", () => {
    const { statuses } = run([
      ...live,
      { type: "tool-call", calls: [{ id: "1", name: "a", args: {} }, { id: "2", name: "b", args: {} }] },
      { type: "tool-done" },
      { type: "turn-complete" },
      { type: "tool-done" },
      { type: "audio", data: "AAA=" },
      { type: "turn-complete" },
      { type: "playback", playing: false },
    ]);
    expect(statuses.slice(2)).toEqual(["thinking", "thinking", "thinking", "thinking", "speaking", "speaking", "listening"]);
  });

  it("counts cancelled tool calls as done", () => {
    const { state } = run([
      ...live,
      { type: "tool-call", calls: [{ id: "1", name: "a", args: {} }] },
      { type: "tool-cancel", ids: ["1"] },
      { type: "turn-complete" },
    ]);
    expect(state.pendingTools).toBe(0);
    expect(state.status).toBe("listening");
  });

  it("emits typed text as a final user line and starts thinking", () => {
    const { state, transcripts } = run([...live, { type: "text-sent", text: "  add Slack " }]);
    expect(state.status).toBe("thinking");
    expect(transcripts).toEqual([{ role: "user", text: "add Slack", final: true }]);
  });

  it("returns to listening when the model waits for more input or goes quiet too long", () => {
    expect(run([...live, { type: "text-sent", text: "hm" }, { type: "waiting" }]).state.status).toBe("listening");
    expect(run([...live, { type: "text-sent", text: "hm" }, { type: "stale" }]).state.status).toBe("listening");
  });

  it("ignores server events before connecting and after closing", () => {
    expect(run([{ type: "audio", data: "AAA=" }]).state.status).toBe("idle");
    expect(run([...live, { type: "closed", byUser: true }, { type: "audio", data: "AAA=" }]).state.status).toBe("idle");
  });

  it("turns an unexpected close into a plain error", () => {
    expect(run([...live, { type: "closed", byUser: false }]).state).toMatchObject({
      status: "error",
      error: "The call ended unexpectedly.",
    });
    expect(run([...live, { type: "go-away", timeLeft: "5s" }, { type: "closed", byUser: false }]).state.error).toBe(
      "The call reached its time limit.",
    );
  });

  it("keeps the first error when the socket closes after a failure", () => {
    const { state } = run([...live, { type: "failed", message: "Microphone access was blocked." }, { type: "closed", byUser: false }]);
    expect(state.error).toBe("Microphone access was blocked.");
  });

  it("finalizes pending lines when the call closes", () => {
    const { transcripts } = run([
      ...live,
      { type: "transcript", role: "user", text: "one more", finished: false },
      { type: "closed", byUser: true },
    ]);
    expect(transcripts.at(-1)).toEqual({ role: "user", text: "one more", final: true });
  });
});

describe("applyTranscript", () => {
  it("replaces the open line per speaker even when updates interleave", () => {
    let lines: LiveTranscript[] = [];
    lines = applyTranscript(lines, { role: "user", text: "Hi", final: false });
    lines = applyTranscript(lines, { role: "agent", text: "Hel", final: false });
    lines = applyTranscript(lines, { role: "user", text: "Hi there", final: true });
    lines = applyTranscript(lines, { role: "agent", text: "Hello", final: true });
    lines = applyTranscript(lines, { role: "user", text: "Next", final: false });
    expect(lines).toEqual([
      { role: "user", text: "Hi there", final: true },
      { role: "agent", text: "Hello", final: true },
      { role: "user", text: "Next", final: false },
    ]);
  });
});
