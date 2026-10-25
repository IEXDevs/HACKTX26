import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { agents, auditLog, templateProposals, templates } from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { getWorkspaceContext, requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["save", "dismiss"]),
});

/**
 * An operator approves a child template the parent proposed, or dismisses it.
 * Save copies the proposal into the template gallery. The proposal row stays
 * so the same child is not filed again.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { action: 'save' | 'dismiss' }." }, { status: 400 });
  }

  const workspace = await requireWorkspace();
  const db = getDb();
  const [proposal] = await db
    .select()
    .from(templateProposals)
    .where(eq(templateProposals.id, id))
    .limit(1);

  if (!proposal || proposal.workspaceId !== workspace.id) {
    return Response.json({ error: "Proposal not found." }, { status: 404 });
  }
  if (proposal.status !== "pending") {
    return Response.json({ error: `Proposal is already ${proposal.status}.` }, { status: 409 });
  }

  const { user } = await getWorkspaceContext();
  const now = new Date();

  if (parsed.data.action === "dismiss") {
    await db
      .update(templateProposals)
      .set({ status: "dismissed" })
      .where(eq(templateProposals.id, id));
    await db.insert(auditLog).values({
      id: newId("aud"),
      workspaceId: workspace.id,
      actor: user?.email ?? "operator@local",
      action: "template_proposal.dismissed",
      targetType: "template_proposal",
      targetId: id,
      detail: { name: proposal.name, parentAgentId: proposal.parentAgentId },
      at: now,
    });
    return Response.json({ status: "dismissed" });
  }

  const [parent] = await db
    .select({ name: agents.name })
    .from(agents)
    .where(eq(agents.id, proposal.parentAgentId))
    .limit(1);

  const templateId = newId("tpl");
  const key = `child-${proposal.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32) || "grunt"}-${templateId.slice(4, 10)}`;

  await db.insert(templates).values({
    id: templateId,
    key,
    name: proposal.name,
    category: "Proposed child",
    description: `${proposal.reason} Tools: ${proposal.tools.join(", ") || "none"}.`,
    outcome: proposal.summary,
    graph: {
      orchestrator: {
        name: proposal.name,
        instructions: proposal.instructions,
        complexity: proposal.complexity,
      },
      workers: [],
    },
    requiredConnectors: [],
    tags: ["proposed", parent?.name ?? "child"],
    estimatedMinutes: 5,
    builtin: false,
    createdAt: now,
  });

  await db
    .update(templateProposals)
    .set({ status: "saved", templateId })
    .where(eq(templateProposals.id, id));

  await db.insert(auditLog).values({
    id: newId("aud"),
    workspaceId: workspace.id,
    actor: user?.email ?? "operator@local",
    action: "template_proposal.saved",
    targetType: "template",
    targetId: templateId,
    detail: { proposalId: id, name: proposal.name, parentAgentId: proposal.parentAgentId },
    at: now,
  });

  return Response.json({ status: "saved", templateId });
}
