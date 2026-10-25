import { NextRequest } from "next/server";
import { geminiEnabled } from "@/lib/env";
import { describeWorkflowVideo, MAX_VIDEO_BYTES, type GeminiUsage } from "@/lib/gemini";
import { recordModelTurn } from "@/lib/observability";
import { requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";
// Upload, processing, and description can take a minute or two.
export const maxDuration = 300;

/** Multipart overhead allowed on top of the video itself. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/** A screen recording in (form field "video"), a description of the job out: { description }. */
export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_VIDEO_BYTES + FORM_OVERHEAD_BYTES) {
    return Response.json({ error: "That video is over 200 MB. Trim it and try again." }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const video = form?.get("video");
  if (!(video instanceof File)) {
    return Response.json({ error: "Choose a video to upload." }, { status: 400 });
  }
  if (!video.type.startsWith("video/")) {
    return Response.json({ error: "That file is not a video." }, { status: 400 });
  }
  if (video.size === 0) {
    return Response.json({ error: "That video is empty." }, { status: 400 });
  }
  if (video.size > MAX_VIDEO_BYTES) {
    return Response.json({ error: "That video is over 200 MB. Trim it and try again." }, { status: 413 });
  }

  try {
    const workspace = await requireWorkspace();
    if (!geminiEnabled()) {
      return Response.json({ error: "Video is not set up yet." }, { status: 503 });
    }
    let usage: GeminiUsage | undefined;
    const description = await describeWorkflowVideo(
      { data: await video.arrayBuffer(), mimeType: video.type, displayName: video.name },
      { onUsage: (value) => (usage = value) },
    );
    if (usage) {
      await recordModelTurn({
        workspaceId: workspace.id,
        source: "builder",
        agentName: "Workflow video",
        model: usage.model,
        messages: [{ role: "user", content: `Workflow video: ${video.name}` }],
        completion: description,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: usage.costUsd,
      }).catch(() => undefined);
    }
    return Response.json({ description });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
