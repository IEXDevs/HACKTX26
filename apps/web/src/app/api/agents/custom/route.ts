import { NextRequest } from "next/server";
import { z } from "zod";
import { createAgentGraph } from "@/lib/agent-factory";
import { getWorkspaceUser } from "@/lib/queries";
import { DraftSchema } from "@/lib/runtime/builder-parse";
import { workflowCreation, WorkflowModeSchema } from "@/lib/workflow-mode";
import { BuilderConversationSchema } from "@/lib/builder-conversation";

export const dynamic = "force-dynamic";

const Body = z.object({
  workflowMode: WorkflowModeSchema.optional(),
  draft: DraftSchema,
  conversation: BuilderConversationSchema.optional(),
  dataClass: z.enum(["public", "internal", "confidential", "restricted"]).optional(),
  canSpawnSubagents: z.boolean().optional(),
  proposeTemplates: z.boolean().optional(),
});

/** Creates a custom agent team from a builder draft. Agents start as drafts. */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { draft }.", issues: parsed.error.issues }, { status: 400 });
  }
  const { workspace, user } = await getWorkspaceUser();
  const settings = parsed.data.workflowMode
    ? workflowCreation(parsed.data.workflowMode, parsed.data.draft)
    : parsed.data;
  const { draft, canSpawnSubagents, proposeTemplates } = settings;
  const result = await createAgentGraph({
    workspace,
    dataClass: parsed.data.dataClass,
    canSpawnSubagents,
    proposeTemplates,
    builderConversation: parsed.data.conversation,
    contextUpdatedBy: user?.id ?? null,
    actor: user?.email ?? "operator@local",
    auditAction: "agent.created",
    auditDetail: {
      source: parsed.data.workflowMode === "manual" ? "manual" : "builder",
      workflowMode: parsed.data.workflowMode,
      canSpawnSubagents: canSpawnSubagents ?? true,
      proposeTemplates: proposeTemplates ?? false,
      apps: draft.apps ?? [],
    },
    spec: {
      orchestrator: {
        name: draft.name,
        summary: draft.summary,
        instructions: draft.instructions,
        complexity: draft.complexity,
        goal: draft.goal,
      },
      workers: draft.workers,
      apps: draft.apps,
    },
  });
  if (!result.ok) return Response.json(result, { status: 409 });
  return Response.json(result, { status: 201 });
}
