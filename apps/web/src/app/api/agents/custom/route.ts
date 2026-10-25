import { NextRequest } from "next/server";
import { z } from "zod";
import { createAgentGraph } from "@/lib/agent-factory";
import { getWorkspaceUser } from "@/lib/queries";
import { DraftSchema } from "@/lib/runtime/builder";

export const dynamic = "force-dynamic";

const Body = z.object({
  draft: DraftSchema,
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
  const { draft } = parsed.data;
  const result = await createAgentGraph({
    workspace,
    dataClass: parsed.data.dataClass,
    canSpawnSubagents: parsed.data.canSpawnSubagents,
    proposeTemplates: parsed.data.proposeTemplates,
    actor: user?.email ?? "operator@local",
    auditAction: "agent.created",
    auditDetail: {
      source: "builder",
      canSpawnSubagents: parsed.data.canSpawnSubagents ?? true,
      proposeTemplates: parsed.data.proposeTemplates ?? false,
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
    },
  });
  if (!result.ok) return Response.json(result, { status: 409 });
  return Response.json(result, { status: 201 });
}
