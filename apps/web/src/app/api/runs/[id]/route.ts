import { NextRequest } from "next/server";
import { z } from "zod";
import { getRun, requireWorkspace } from "@/lib/queries";
import { cancelRun } from "@/lib/runtime/orchestrator";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.literal("stop"),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await requireWorkspace();
  const run = await getRun(id);
  if (!run || run.workspaceId !== workspace.id) {
    return Response.json({ error: "That run does not exist." }, { status: 404 });
  }
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    await cancelRun(id);
    return Response.json({ ok: true, runId: id, status: "cancelled" });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 409 });
  }
}
