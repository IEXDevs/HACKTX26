import { NextRequest } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { promptBlocks } from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { getWorkspaceUser, requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(2).max(64),
  content: z.string().min(1).max(12_000),
  level: z.enum(["team", "agent"]).default("team"),
});

/** New blocks are never org-level: that tier belongs to the workspace owner. */
export async function POST(request: NextRequest) {
  const parsed = CreateBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Expected { name, content, level?: 'team' | 'agent' }." },
      { status: 400 },
    );
  }

  const workspace = await requireWorkspace();
  const db = await getDb();
  const id = newId("pb");

  await db.insert(promptBlocks).values({
    id,
    workspaceId: workspace.id,
    name: parsed.data.name,
    level: parsed.data.level,
    content: parsed.data.content,
    version: 1,
    locked: false,
    createdAt: new Date(),
  });

  const { user } = await getWorkspaceUser();
  await writeAudit({
    workspaceId: workspace.id,
    actor: user?.email ?? "operator@local",
    action: "prompt_block.created",
    targetType: "prompt_block",
    targetId: id,
    detail: { name: parsed.data.name, level: parsed.data.level },
  });

  return Response.json({ id }, { status: 201 });
}
