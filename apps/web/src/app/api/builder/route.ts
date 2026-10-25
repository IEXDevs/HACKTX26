import { NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { connectedToolkitsFor, operatorIdFor } from "@/lib/connectors";
import { getCurrentUser, requireWorkspace } from "@/lib/queries";
import { askBuilder, describeApps } from "@/lib/runtime/builder";
import { WorkflowModeSchema } from "@/lib/workflow-mode";

export const dynamic = "force-dynamic";

const Body = z.object({
  // A graph being edited may be incomplete. Validate the finished model draft instead.
  draft: z.string().max(60_000).optional(),
  workflowMode: WorkflowModeSchema.exclude(["manual"]).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(6000),
      }),
    )
    .min(1)
    .max(40),
});

/**
 * One builder turn: the conversation so far in; Muse's reply, optional draft,
 * the searches it ran, and the draft's apps with link status out.
 */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { messages: [{ role, content }] }." }, { status: 400 });
  }
  try {
    const workspace = await requireWorkspace();
    const result = await askBuilder(parsed.data.messages, {
      workspaceId: workspace.id,
      workflowMode: parsed.data.workflowMode,
      draft: parsed.data.draft,
    });
    const slugs = result.draft?.apps ?? [];
    if (slugs.length === 0) return Response.json({ ...result, apps: [] });
    const [session, user] = await Promise.all([getSessionUser(), getCurrentUser(workspace.id)]);
    // Link status is a hint; a failed lookup shows the apps as not linked.
    const connected = await connectedToolkitsFor(workspace.id, operatorIdFor(session?.id, user?.id)).catch(() => []);
    return Response.json({ ...result, apps: describeApps(slugs, connected) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
