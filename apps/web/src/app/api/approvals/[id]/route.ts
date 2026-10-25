import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { approvals, auditLog } from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { getWorkspaceUser, requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

const DecisionBody = z.object({
  decision: z.enum(["approved", "denied"]),
  note: z.string().max(600).optional(),
});

/**
 * The human decision is written here and polled by the waiting engine, so it
 * survives a page reload or a server restart. Every decision is audited.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = DecisionBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Expected { decision: 'approved' | 'denied', note?: string }." },
      { status: 400 },
    );
  }

  const workspace = await requireWorkspace();
  const db = getDb();
  const [approval] = await db
    .select()
    .from(approvals)
    .where(eq(approvals.id, id))
    .limit(1);

  if (!approval || approval.workspaceId !== workspace.id) {
    return Response.json({ error: "Approval not found." }, { status: 404 });
  }
  if (approval.status !== "pending") {
    return Response.json(
      { error: `Approval was already ${approval.status}.` },
      { status: 409 },
    );
  }

  const { user } = await getWorkspaceUser();
  const decidedBy = user?.email ?? "operator@local";
  const resolvedAt = new Date();

  const [updated] = await db
    .update(approvals)
    .set({
      status: parsed.data.decision,
      decidedBy,
      note: parsed.data.note ?? null,
      resolvedAt,
    })
    .where(eq(approvals.id, id))
    .returning();

  await db.insert(auditLog).values({
    id: newId("aud"),
    workspaceId: workspace.id,
    actor: decidedBy,
    action: `approval.${parsed.data.decision}`,
    targetType: "approval",
    targetId: id,
    detail: {
      runId: approval.runId,
      agentId: approval.agentId,
      resource: approval.resource,
      risk: approval.risk,
      note: parsed.data.note ?? null,
    },
    at: resolvedAt,
  });

  return Response.json({ approval: updated });
}
