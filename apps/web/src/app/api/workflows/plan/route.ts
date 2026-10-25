import { NextRequest } from "next/server";
import { z } from "zod";
import { listAgents, requireWorkspace } from "@/lib/queries";
import { planLibraryWorkflow } from "@/lib/runtime/workflow-planner";

export const dynamic = "force-dynamic";
const Body = z.object({
  mode: z.enum(["automatic", "dynamic"]), prompt: z.string().trim().min(1).max(3000), current: z.string().max(16000).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Describe the workflow to arrange." }, { status: 400 });
  const workspace = await requireWorkspace();
  try {
    return Response.json(await planLibraryWorkflow({
      ...parsed.data, workspaceId: workspace.id, library: await listAgents(workspace.id),
    }));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
