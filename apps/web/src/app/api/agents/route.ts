import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { TOOL_BY_NAME } from "@agent-os/core";
import { grantsFor, policyFor, slugify } from "@/lib/agent-factory";
import { getDb } from "@/lib/db/client";
import { agents, auditLog, budgetPolicies, promptBlocks } from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { getWorkspaceUser, requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(2).max(64),
  summary: z.string().min(1).max(400),
  instructions: z.string().min(20).max(8_000),
  goal: z.string().min(8).max(4_000),
  complexity: z.enum(["trivial", "standard", "complex", "critical"]),
  dataClass: z.enum(["public", "internal", "confidential", "restricted"]).optional(),
  allowedTools: z.array(z.string().min(1)).min(1).max(24),
  useCase: z.string().max(4_000).optional(),
  source: z.enum(["live", "scripted"]).optional(),
  model: z.string().max(80).nullable().optional(),
  proposeTemplates: z.boolean().optional(),
  canSpawnSubagents: z.boolean().optional(),
  rank: z.enum(["orchestrator", "intermediate", "intermediate_2", "grunt"]).optional(),
});

/**
 * Persists a reviewed builder draft as an active root orchestrator.
 * The system prompt lands on `instructions`. The goal lands on `default_goal`
 * and is what dispatch prefills. Org prompt blocks are attached either way.
 */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "The draft is missing a name, system prompt, or goal." },
      { status: 400 },
    );
  }

  const workspace = await requireWorkspace();
  const db = getDb();
  const data = parsed.data;
  const allowedTools = [...new Set(data.allowedTools.filter((tool) => TOOL_BY_NAME.has(tool)))];
  if (allowedTools.length === 0) {
    return Response.json({ error: "Pick at least one known capability." }, { status: 400 });
  }

  const now = new Date();
  const id = newId("agt");
  const baseSlug = slugify(data.name.trim()) || "agent";
  const [slugTaken] = await db
    .select({ slug: agents.slug })
    .from(agents)
    .where(and(eq(agents.workspaceId, workspace.id), eq(agents.slug, baseSlug)))
    .limit(1);
  const slug = slugTaken ? `${baseSlug}-${id.slice(4, 8)}` : baseSlug;

  const orgBlocks = await db
    .select({ id: promptBlocks.id })
    .from(promptBlocks)
    .where(and(eq(promptBlocks.workspaceId, workspace.id), eq(promptBlocks.level, "org")));

  const complexity = data.complexity;
  const rank = data.rank ?? "orchestrator";
  const grunt = rank === "grunt";
  await db.insert(agents).values({
    id,
    workspaceId: workspace.id,
    name: data.name.trim(),
    slug,
    role: "orchestrator",
    rank,
    canSpawnSubagents: grunt ? false : (data.canSpawnSubagents ?? false),
    proposeTemplates: grunt ? false : (data.proposeTemplates ?? false),
    parentAgentId: null,
    summary: data.summary.trim(),
    instructions: data.instructions.trim(),
    defaultGoal: data.goal.trim(),
    inheritedPromptBlockIds: orgBlocks.map((block) => block.id),
    modelPolicy: policyFor(complexity, "orchestrator"),
    grants: grantsFor(allowedTools, "the use-case draft"),
    allowedTools,
    complexity,
    maxSteps: complexity === "critical" ? 16 : complexity === "complex" ? 12 : 10,
    dataClass: data.dataClass ?? workspace.defaultDataClass,
    status: "active",
    version: 1,
    templateId: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(budgetPolicies).values({
    id: newId("bp"),
    workspaceId: workspace.id,
    agentId: id,
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
    action: "agent.created_from_use_case",
    targetType: "agent",
    targetId: id,
    detail: {
      source: data.source ?? "scripted",
      model: data.model ?? null,
      dataClass: data.dataClass ?? workspace.defaultDataClass,
      complexity,
      tools: allowedTools,
      useCase: data.useCase?.slice(0, 500) ?? null,
      proposeTemplates: grunt ? false : (data.proposeTemplates ?? false),
      canSpawnSubagents: grunt ? false : (data.canSpawnSubagents ?? false),
      rank,
    },
    at: now,
  });

  return Response.json({ agentId: id, status: "active" }, { status: 201 });
}
