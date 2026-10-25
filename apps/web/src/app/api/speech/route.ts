import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File)) return Response.json({ error: "Audio recording is required." }, { status: 400 });
  const upstream = new FormData();
  upstream.append("request", new Blob([JSON.stringify({ model: "muse-voice-transcribe-1.0", mode: "PUSH_TO_TALK", audioEncoding: "WAV" })], { type: "application/json" }));
  upstream.append("audio", audio, "recording.wav");
  const response = await fetch("https://api.meta.ai/v1/asr/transcribe", { method: "POST", headers: { authorization: `Bearer ${env.openai.apiKey}` }, body: upstream });
  if (!response.ok) return Response.json({ error: (await response.text().catch(() => "")) || "Speech transcription failed." }, { status: response.status });
  const result = (await response.json()) as { transcript?: string };
  return Response.json({ transcript: result.transcript ?? "" });
}
