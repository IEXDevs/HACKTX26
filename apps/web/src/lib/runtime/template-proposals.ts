/**
 * A parent with `proposeTemplates` can file a child it expects to reuse.
 * The row stays pending until an operator saves it into the template gallery
 * or dismisses it. A later run does not file the same child twice.
 */
import { and, eq } from "drizzle-orm";
import type { AgentRole, TaskComplexity } from "@agent-os/core";
import { getDb } from "@/lib/db/client";
import { templateProposals, type AgentRow } from "@/lib/db/schema";
import { newId } from "@/lib/env";

export async function fileChildTemplateProposal(input: {
  parent: AgentRow;
  runId: string;
  name: string;
  summary: string;
  instructions: string;
  tools: string[];
  role: AgentRole;
  complexity: TaskComplexity;
  reason: string;
}): Promise<boolean> {
  if (!input.parent.proposeTemplates || input.parent.rank === "grunt") return false;

  const db = getDb();
  const prior = await db
    .select({ id: templateProposals.id, status: templateProposals.status })
    .from(templateProposals)
    .where(
      and(
        eq(templateProposals.parentAgentId, input.parent.id),
        eq(templateProposals.name, input.name),
      ),
    );

  if (prior.some((row) => row.status === "pending" || row.status === "saved")) return false;

  await db.insert(templateProposals).values({
    id: newId("tplp"),
    workspaceId: input.parent.workspaceId,
    parentAgentId: input.parent.id,
    runId: input.runId,
    name: input.name,
    summary: input.summary,
    instructions: input.instructions,
    tools: input.tools,
    role: input.role,
    complexity: input.complexity,
    reason: input.reason,
    status: "pending",
    templateId: null,
    createdAt: new Date(),
  });
  return true;
}
