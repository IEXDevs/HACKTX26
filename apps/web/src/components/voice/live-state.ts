// Pure state for a live voice session: turns server messages into events, and
// events into status and transcripts. No SDK or browser APIs here, so it can be
// tested with recorded-style messages.

export type LiveStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export interface LiveToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LiveTranscript {
  role: "user" | "agent";
  text: string;
  final: boolean;
}

/** The subset of the SDK's LiveServerMessage this module reads. */
export interface ServerMessageLike {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
    turnComplete?: boolean;
    interrupted?: boolean;
    generationComplete?: boolean;
    waitingForInput?: boolean;
    inputTranscription?: { text?: string; finished?: boolean };
    outputTranscription?: { text?: string; finished?: boolean };
  };
  toolCall?: { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] };
  toolCallCancellation?: { ids?: string[] };
  goAway?: { timeLeft?: string };
}

export type ServerEvent =
  | { type: "audio"; data: string; mimeType?: string }
  | { type: "transcript"; role: "user" | "agent"; text: string; finished: boolean }
  | { type: "interrupted" }
  | { type: "waiting" }
  | { type: "turn-complete" }
  | { type: "tool-call"; calls: LiveToolCall[] }
  | { type: "tool-cancel"; ids: string[] }
  | { type: "go-away"; timeLeft?: string };

export function interpretMessage(msg: ServerMessageLike): ServerEvent[] {
  const events: ServerEvent[] = [];
  const sc = msg.serverContent;
  if (sc) {
    // Interruption comes first so queued audio is dropped before anything new plays.
    if (sc.interrupted) events.push({ type: "interrupted" });
    if (sc.inputTranscription?.text || sc.inputTranscription?.finished) {
      events.push({
        type: "transcript",
        role: "user",
        text: sc.inputTranscription.text ?? "",
        finished: !!sc.inputTranscription.finished,
      });
    }
    for (const part of sc.modelTurn?.parts ?? []) {
      const data = part.inlineData?.data;
      if (data && (part.inlineData?.mimeType ?? "audio/pcm").startsWith("audio/")) {
        events.push({ type: "audio", data, mimeType: part.inlineData?.mimeType });
      }
    }
    if (sc.outputTranscription?.text || sc.outputTranscription?.finished) {
      events.push({
        type: "transcript",
        role: "agent",
        text: sc.outputTranscription.text ?? "",
        finished: !!sc.outputTranscription.finished,
      });
    }
    if (sc.waitingForInput) events.push({ type: "waiting" });
    if (sc.turnComplete) events.push({ type: "turn-complete" });
  }
  const calls = msg.toolCall?.functionCalls;
  if (calls?.length) {
    events.push({
      type: "tool-call",
      calls: calls.map((c, i) => ({ id: c.id ?? `call-${i}`, name: c.name ?? "", args: c.args ?? {} })),
    });
  }
  if (msg.toolCallCancellation?.ids?.length) events.push({ type: "tool-cancel", ids: msg.toolCallCancellation.ids });
  if (msg.goAway) events.push({ type: "go-away", timeLeft: msg.goAway.timeLeft });
  return events;
}

export interface LiveState {
  status: LiveStatus;
  error: string | null;
  userText: string;
  agentText: string;
  /** The person has said something this turn that the agent has not answered yet. */
  heardUser: boolean;
  /** Agent audio is still playing out. */
  playing: boolean;
  /** The model finished its turn (it may still be playing out). */
  turnDone: boolean;
  pendingTools: number;
  /** The server warned that it will close the connection soon. */
  goingAway: boolean;
}

export type LiveAction =
  | ServerEvent
  | { type: "connecting" }
  | { type: "connected" }
  | { type: "playback"; playing: boolean }
  | { type: "user-quiet" }
  | { type: "text-sent"; text: string }
  | { type: "tool-done" }
  | { type: "stale" }
  | { type: "failed"; message: string }
  | { type: "closed"; byUser: boolean }
  | { type: "reset" };

export const initialLiveState: LiveState = {
  status: "idle",
  error: null,
  userText: "",
  agentText: "",
  heardUser: false,
  playing: false,
  turnDone: true,
  pendingTools: 0,
  goingAway: false,
};

export interface LiveStep {
  state: LiveState;
  transcripts: LiveTranscript[];
}

const ACTIVE: LiveStatus[] = ["listening", "thinking", "speaking"];

export function reduceLive(state: LiveState, action: LiveAction): LiveStep {
  const out: LiveTranscript[] = [];
  let s = { ...state };

  const finalize = (role: "user" | "agent") => {
    const key = role === "user" ? "userText" : "agentText";
    const text = s[key].trim();
    if (text) out.push({ role, text, final: true });
    s[key] = "";
  };
  // When nothing is playing or pending, the floor goes back to the person.
  const settle = () => {
    if (s.turnDone && !s.playing && s.pendingTools === 0) {
      s.status = "listening";
      s.heardUser = false;
    }
  };

  switch (action.type) {
    case "reset":
      return { state: { ...initialLiveState }, transcripts: [] };
    case "connecting":
      return { state: { ...initialLiveState, status: "connecting" }, transcripts: [] };
    case "connected":
      if (s.status !== "connecting") return { state, transcripts: [] };
      return { state: { ...initialLiveState, status: "listening" }, transcripts: [] };
    case "failed":
      finalize("user");
      finalize("agent");
      s = { ...initialLiveState, status: "error", error: action.message };
      return { state: s, transcripts: out };
    case "closed":
      finalize("user");
      finalize("agent");
      if (action.byUser) s = { ...initialLiveState };
      else if (s.status !== "error") {
        s = {
          ...initialLiveState,
          status: "error",
          error: state.goingAway ? "The call reached its time limit." : "The call ended unexpectedly.",
        };
      }
      return { state: s, transcripts: out };
  }

  // Everything below only applies while a call is live.
  if (!ACTIVE.includes(s.status)) return { state, transcripts: [] };

  switch (action.type) {
    case "transcript": {
      if (action.role === "user") {
        s.userText += action.text;
        if (action.text.trim()) s.heardUser = true;
        if (s.userText.trim()) out.push({ role: "user", text: s.userText.trim(), final: action.finished });
        if (action.finished) {
          s.userText = "";
          if (s.status === "listening" && s.heardUser) s.status = "thinking";
        }
      } else {
        finalize("user");
        s.agentText += action.text;
        if (s.agentText.trim()) out.push({ role: "agent", text: s.agentText.trim(), final: action.finished });
        if (action.finished) s.agentText = "";
      }
      break;
    }
    case "audio":
      finalize("user");
      s.heardUser = false;
      s.turnDone = false;
      s.playing = true;
      s.status = "speaking";
      break;
    case "playback":
      s.playing = action.playing;
      if (action.playing) s.status = "speaking";
      else settle();
      break;
    case "interrupted":
      finalize("agent");
      s.playing = false;
      s.turnDone = true;
      s.status = "listening";
      break;
    case "waiting":
      s.heardUser = false;
      if (s.status === "thinking" && s.pendingTools === 0) s.status = "listening";
      break;
    case "turn-complete":
      finalize("user");
      finalize("agent");
      s.turnDone = true;
      settle();
      break;
    case "tool-call":
      finalize("user");
      s.pendingTools += action.calls.length;
      s.heardUser = false;
      s.turnDone = false;
      if (!s.playing) s.status = "thinking";
      break;
    case "tool-cancel":
      // Cancelled calls get no response, so stop waiting on them.
      s.pendingTools = Math.max(0, s.pendingTools - action.ids.length);
      break;
    case "tool-done":
      s.pendingTools = Math.max(0, s.pendingTools - 1);
      break;
    case "user-quiet":
      if (s.status === "listening" && s.heardUser) s.status = "thinking";
      break;
    case "text-sent":
      finalize("user");
      if (action.text.trim()) out.push({ role: "user", text: action.text.trim(), final: true });
      s.heardUser = true;
      if (!s.playing) s.status = "thinking";
      break;
    case "stale":
      if (s.status === "thinking" && s.pendingTools === 0) {
        s.status = "listening";
        s.heardUser = false;
      }
      break;
    case "go-away":
      s.goingAway = true;
      break;
  }
  return { state: s, transcripts: out };
}

/**
 * Folds a transcript update into a list of lines: a partial replaces the
 * newest unfinished line from the same speaker, otherwise it starts a new line.
 * Updates for the two speakers can interleave, so pages should use this rather
 * than "replace the last line".
 */
export function applyTranscript(lines: LiveTranscript[], t: LiveTranscript): LiveTranscript[] {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.role === t.role) {
      if (!line.final) {
        const next = lines.slice();
        next[i] = t;
        return next;
      }
      break;
    }
  }
  return [...lines, t];
}
