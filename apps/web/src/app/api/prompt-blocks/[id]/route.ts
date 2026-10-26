import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { promptBlocks } from "@/lib/db/schema";
import { getWorkspaceUser, requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Body = z.object({ content: z.string().min(1).max(12_000) });

/**
 * Locked blocks are enforced here, not in the UI: an org block is a policy
 * control, so the write path refuses it regardless of who is asking.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { content }." }, { status: 400 });
  }

  const workspace = await requireWorkspace();
  const db = await getDb();
  const [block] = await db.select().from(promptBlocks).where(eq(promptBlocks.id, id)).limit(1);
  if (!block || block.workspaceId !== workspace.id) {
    return Response.json({ error: "Prompt block not found." }, { status: 404 });
  }
  if (block.locked) {
    return Response.json(
      { error: `"${block.name}" is an organisation-level block and cannot be edited here.` },
      { status: 409 },
    );
  }

  const [updated] = await db
    .update(promptBlocks)
    .set({ content: parsed.data.content, version: block.version + 1 })
    .where(eq(promptBlocks.id, id))
    .returning();

  const { user } = await getWorkspaceUser();
  await writeAudit({
    workspaceId: workspace.id,
    actor: user?.email ?? "operator@local",
    action: "prompt_block.updated",
    targetType: "prompt_block",
    targetId: id,
    detail: {
      name: block.name,
      level: block.level,
      fromVersion: block.version,
      toVersion: block.version + 1,
      chars: parsed.data.content.length,
    },
  });

  return Response.json({ block: updated });
}
