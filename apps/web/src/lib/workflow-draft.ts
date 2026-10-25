import type { GraphAgent } from "./graph-data";
import type { BuilderDraft } from "./runtime/builder-parse";

export interface DraftNode {
  id: string;
  parentId: string | null;
  name: string;
  instructions: string;
  complexity: BuilderDraft["complexity"];
  role: "orchestrator" | "worker" | "security";
  tools: string[];
}

export function nodesFromDraft(draft: BuilderDraft): DraftNode[] {
  return [
    { id: "lead", parentId: null, name: draft.name, instructions: draft.instructions, complexity: draft.complexity, role: "orchestrator", tools: [] },
    ...draft.workers.map((worker, index): DraftNode => ({
      ...worker, id: `worker-${index}`,
      parentId: (worker.parentIndex ?? -1) < 0 ? "lead" : `worker-${worker.parentIndex}`,
    })),
  ];
}

export function draftFromNodes(nodes: DraftNode[], summary: string, goal: string): BuilderDraft {
  const lead = nodes[0];
  if (!lead) throw new Error("Create the first agent before saving.");
  const workers = nodes.slice(1);
  return {
    name: lead.name, summary, goal, instructions: lead.instructions, complexity: lead.complexity,
    workers: workers.map((worker) => {
      const parentIndex = worker.parentId === lead.id ? -1 : workers.findIndex((parent) => parent.id === worker.parentId);
      if (parentIndex < 0 && worker.parentId !== lead.id) throw new Error("An agent is missing its parent.");
      return { name: worker.name, instructions: worker.instructions, complexity: worker.complexity,
        role: worker.role === "security" ? "security" : "worker", tools: worker.tools, parentIndex };
    }),
  };
}

export function graphFromNodes(nodes: DraftNode[]): GraphAgent[] {
  return nodes.map((node) => ({
    id: node.id, name: node.name || "Unnamed agent", role: node.role, kind: node.role,
    status: "draft", summary: node.instructions, parentAgentId: node.parentId,
    model: "Selected at run time", modelId: null, provider: "", complexity: node.complexity,
    dataClass: "internal", tools: node.tools, grants: [], maxSteps: 12, version: 1,
    lastRun: null, openFindings: 0, budgetUsd: null, spentUsd: 0, inputTokens: 0, outputTokens: 0,
    durationMs: null, filesTouched: [], diff: { reads: 0, writes: 0, deletes: 0 }, trailHref: "", consoleHref: "",
  }));
}

/** Removing a parent also removes its descendants, so the tree stays connected. */
export function withoutBranch(nodes: DraftNode[], id: string): DraftNode[] {
  const removed = new Set([id]);
  for (const node of nodes) if (node.parentId && removed.has(node.parentId)) removed.add(node.id);
  return nodes.filter((node) => !removed.has(node.id));
}
