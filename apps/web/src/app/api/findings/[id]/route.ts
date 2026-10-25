import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { auditLog, securityFindings } from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { getWorkspaceContext, requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Body = z.object({
  status: z.enum(["open", "accepted", "fixed", "false_positive"]),
});

/**
 * Triage is a state machine on the finding itself. It is deliberately separate
 * from the run that produced it: the trace is immutable, the disposition is not.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { status }." }, { status: 400 });
  }

  const workspace = await requireWorkspace();
  const db = getDb();
  const [finding] = await db
    .select()
    .from(securityFindings)
    .where(eq(securityFindings.id, id))
    .limit(1);

  if (!finding || finding.workspaceId !== workspace.id) {
    return Response.json({ error: "Finding not found." }, { status: 404 });
  }

  const { user } = await getWorkspaceContext();
  const actor = user?.email ?? "operator@local";

  const [updated] = await db
    .update(securityFindings)
    .set({ status: parsed.data.status })
    .where(eq(securityFindings.id, id))
    .returning();

  await db.insert(auditLog).values({
    id: newId("aud"),
    workspaceId: workspace.id,
    actor,
    action: "finding.triaged",
    targetType: "security_finding",
    targetId: id,
    detail: {
      from: finding.status,
      to: parsed.data.status,
      severity: finding.severity,
      category: finding.category,
      runId: finding.runId,
    },
    at: new Date(),
  });

  return Response.json({ finding: updated });
}
