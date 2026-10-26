import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { createAgentGraph } from "@/lib/agent-factory";
import { getDb } from "@/lib/db/client";
import { templates } from "@/lib/db/schema";
import { getWorkspaceUser, requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Body = z.object({
  templateId: z.string().min(1),
  name: z.string().min(2).max(64).optional(),
  dataClass: z.enum(["public", "internal", "confidential", "restricted"]).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { templateId, name?, dataClass? }." }, { status: 400 });
  }
  const workspace = await requireWorkspace();
  const [template] = await getDb().select().from(templates).where(eq(templates.id, parsed.data.templateId)).limit(1);
  if (!template) return Response.json({ error: "Template not found." }, { status: 404 });
  const { user } = await getWorkspaceUser();
  const result = await createAgentGraph({
    workspace,
    spec: {
      orchestrator: { ...template.graph.orchestrator, name: parsed.data.name?.trim() || template.graph.orchestrator.name, summary: template.outcome },
      workers: template.graph.workers,
      apps: template.requiredConnectors,
    },
    template: { id: template.id, key: template.key },
    dataClass: parsed.data.dataClass,
    actor: user?.email ?? "operator@local",
    auditAction: "agent.created_from_template",
  });
  if (!result.ok) return Response.json({ error: result.error, issues: result.issues }, { status: 409 });
  return Response.json({ orchestratorId: result.orchestratorId, agentIds: result.agentIds, issues: result.issues, status: "draft" }, { status: 201 });
}
