/**
 * Creates an orchestrator and its workers from a plain graph description.
 * Same rules as the template route: low/medium-risk tools become standing
 * grants, high-risk tools stay gated per run, the graph is validated before
 * any row is written, and the creation is audited. New agents start as drafts.
 */
import { and, eq } from "drizzle-orm";
import {
  buildGraph,
  TOOL_BY_NAME,
  validateGraph,
  type AgentConfig,
  type AgentRole,
  type DataClass,
  type ModelPolicy,
  type PermissionGrant,
  type TaskComplexity,
} from "@agent-os/core";
import { getDb } from "./db/client";
import { agents, auditLog, budgetPolicies, promptBlocks, type Workspace } from "./db/schema";
import { newId } from "./env";

export interface GraphSpec {
  orchestrator: {
    name: string;
    summary: string;
    instructions: string;
    complexity: TaskComplexity;
    /** First task to dispatch. Stored as default_goal; New run prefills from it. */
    goal?: string;
  };
  workers: Array<{
    name: string;
    role: Extract<AgentRole, "worker" | "security">;
    instructions: string;
    complexity: TaskComplexity;
    tools: string[];
  }>;
}

export const ORCHESTRATOR_TOOLS = [
  "kb.search",
  "fs.read",
  "fs.write",
  "memory.search",
  "memory.write",
  "context.read",
  "context.write",
  "connector.call",
  "web.search",
];

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

/**
 * Only low and medium risk capabilities become standing grants. A high-risk
 * tool can still be listed on the agent: it is gated per run instead.
 * `source` names where the tool list came from, for the grant's note.
 */
export function grantsFor(
  tools: readonly string[],
  source = "the builder's capability list",
): PermissionGrant[] {
  const grants: PermissionGrant[] = [];
  for (const tool of tools) {
    const entry = TOOL_BY_NAME.get(tool);
    if (!entry) continue;
    if (entry.risk === "low" || entry.risk === "medium") {
      grants.push({
        resource: entry.name,
        scopes: entry.scopes,
        grantedBy: "builder",
        note: `Derived from ${source} (${entry.risk} risk).`,
      });
    }
  }
  return grants;
}

export function policyFor(complexity: TaskComplexity, role: AgentRole): ModelPolicy {
  const severity = complexity === "critical" ? 0.15 : complexity === "complex" ? 0.4 : 0.7;
  return {
    mode: "auto",
    pinnedModelId: null,
    costSensitivity: role === "security" ? 0.15 : severity,
    latencySensitivity: complexity === "trivial" ? 0.7 : 0.2,
    floorComplexity: complexity,
    deniedModelIds: [],
  };
}

export type CreateResult =
  | { ok: true; orchestratorId: string; agentIds: string[]; warnings: string[] }
  | { ok: false; error: string; issues?: unknown };

export async function createAgentGraph(options: {
  workspace: Workspace;
  spec: GraphSpec;
  dataClass?: DataClass;
  /** Lead may create a child one rank down. Workers created with the team stay fixed. */
  canSpawnSubagents?: boolean;
  /** Lead may file reusable children for the operator to approve. */
  proposeTemplates?: boolean;
  actor: string;
  auditAction: string;
  auditDetail?: Record<string, unknown>;
}): Promise<CreateResult> {
  const { workspace, spec } = options;
  const db = getDb();
  const dataClass = options.dataClass ?? workspace.defaultDataClass;
  const now = new Date();

  const orgBlocks = await db
    .select({ id: promptBlocks.id })
    .from(promptBlocks)
    .where(and(eq(promptBlocks.workspaceId, workspace.id), eq(promptBlocks.level, "org")));
  const inherited = orgBlocks.map((block) => block.id);

  const taken = new Set<string>();
  const buildSlug = async (candidate: string) => {
    const base = candidate || "agent";
    const existing = await db
      .select({ slug: agents.slug })
      .from(agents)
      .where(and(eq(agents.workspaceId, workspace.id), eq(agents.slug, base)))
      .limit(1);
    const slug = existing.length === 0 && !taken.has(base) ? base : `${base}-${newId("x").slice(2, 6)}`;
    taken.add(slug);
    return slug;
  };

  const orchestratorId = newId("agt");
  const orchestrator: typeof agents.$inferInsert = {
    id: orchestratorId,
    workspaceId: workspace.id,
    name: spec.orchestrator.name,
    slug: await buildSlug(slugify(spec.orchestrator.name)),
    role: "orchestrator",
    parentAgentId: null,
    summary: spec.orchestrator.summary,
    instructions: spec.orchestrator.instructions,
    defaultGoal: spec.orchestrator.goal?.trim() ?? "",
    rank: "orchestrator",
    canSpawnSubagents: options.canSpawnSubagents ?? true,
    proposeTemplates: options.proposeTemplates ?? false,
    inheritedPromptBlockIds: inherited,
    modelPolicy: policyFor(spec.orchestrator.complexity, "orchestrator"),
    grants: grantsFor(ORCHESTRATOR_TOOLS),
    allowedTools: ORCHESTRATOR_TOOLS,
    complexity: spec.orchestrator.complexity,
    maxSteps: 12,
    dataClass,
    status: "draft",
    version: 1,
    templateId: null,
    createdAt: now,
    updatedAt: now,
  };

  const workerRows: Array<typeof agents.$inferInsert> = [];
  for (const worker of spec.workers) {
    const known = worker.tools.filter((tool) => TOOL_BY_NAME.has(tool));
    const tools = known.length > 0 ? known : ["kb.search", "fs.read"];
    workerRows.push({
      id: newId("agt"),
      workspaceId: workspace.id,
      name: worker.name,
      slug: await buildSlug(slugify(worker.name)),
      role: worker.role,
      rank: "intermediate",
      canSpawnSubagents: false,
      proposeTemplates: false,
      parentAgentId: orchestratorId,
      summary: worker.instructions,
      instructions: worker.instructions,
      inheritedPromptBlockIds: inherited,
      modelPolicy: policyFor(worker.complexity, worker.role),
      grants: grantsFor(tools),
      allowedTools: tools,
      complexity: worker.complexity,
      maxSteps: worker.role === "security" ? 16 : 10,
      dataClass,
      status: "draft",
      version: 1,
      templateId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

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

  const issues = validateGraph(buildGraph([orchestrator, ...workerRows].map(asConfig)));
  if (issues.some((issue) => issue.severity === "error")) {
    return { ok: false, error: "The agent team is not valid.", issues };
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
  const agentIds = [orchestratorId, ...workerRows.map((row) => row.id as string)];
  const warnings = issues
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.message);
  await db.insert(auditLog).values({
    id: newId("aud"),
    workspaceId: workspace.id,
    actor: options.actor,
    action: options.auditAction,
    targetType: "agent",
    targetId: orchestratorId,
    detail: { ...options.auditDetail, createdAgents: agentIds, status: "draft", dataClass, warnings },
    at: now,
  });
  return { ok: true, orchestratorId, agentIds, warnings };
}
