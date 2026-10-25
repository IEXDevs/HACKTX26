"use client";

import { useRef, useState } from "react";
import { LoaderCircle, Mic, Square } from "@/components/icons";

function encodeWav(buffer: AudioBuffer) {
  const rate = 24000;
  const source = buffer.getChannelData(0);
  const samples = new Float32Array(Math.ceil((source.length * rate) / buffer.sampleRate));
  for (let i = 0; i < samples.length; i++) {
    const position = (i * buffer.sampleRate) / rate;
    const left = Math.floor(position);
    const right = Math.min(left + 1, source.length - 1);
    const ratio = position - left;
    samples[i] = (source[left] ?? 0) * (1 - ratio) + (source[right] ?? 0) * ratio;
  }
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return new Blob([bytes], { type: "audio/wav" });
}

export function VoiceInput({ onTranscript, onStart, disabled = false }: { onTranscript: (text: string) => void; onStart?: () => void; disabled?: boolean }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const chunks = useRef<Blob[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);

  async function toggle() {
    if (recording) { recorder.current?.stop(); setRecording(false); setBusy(true); return; }
    onStart?.();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks.current = [];
    const current = new MediaRecorder(stream);
    recorder.current = current;
    current.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
    current.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      try {
        const audio = await new AudioContext().decodeAudioData(await new Blob(chunks.current).arrayBuffer());
        const form = new FormData(); form.append("audio", encodeWav(audio), "recording.wav");
        const response = await fetch("/api/speech", { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Speech transcription failed.");
        if (result.transcript) onTranscript(result.transcript);
      } finally { setBusy(false); }
    };
    current.start(); setRecording(true);
  }

  return <button type="button" className={"voice-input" + (recording ? " recording" : "")} onClick={() => void toggle()} disabled={disabled || busy} aria-label={recording ? "Stop recording" : "Dictate with Muse"} title={recording ? "Stop recording" : "Dictate with Muse"}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : recording ? <Square size={15} /> : <Mic size={17} />}</button>;
}
