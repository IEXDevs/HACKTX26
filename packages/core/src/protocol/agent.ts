/**
 * Agent topology + configuration shapes.
 *
 * A workspace owns a directed graph of agents. Exactly one root orchestrator
 * per graph; workers hang off it; security agents can attach to any node to
 * audit it. Edges are derived from `parentAgentId`, so the graph can never drift
 * out of sync with the config.
 */
import { z } from "zod";
import { AgentRoleSchema, DataClassSchema } from "./events";

/** Creation-time place in the delegation tree. Grunts are the floor. */
export const AgentRankSchema = z.enum([
  "orchestrator",
  "intermediate",
  "intermediate_2",
  "grunt",
]);
export type AgentRank = z.infer<typeof AgentRankSchema>;

export const AGENT_RANK_LABEL: Record<AgentRank, string> = {
  orchestrator: "Orchestrator",
  intermediate: "Intermediate",
  intermediate_2: "Intermediate II",
  grunt: "Grunt",
};

/** The rank a parent may create. Grunts have no rank beneath them. */
export function nextAgentRank(rank: AgentRank): AgentRank | null {
  switch (rank) {
    case "orchestrator":
      return "intermediate";
    case "intermediate":
      return "intermediate_2";
    case "intermediate_2":
      return "grunt";
    case "grunt":
      return null;
  }
}
import { PermissionGrantSchema } from "./permissions";
import { TaskComplexitySchema } from "./models";

export const ModelPolicySchema = z.object({
  /** `auto` lets the router choose per task; `pinned` forces one model. */
  mode: z.enum(["auto", "pinned"]).default("auto"),
  pinnedModelId: z.string().nullable().default(null),
  /** 0 = quality at any cost, 1 = cheapest model that clears the floor. */
  costSensitivity: z.number().min(0).max(1).default(0.45),
  latencySensitivity: z.number().min(0).max(1).default(0.2),
  /** Never route this agent below this complexity treatment. */
  floorComplexity: TaskComplexitySchema.default("standard"),
  deniedModelIds: z.array(z.string()).default([]),
});
export type ModelPolicy = z.infer<typeof ModelPolicySchema>;

export const BudgetPolicySchema = z.object({
  period: z.enum(["run", "day", "month"]),
  limitUsd: z.number().nonnegative(),
  warnAt: z.number().min(0).max(1).default(0.8),
  hardStop: z.boolean().default(true),
  /** Per-agent share of the workspace budget. */
  sharePct: z.number().min(0).max(100).optional(),
});
export type BudgetPolicy = z.infer<typeof BudgetPolicySchema>;

export const AgentConfigSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  slug: z.string(),
  role: AgentRoleSchema,
  parentAgentId: z.string().nullable().default(null),
  summary: z.string().default(""),
  /** System prompt authored by the builder. */
  instructions: z.string(),
  /** Org-level prompt blocks this agent inherits, by id. */
  inheritedPromptBlockIds: z.array(z.string()).default([]),
  modelPolicy: ModelPolicySchema,
  grants: z.array(PermissionGrantSchema).default([]),
  /** Capability names this agent may use at all. */
  allowedTools: z.array(z.string()).default([]),
  complexity: TaskComplexitySchema.default("standard"),
  maxSteps: z.number().int().positive().default(12),
  dataClass: DataClassSchema.default("internal"),
  status: z
    .enum(["draft", "active", "paused", "archived"])
    .default("draft"),
  version: z.number().int().positive().default(1),
  templateId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export interface GraphEdge {
  from: string;
  to: string;
  kind: "delegates" | "audits";
}

export interface AgentGraph {
  nodes: AgentConfig[];
  edges: GraphEdge[];
  rootId: string | null;
}

export function buildGraph(nodes: readonly AgentConfig[]): AgentGraph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    if (node.parentAgentId && byId.has(node.parentAgentId)) {
      edges.push({
        from: node.parentAgentId,
        to: node.id,
        kind: node.role === "security" ? "audits" : "delegates",
      });
    }
  }
  const roots = nodes.filter((n) => n.parentAgentId === null && n.role === "orchestrator");
  return { nodes: [...nodes], edges, rootId: roots[0]?.id ?? null };
}

export interface GraphValidationIssue {
  severity: "error" | "warning";
  agentId: string | null;
  message: string;
}

/**
 * Structural checks the builder runs before an agent can be promoted to
 * `active`. Cheap, deterministic, and surfaced in the UI rather than thrown.
 */
export function validateGraph(graph: AgentGraph): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const roots = graph.nodes.filter(
    (n) => n.parentAgentId === null && n.role === "orchestrator",
  );

  if (roots.length === 0) {
    issues.push({
      severity: "error",
      agentId: null,
      message: "Graph has no root orchestrator.",
    });
  }
  if (roots.length > 1) {
    issues.push({
      severity: "warning",
      agentId: null,
      message: `${roots.length} root orchestrators found; only the first will receive triggers.`,
    });
  }

  for (const node of graph.nodes) {
    if (node.parentAgentId && !graph.nodes.some((n) => n.id === node.parentAgentId)) {
      issues.push({
        severity: "error",
        agentId: node.id,
        message: `Parent agent ${node.parentAgentId} does not exist.`,
      });
    }
    if (node.role === "worker" && !node.parentAgentId) {
      issues.push({
        severity: "error",
        agentId: node.id,
        message: "Worker agents must have a parent orchestrator.",
      });
    }
    if (node.role === "security" && !node.parentAgentId) {
      issues.push({
        severity: "warning",
        agentId: node.id,
        message: "Security agent is not attached to a target; it can only scan the workspace.",
      });
    }
    if (node.allowedTools.length === 0) {
      issues.push({
        severity: "warning",
        agentId: node.id,
        message: `${node.name} has no capabilities and will most likely fail its task.`,
      });
    }
    for (const grant of node.grants) {
      if (grant.scopes.includes("admin")) {
        issues.push({
          severity: "error",
          agentId: node.id,
          message: `${node.name} holds an admin grant; this must be approved by a workspace owner.`,
        });
      }
    }
  }

  // Cycle detection — parent pointers must form a forest.
  for (const node of graph.nodes) {
    const seen = new Set<string>();
    let cursor: string | null = node.id;
    while (cursor) {
      if (seen.has(cursor)) {
        issues.push({
          severity: "error",
          agentId: node.id,
          message: "Cycle detected in delegation graph.",
        });
        break;
      }
      seen.add(cursor);
      cursor = graph.nodes.find((n) => n.id === cursor)?.parentAgentId ?? null;
    }
  }

  return issues;
}

export const TriggerSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  kind: z.enum(["manual", "schedule", "webhook"]),
  /** Cron expression for `schedule`. */
  cron: z.string().nullable().default(null),
  eventFilter: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  lastFiredAt: z.string().nullable().default(null),
});
export type Trigger = z.infer<typeof TriggerSchema>;

export const PromptBlockSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  /** `org` blocks are mandatory and cannot be overridden by builders. */
  level: z.enum(["org", "team", "agent"]),
  content: z.string(),
  version: z.number().int().positive().default(1),
  locked: z.boolean().default(false),
});
export type PromptBlock = z.infer<typeof PromptBlockSchema>;

export interface ResolvedPrompt {
  text: string;
  blocks: Array<{ id: string; name: string; level: PromptBlock["level"] }>;
}

/** Org blocks first (locked), then team, then the agent's own instructions. */
export function resolvePrompt(
  agent: AgentConfig,
  blocks: readonly PromptBlock[],
): ResolvedPrompt {
  const inherited = blocks
    .filter((b) => agent.inheritedPromptBlockIds.includes(b.id))
    .sort((a, b) => {
      const order = { org: 0, team: 1, agent: 2 } as const;
      return order[a.level] - order[b.level];
    });

  const parts: string[] = [];
  for (const block of inherited) {
    parts.push(`<!-- ${block.name} (${block.level}) -->\n${block.content.trim()}`);
  }
  parts.push(`<!-- agent instructions -->\n${agent.instructions.trim()}`);

  return {
    text: parts.join("\n\n"),
    blocks: inherited.map((b) => ({ id: b.id, name: b.name, level: b.level })),
  };
}
