import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { agents, securityFindings } from "@/lib/db/schema";
import {
  addCreatorMessage,
  addPersonMessage,
  applyFix,
  approveFix,
  checkRetest,
  loadCase,
  person,
  proposeFix,
  startRetest,
} from "@/lib/loop/cases";
import { getWorkspaceContext } from "@/lib/queries";
import { askCaseReview } from "@/lib/runtime/case-review";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("message"), text: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("propose") }),
  z.object({ action: z.literal("approve"), proposalHash: z.string().min(8) }),
  z.object({ action: z.literal("retest") }),
  z.object({ action: z.literal("check") }),
]);

async function owned(id: string, workspaceId: string) {
  const row = await loadCase(id).catch(() => null);
  return row && row.workspaceId === workspaceId ? row : null;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { workspace } = await getWorkspaceContext();
  const row = await owned(id, workspace.id);
  if (!row) return Response.json({ error: "Case not found." }, { status: 404 });
  return Response.json({ case: await checkRetest(row.id) });
}

/**
 * The case conversation. Messages go to the agent creator, which may propose
 * a change. "approve" is the person's approval of one proposal by hash; the
 * platform then applies it as a new version and starts the retest.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Unknown case action." }, { status: 400 });
  const { workspace, user } = await getWorkspaceContext();
  const actor = user?.email ?? "operator@local";
  const row = await owned(id, workspace.id);
  if (!row) return Response.json({ error: "Case not found." }, { status: 404 });

  try {
    const body = parsed.data;
    if (body.action === "message" || body.action === "propose") {
      const current = body.action === "message" ? await addPersonMessage(row.id, actor, body.text) : row;
      const db = getDb();
      const [target] = await db.select().from(agents).where(eq(agents.id, current.targetAgentId)).limit(1);
      const [finding] = await db.select().from(securityFindings).where(eq(securityFindings.id, current.findingId)).limit(1);
      if (!target || !finding) throw new Error("The case's agent or finding is gone.");
      const review = await askCaseReview(target, current, finding);
      if (review.change) {
        return Response.json({
          case: await proposeFix(current.id, { change: review.change, source: review.source, reply: review.reply }),
        });
      }
      return Response.json({ case: await addCreatorMessage(current.id, review.reply) });
    }
    if (body.action === "approve") {
      await approveFix(row.id, body.proposalHash, person(actor));
      await applyFix(row.id);
      return Response.json({ case: await startRetest(row.id) });
    }
    if (body.action === "retest") return Response.json({ case: await startRetest(row.id) });
    return Response.json({ case: await checkRetest(row.id) });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 409 });
  }
}
