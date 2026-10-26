import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { auditLog, securityFindings } from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { advanceTarget } from "@/lib/loop/blue-team";
import { closeDismissedCase } from "@/lib/loop/cases";
import { canTransition } from "@/lib/loop/lifecycle";
import { getWorkspaceUser, requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Triage only: a person may mark a finding not an issue. Accepting a finding
 * opens its feedback-loop case (POST /api/cases), and "fixed" is reachable
 * only through a passing retest, so neither is settable here.
 */
const Body = z.object({
  status: z.enum(["false_positive"]),
});
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
  const db = await getDb();
  const [finding] = await db
    .select()
    .from(securityFindings)
    .where(eq(securityFindings.id, id))
    .limit(1);

  if (!finding || finding.workspaceId !== workspace.id) {
    return Response.json({ error: "Finding not found." }, { status: 404 });
  }

  if (!canTransition(finding.status, parsed.data.status)) {
    return Response.json(
      { error: `A ${finding.status.replaceAll("_", " ")} finding cannot be marked not an issue.` },
      { status: 409 },
    );
  }

  const { user } = await getWorkspaceUser();
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

  // Its case, if any, closes, and the next case for the same agent moves on.
  const closed = await closeDismissedCase(id, actor);
  if (closed) await advanceTarget(closed.workspaceId, closed.targetAgentId);

  return Response.json({ finding: updated });
}
