"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { applyTranscript, useLiveSession, type LiveToolCall, type LiveTranscript } from "./use-live-session";
import { VoiceSphere } from "./voice-sphere";
import {
  bookedLabel,
  callStateLabel,
  endPayload,
  inCall,
  sessionErrorMessage,
  sphereState,
} from "./voice-line-model";
import styles from "./voice-line.module.css";

interface Booking {
  /** How many transcript lines came before it, so it shows in the right place. */
  at: number;
  label: string;
}

interface SessionResponse {
  runId?: string;
  token?: string;
  model?: string;
  apiVersion?: string;
  error?: string;
}

/** Keepalive requests are capped at 64 KB in browsers. */
const KEEPALIVE_LIMIT = 60_000;

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** A live phone line to one agent: start a call, talk, hang up. */
export function VoiceLine({ agentId, agentName }: { agentId: string; agentName: string }) {
  const base = `/api/voice/${encodeURIComponent(agentId)}`;
  const [allowBooking, setAllowBooking] = useState(true);
  const [lines, setLines] = useState<LiveTranscript[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);

  const allowRef = useRef(allowBooking);
  useEffect(() => {
    allowRef.current = allowBooking;
  }, [allowBooking]);
  const linesRef = useRef<LiveTranscript[]>([]);
  const runIdRef = useRef<string | null>(null);
  /** Calls whose end was already sent, so each is closed exactly once. */
  const endedRef = useRef(new Set<string>());
  /** Bumped on every start and hang-up, so a session that arrives late is closed instead of used. */
  const attemptRef = useRef(0);
  const transcriptRef = useRef<HTMLOListElement>(null);

  const sendEnd = useCallback(
    (id: string | null, unloading = false) => {
      if (!id || endedRef.current.has(id)) return;
      endedRef.current.add(id);
      const body = JSON.stringify(endPayload(id, id === runIdRef.current ? linesRef.current : []));
      const url = `${base}/end`;
      if (unloading && typeof navigator.sendBeacon === "function") {
        // text/plain keeps the beacon a simple request; the route reads the body as JSON either way.
        if (navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return;
      }
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: body.length < KEEPALIVE_LIMIT,
      }).catch(() => {});
    },
    [base],
  );

  const start = useCallback(async () => {
    const attempt = attemptRef.current;
    let res: Response;
    try {
      res = await fetch(`${base}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowBooking: allowRef.current, timeZone: browserTimeZone() }),
      });
    } catch {
      throw new Error("Could not reach the server. Try again.");
    }
    const data = (await res.json().catch(() => null)) as SessionResponse | null;
    if (!res.ok || !data?.runId || !data.token || !data.model) {
      throw new Error(sessionErrorMessage(res.status, data?.error));
    }
    if (attempt !== attemptRef.current) {
      // Hung up while the line was opening: close the call that was just opened.
      sendEnd(data.runId);
      throw new Error("Call cancelled.");
    }
    runIdRef.current = data.runId;
    setRunId(data.runId);
    setPlaced(true);
    return { token: data.token, model: data.model, ...(data.apiVersion ? { apiVersion: data.apiVersion } : {}) };
  }, [base, sendEnd]);

  const onToolCall = useCallback(
    async (call: LiveToolCall) => {
      const id = runIdRef.current;
      if (!id) return { error: "The call is not connected." };
      try {
        const res = await fetch(`${base}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: id, name: call.name, args: call.args }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok: true; result: string }
          | { ok: false; error: string }
          | { error?: string }
          | null;
        if (data && "ok" in data && data.ok) {
          const label = bookedLabel(call.name, call.args, true);
          if (label) setBookings((prev) => [...prev, { at: linesRef.current.length, label }]);
          return data.result;
        }
        return { error: data?.error || "That didn't work." };
      } catch {
        return { error: "Could not reach the server." };
      }
    },
    [base],
  );

  const onTranscript = useCallback((t: LiveTranscript) => {
    linesRef.current = applyTranscript(linesRef.current, t);
    setLines(linesRef.current);
  }, []);

  const onClose = useCallback(() => sendEnd(runIdRef.current), [sendEnd]);

  const live = useLiveSession({ start, onToolCall, onTranscript, onClose });
  const { status, connect, disconnect } = live;
  const calling = inCall(status);
  const ended = placed && !calling;

  // A call that failed before it went live never reaches onClose; close its run here.
  useEffect(() => {
    if (status === "error" && runId) sendEnd(runId);
  }, [status, runId, sendEnd]);

  // Closing or reloading the tab hangs up.
  useEffect(() => {
    const onHide = () => sendEnd(runIdRef.current, true);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [sendEnd]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, bookings]);

  function startCall() {
    attemptRef.current++;
    runIdRef.current = null;
    linesRef.current = [];
    setRunId(null);
    setLines([]);
    setBookings([]);
    void connect();
  }

  function hangUp() {
    attemptRef.current++;
    setPlaced(true);
    disconnect();
    sendEnd(runIdRef.current);
  }

  const message = status === "error" && live.error && live.error !== "Call cancelled." ? live.error : null;

  const transcript: ReactNode[] = [];
  const pushBookings = (at: number) => {
    bookings.forEach((b, i) => {
      if (b.at === at) {
        transcript.push(
          <li key={`b${i}`} className={styles.booked}>
            {b.label}
          </li>,
        );
      }
    });
  };
  pushBookings(0);
  lines.forEach((line, i) => {
    const text = line.text.trim();
    if (text) {
      transcript.push(
        <li key={`l${i}`} className={line.final ? styles.line : `${styles.line} ${styles.partial}`}>
          <span className={styles.speaker}>{line.role === "user" ? "Caller" : agentName}</span>
          {text}
        </li>,
      );
    }
    pushBookings(i + 1);
  });

  return (
    <div className={styles.root}>
      <h1 className={styles.name}>{agentName}</h1>
      <p className={styles.state} aria-live="polite">
        {callStateLabel(status, ended)}
      </p>

      <VoiceSphere
        state={sphereState(status)}
        inputLevel={live.inputLevel}
        outputLevel={live.outputLevel}
        size={300}
        className={styles.sphere}
      />

      {transcript.length > 0 && (
        <ol ref={transcriptRef} className={styles.transcript} aria-label="Transcript">
          {transcript}
        </ol>
      )}

      <div className={styles.controls}>
        {calling ? (
          <button type="button" className="btn" onClick={hangUp}>
            End call
          </button>
        ) : (
          <>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={allowBooking}
                onChange={(event) => setAllowBooking(event.target.checked)}
              />
              Let it book appointments during this call
            </label>
            <button type="button" className="btn primary" onClick={startCall}>
              {ended ? "Call again" : "Start call"}
            </button>
            {ended && runId && (
              <Link href={`/runs/${runId}`} className={styles.link}>
                See the call in Runs
              </Link>
            )}
          </>
        )}
      </div>

      {message && <p className={`error-text ${styles.error}`}>{message}</p>}
    </div>
  );
}
