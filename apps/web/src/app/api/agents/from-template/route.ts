import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { buildGraph, validateGraph, type AgentConfig } from "@agent-os/core";
import { grantsFor, ORCHESTRATOR_TOOLS, policyFor, slugify } from "@/lib/agent-factory";
import { getDb } from "@/lib/db/client";
import {
  agents,
  auditLog,
  budgetPolicies,
  promptBlocks,
  templates,
} from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { getWorkspaceUser, requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Body = z.object({
  templateId: z.string().min(1),
  /** Optional rename for the root orchestrator. */
  name: z.string().min(2).max(64).optional(),
  dataClass: z.enum(["public", "internal", "confidential", "restricted"]).optional(),
});

const TEMPLATE_SOURCE = "the template capability list";

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { templateId, name?, dataClass? }." }, { status: 400 });
  }

  const workspace = await requireWorkspace();
  const db = getDb();

  const [template] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, parsed.data.templateId))
    .limit(1);
  if (!template) {
    return Response.json({ error: "Template not found." }, { status: 404 });
  }

  const dataClass = parsed.data.dataClass ?? workspace.defaultDataClass;
  const orchestratorName = parsed.data.name?.trim() || template.graph.orchestrator.name;
  const now = new Date();

  const orgBlocks = await db
    .select({ id: promptBlocks.id })
    .from(promptBlocks)
    .where(
      and(eq(promptBlocks.workspaceId, workspace.id), eq(promptBlocks.level, "org")),
    );

  const baseSlug = slugify(orchestratorName);

  const buildSlug = async (candidate: string) => {
    const existing = await db
      .select({ slug: agents.slug })
      .from(agents)
      .where(and(eq(agents.workspaceId, workspace.id), eq(agents.slug, candidate)))
      .limit(1);
    return existing.length === 0 ? candidate : `${candidate}-${newId("x").slice(2, 6)}`;
  };

  const orchestratorId = newId("agt");
  const orchestratorSlug = await buildSlug(baseSlug);

  const orchestrator: typeof agents.$inferInsert = {
    id: orchestratorId,
    workspaceId: workspace.id,
    name: orchestratorName,
    slug: orchestratorSlug,
    role: "orchestrator",
    rank: "orchestrator",
    canSpawnSubagents: true,
    proposeTemplates: false,
    parentAgentId: null,
    summary: template.outcome,
    instructions: template.graph.orchestrator.instructions,
    inheritedPromptBlockIds: orgBlocks.map((block) => block.id),
    modelPolicy: policyFor(template.graph.orchestrator.complexity, "orchestrator"),
    grants: grantsFor(ORCHESTRATOR_TOOLS, TEMPLATE_SOURCE),
    allowedTools: [...ORCHESTRATOR_TOOLS],
    complexity: template.graph.orchestrator.complexity,
    maxSteps: 12,
    dataClass,
    status: "draft",
    version: 1,
    templateId: template.id,
    createdAt: now,
    updatedAt: now,
  };

  const workerRows: Array<typeof agents.$inferInsert> = [];
  for (const worker of template.graph.workers) {
    const workerId = newId("agt");
    const slug = await buildSlug(slugify(worker.name));
    const tools = worker.tools.length > 0 ? worker.tools : ["kb.search", "fs.read"];
    workerRows.push({
      id: workerId,
      workspaceId: workspace.id,
      name: worker.name,
      slug,
      role: worker.role,
      rank: "intermediate",
      canSpawnSubagents: false,
      proposeTemplates: false,
      parentAgentId: orchestratorId,
      summary: worker.instructions,
      instructions: worker.instructions,
      inheritedPromptBlockIds: orgBlocks.map((block) => block.id),
      modelPolicy: policyFor(worker.complexity, worker.role),
      grants: grantsFor(tools, TEMPLATE_SOURCE),
      allowedTools: tools,
      complexity: worker.complexity,
      maxSteps: worker.role === "security" ? 16 : 10,
      dataClass,
      status: "draft",
      version: 1,
      templateId: template.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Validate the graph exactly as the builder would, before anything is written.
  const asConfig = (row: typeof agents.$inferInsert): AgentConfig => ({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug ?? slugify(row.name),
    role: row.role,
    parentAgentId: row.parentAgentId ?? null,
    summary: row.summary ?? "",
    instructions: row.instructions,
    inheritedPromptBlockIds: row.inheritedPromptBlockIds ?? [],
    modelPolicy: row.modelPolicy,
    grants: row.grants ?? [],
    allowedTools: row.allowedTools ?? [],
    complexity: row.complexity ?? "standard",
    maxSteps: row.maxSteps ?? 12,
    dataClass: row.dataClass ?? "internal",
    status: row.status ?? "draft",
    version: row.version ?? 1,
    templateId: row.templateId ?? null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  const graph = buildGraph([orchestrator, ...workerRows].map(asConfig));
  const issues = validateGraph(graph);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    return Response.json({ error: "Graph is invalid.", issues }, { status: 409 });
  }

  await db.insert(agents).values([orchestrator, ...workerRows]);

  await db.insert(budgetPolicies).values({
    id: newId("bp"),
    workspaceId: workspace.id,
    agentId: orchestratorId,
    period: "run",
    limitUsd: workspace.defaultRunBudgetUsd,
    warnAt: 0.8,
    hardStop: true,
    createdAt: now,
  });

  const { user } = await getWorkspaceUser();
  await db.insert(auditLog).values({
    id: newId("aud"),
    workspaceId: workspace.id,
    actor: user?.email ?? "operator@local",
    action: "agent.created_from_template",
    targetType: "agent",
    targetId: orchestratorId,
    detail: {
      templateId: template.id,
      templateKey: template.key,
      createdAgents: [orchestratorId, ...workerRows.map((row) => row.id)],
      status: "draft",
      dataClass,
      warnings: issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message),
    },
    at: now,
  });

  return Response.json(
    {
      orchestratorId,
      agentIds: [orchestratorId, ...workerRows.map((row) => row.id)],
      issues,
      status: "draft",
    },
    { status: 201 },
  );
}
