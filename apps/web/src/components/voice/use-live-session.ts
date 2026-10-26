"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveServerMessage, Session } from "@google/genai";
import {
  Resampler,
  float32ToPcm16Base64,
  levelFromRms,
  pcm16Base64ToFloat32,
  rateFromMime,
  rms,
  smoothLevel,
} from "./pcm";
import {
  initialLiveState,
  interpretMessage,
  reduceLive,
  type LiveAction,
  type LiveState,
  type LiveStatus,
  type LiveToolCall,
  type LiveTranscript,
} from "./live-state";

export type { LiveStatus, LiveToolCall, LiveTranscript } from "./live-state";
export { applyTranscript } from "./live-state";

export interface LiveSessionOptions {
  /** Fetches a short-lived token from our server. `apiVersion` defaults to "v1beta". */
  start: () => Promise<{ token: string; model: string; apiVersion?: string }>;
  /** The resolved value is sent back to the model as the function result. */
  onToolCall: (call: LiveToolCall) => Promise<unknown>;
  onTranscript?: (t: LiveTranscript) => void;
  /** Called once each time a connected call ends, whoever ended it. */
  onClose?: () => void;
}

export interface LiveSession {
  status: LiveStatus;
  error: string | null;
  /** Call from a click or tap: browsers only allow audio to start from a user gesture. */
  connect: () => Promise<void>;
  disconnect: () => void;
  inputLevel: () => number;
  outputLevel: () => number;
  sendText: (text: string) => void;
}

const MIC_RATE = 16000;
const OUT_RATE = 24000;
const SEND_SAMPLES = 1600; // 100 ms at 16 kHz
const TICK_MS = 100;
const QUIET_LEVEL = 0.18;
const QUIET_MS = 700;
const STALE_MS = 15000;
const CONNECT_TIMEOUT_MS = 15000;

// Copies mic audio off the audio thread in ~40 ms blocks.
const WORKLET = `
class AstroCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate * 0.04);
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.size) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("astro-capture", AstroCapture);
`;

interface Call {
  gen: number;
  ctx: AudioContext;
  session: Session | null;
  stream: MediaStream | null;
  worklet: AudioWorkletNode | null;
  micAnalyser: AnalyserNode;
  outAnalyser: AnalyserNode;
  outGain: GainNode;
  sources: Set<AudioBufferSourceNode>;
  playhead: number;
  resampler: Resampler | null;
  outbox: Float32Array;
  outboxLen: number;
  tick: ReturnType<typeof setInterval> | null;
  quietMs: number;
  micBuf: Float32Array<ArrayBuffer>;
  thinkingSince: number;
  cancelled: Set<string>;
  closed: boolean;
  workletUrl: string | null;
}

function micError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access was blocked. Allow it in your browser and try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found.";
  if (name === "NotReadableError") return "The microphone is in use by another app.";
  return "Could not use the microphone.";
}

function plainError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message && err.message.length < 140) return err.message;
  return fallback;
}

export function useLiveSession(opts: LiveSessionOptions): LiveSession {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const stateRef = useRef<LiveState>(initialLiveState);
  const callRef = useRef<Call | null>(null);
  const genRef = useRef(0);
  const mountedRef = useRef(true);
  const levels = useRef({ in: 0, out: 0, inAt: 0, outAt: 0 });
  const scratch = useRef<Float32Array<ArrayBuffer> | null>(null);

  const dispatch = useCallback((action: LiveAction) => {
    const prev = stateRef.current;
    const { state, transcripts } = reduceLive(prev, action);
    stateRef.current = state;
    if (mountedRef.current) {
      if (state.status !== prev.status) setStatus(state.status);
      if (state.error !== prev.error) setError(state.error);
    }
    for (const t of transcripts) optsRef.current.onTranscript?.(t);
  }, []);

  const stopPlayback = useCallback((call: Call) => {
    for (const src of call.sources) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {}
    }
    call.sources.clear();
    call.playhead = 0;
  }, []);

  const teardown = useCallback(
    (call: Call) => {
      if (call.closed) return;
      call.closed = true;
      if (call.tick) clearInterval(call.tick);
      stopPlayback(call);
      call.stream?.getTracks().forEach((t) => t.stop());
      if (call.worklet) {
        call.worklet.port.onmessage = null;
        call.worklet.port.close();
        call.worklet.disconnect();
      }
      try {
        call.session?.close();
      } catch {}
      if (call.workletUrl) URL.revokeObjectURL(call.workletUrl);
      void call.ctx.close().catch(() => {});
      if (callRef.current === call) callRef.current = null;
      levels.current.in = 0;
      levels.current.out = 0;
    },
    [stopPlayback],
  );

  // Ends the call. `byUser` decides between returning to idle and showing an error.
  const finish = useCallback(
    (call: Call, byUser: boolean, failure?: string) => {
      if (call.closed) return;
      const wasLive = call.session !== null;
      teardown(call);
      if (failure) dispatch({ type: "failed", message: failure });
      dispatch({ type: "closed", byUser });
      if (wasLive) optsRef.current.onClose?.();
    },
    [dispatch, teardown],
  );

  const play = useCallback(
    (call: Call, data: string, mimeType?: string) => {
      const samples = pcm16Base64ToFloat32(data);
      if (!samples.length) return;
      const buffer = call.ctx.createBuffer(1, samples.length, rateFromMime(mimeType, OUT_RATE));
      buffer.copyToChannel(samples, 0);
      const src = call.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(call.outGain);
      const now = call.ctx.currentTime;
      // A short lead after a gap avoids a click; back-to-back chunks join without one.
      const at = call.playhead > now ? call.playhead : now + 0.03;
      src.start(at);
      call.playhead = at + buffer.duration;
      call.sources.add(src);
      src.onended = () => {
        call.sources.delete(src);
        src.disconnect();
      };
    },
    [],
  );

  const runTools = useCallback(
    async (call: Call, calls: LiveToolCall[]) => {
      const responses = await Promise.all(
        calls.map(async (c) => {
          let response: Record<string, unknown>;
          try {
            const result = await optsRef.current.onToolCall(c);
            response = { result: result === undefined ? null : result };
          } catch (err) {
            response = { error: plainError(err, "The action failed.") };
          }
          // Cancelled calls were already counted off when the cancellation arrived.
          if (!call.closed && !call.cancelled.has(c.id)) dispatch({ type: "tool-done" });
          return { id: c.id, name: c.name, response };
        }),
      );
      const live = responses.filter((r) => !call.cancelled.has(r.id));
      if (call.closed || !call.session || !live.length) return;
      try {
        call.session.sendToolResponse({ functionResponses: live });
      } catch {
        finish(call, false, "Lost the connection to the voice service.");
      }
    },
    [dispatch, finish],
  );

  const onMessage = useCallback(
    (call: Call, msg: LiveServerMessage) => {
      if (call.closed) return;
      for (const event of interpretMessage(msg)) {
        if (event.type === "audio") play(call, event.data, event.mimeType);
        if (event.type === "interrupted") stopPlayback(call);
        if (event.type === "tool-cancel") event.ids.forEach((id) => call.cancelled.add(id));
        dispatch(event);
        if (event.type === "tool-call") void runTools(call, event.calls);
      }
    },
    [dispatch, play, runTools, stopPlayback],
  );

  const sendMic = useCallback((call: Call, block: Float32Array) => {
    if (call.closed || !call.session || !call.resampler) return;
    const pcm = call.resampler.process(block);
    let offset = 0;
    while (offset < pcm.length) {
      const take = Math.min(pcm.length - offset, SEND_SAMPLES - call.outboxLen);
      call.outbox.set(pcm.subarray(offset, offset + take), call.outboxLen);
      call.outboxLen += take;
      offset += take;
      if (call.outboxLen === SEND_SAMPLES) {
        call.outboxLen = 0;
        try {
          call.session.sendRealtimeInput({
            audio: { data: float32ToPcm16Base64(call.outbox), mimeType: `audio/pcm;rate=${MIC_RATE}` },
          });
        } catch {}
      }
    }
  }, []);

  const readLevel = useCallback((analyser: AnalyserNode | undefined, key: "in" | "out") => {
    const l = levels.current;
    const at = key === "in" ? l.inAt : l.outAt;
    const now = performance.now();
    if (now - at < 8) return l[key];
    let target = 0;
    if (analyser) {
      if (!scratch.current || scratch.current.length !== analyser.fftSize) scratch.current = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(scratch.current);
      target = levelFromRms(rms(scratch.current));
    }
    l[key] = smoothLevel(l[key], target, Math.min(100, now - at));
    if (key === "in") l.inAt = now;
    else l.outAt = now;
    return l[key];
  }, []);

  const inputLevel = useCallback(() => readLevel(callRef.current?.micAnalyser, "in"), [readLevel]);
  const outputLevel = useCallback(() => readLevel(callRef.current?.outAnalyser, "out"), [readLevel]);

  const tick = useCallback(
    (call: Call) => {
      if (call.closed) return;
      const s = stateRef.current;
      const playing = call.sources.size > 0;
      if (playing !== s.playing) dispatch({ type: "playback", playing });

      // Raw mic level, so the quiet timer does not depend on anyone drawing the levels.
      call.micAnalyser.getFloatTimeDomainData(call.micBuf);
      call.quietMs = levelFromRms(rms(call.micBuf)) < QUIET_LEVEL ? call.quietMs + TICK_MS : 0;
      const now = stateRef.current;
      if (now.status === "listening" && now.heardUser && call.quietMs >= QUIET_MS) dispatch({ type: "user-quiet" });

      if (stateRef.current.status === "thinking") {
        call.thinkingSince ||= performance.now();
        if (performance.now() - call.thinkingSince > STALE_MS) dispatch({ type: "stale" });
      } else call.thinkingSince = 0;
    },
    [dispatch],
  );

  const connect = useCallback(async () => {
    const current = callRef.current;
    if (current && !current.closed) return;
    const gen = ++genRef.current;

    // Create and resume the audio context before any await so it counts as part of the click.
    const Ctx: typeof AudioContext | undefined =
      typeof window === "undefined"
        ? undefined
        : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx || !navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: "failed", message: "This browser can't do voice calls. Try a recent Chrome, Edge, Safari or Firefox." });
      return;
    }
    dispatch({ type: "connecting" });
    const ctx = new Ctx();
    void ctx.resume().catch(() => {});

    const micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 1024;
    micAnalyser.smoothingTimeConstant = 0;
    const outAnalyser = ctx.createAnalyser();
    outAnalyser.fftSize = 1024;
    outAnalyser.smoothingTimeConstant = 0;
    const outGain = ctx.createGain();
    outGain.connect(outAnalyser);
    outAnalyser.connect(ctx.destination);

    const call: Call = {
      gen,
      ctx,
      session: null,
      stream: null,
      worklet: null,
      micAnalyser,
      outAnalyser,
      outGain,
      sources: new Set(),
      playhead: 0,
      resampler: null,
      outbox: new Float32Array(SEND_SAMPLES),
      outboxLen: 0,
      tick: null,
      quietMs: 0,
      micBuf: new Float32Array(micAnalyser.fftSize),
      thinkingSince: 0,
      cancelled: new Set(),
      closed: false,
      workletUrl: null,
    };
    callRef.current = call;
    const stale = () => call.closed || genRef.current !== gen;

    // Mic permission and the token request run side by side.
    const micPromise = navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
      .then(
        (stream) => ({ stream }),
        (err: unknown) => ({ error: micError(err) }),
      );
    const tokenPromise = optsRef.current.start().then(
      (t) => ({ token: t }),
      (err: unknown) => ({ error: plainError(err, "Could not start the call.") }),
    );

    const mic = await micPromise;
    if (stale()) {
      if ("stream" in mic) mic.stream.getTracks().forEach((t) => t.stop());
      return;
    }
    if ("error" in mic) return finish(call, false, mic.error);
    call.stream = mic.stream;

    try {
      call.workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(call.workletUrl);
    } catch {
      if (!stale()) finish(call, false, "This browser can't record audio for voice calls.");
      return;
    }
    if (stale()) return;

    const source = ctx.createMediaStreamSource(mic.stream);
    const worklet = new AudioWorkletNode(ctx, "astro-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(micAnalyser);
    source.connect(worklet);
    // Some browsers only run a worklet that leads to the speakers, so route it through silence.
    worklet.connect(mute);
    mute.connect(ctx.destination);
    call.worklet = worklet;
    call.resampler = new Resampler(ctx.sampleRate, MIC_RATE);
    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => sendMic(call, e.data);

    const tok = await tokenPromise;
    if (stale()) return;
    if ("error" in tok) return finish(call, false, tok.error);

    let session: Session;
    try {
      const { GoogleGenAI } = await import("@google/genai");
      if (stale()) return;
      const ai = new GoogleGenAI({
        apiKey: tok.token.token,
        httpOptions: { apiVersion: tok.token.apiVersion ?? "v1beta" },
      });
      let rejectEarly: (reason: Error) => void = () => {};
      const early = new Promise<never>((_, reject) => {
        rejectEarly = reject;
      });
      const timer = setTimeout(() => rejectEarly(new Error("timeout")), CONNECT_TIMEOUT_MS);
      try {
        // The token locks model, instructions, tools and voice, so no config is sent here.
        session = await Promise.race([
          ai.live.connect({
            model: tok.token.model,
            callbacks: {
              onmessage: (msg) => onMessage(call, msg),
              onerror: () => {
                if (!call.session) rejectEarly(new Error("socket"));
                else finish(call, false, "Lost the connection to the voice service.");
              },
              onclose: (e) => {
                if (e.code !== 1000 && e.reason) console.warn("Voice call closed:", e.code, e.reason);
                if (!call.session) {
                  rejectEarly(new Error("closed"));
                  return;
                }
                finish(call, false);
              },
            },
          }),
          early,
        ]);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if (!stale()) {
        const msg = err instanceof Error && err.message === "timeout" ? "The voice service took too long to answer." : "Could not reach the voice service.";
        finish(call, false, msg);
      }
      return;
    }
    if (stale()) {
      try {
        session.close();
      } catch {}
      return;
    }
    call.session = session;
    dispatch({ type: "connected" });
    call.tick = setInterval(() => tick(call), TICK_MS);
  }, [dispatch, finish, onMessage, sendMic, tick]);

  const disconnect = useCallback(() => {
    genRef.current++;
    const call = callRef.current;
    if (call) finish(call, true);
    else dispatch({ type: "reset" });
  }, [dispatch, finish]);

  const sendText = useCallback(
    (text: string) => {
      const call = callRef.current;
      if (!call?.session || call.closed || !text.trim()) return;
      try {
        call.session.sendRealtimeInput({ text });
        dispatch({ type: "text-sent", text });
      } catch {
        finish(call, false, "Lost the connection to the voice service.");
      }
    },
    [dispatch, finish],
  );

  useEffect(() => {
    mountedRef.current = true;
    const generation = genRef;
    return () => {
      mountedRef.current = false;
      generation.current++;
      const call = callRef.current;
      if (call) {
        const wasLive = call.session !== null;
        teardown(call);
        stateRef.current = initialLiveState;
        if (wasLive) optsRef.current.onClose?.();
      }
    };
  }, [teardown]);

  return { status, error, connect, disconnect, inputLevel, outputLevel, sendText };
}
