import { z } from "zod";
import type { GraphAgent } from "./graph-data";
import { workerDepths } from "./agent-tree";
import { WorkflowModeSchema } from "./workflow-mode";

export interface LibraryAgent {
  id: string;
  name: string;
  summary: string;
  role: string;
  model: string;
  modelId: string | null;
  provider: string;
  complexity: string;
  dataClass: string;
  tools: string[];
}

export interface WorkflowSlot {
  id: string;
  parentId: string | null;
  agentId: string | null;
}

export const SelectedNodeSchema = z.object({
  id: z.string().min(1).max(100),
  parentId: z.string().min(1).max(100).nullable(),
  agentId: z.string().min(1).max(100),
});

export const WorkflowSelectionSchema = z.object({
  name: z.string().trim().min(1).max(64),
  goal: z.string().trim().max(4000).optional(),
  mode: WorkflowModeSchema,
  nodes: z.array(SelectedNodeSchema).min(1).max(25),
}).superRefine(({ nodes }, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", path: ["nodes"], message });
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) return fail("Each graph node needs a unique id.");
  if (nodes[0]?.parentId !== null || nodes.slice(1).some((node) => node.parentId === null)) return fail("Choose one lead agent.");
  const workers = nodes.slice(1);
  try {
    workerDepths(workers.map((node) => {
      if (node.parentId === nodes[0]!.id) return { parentIndex: -1 };
      const parentIndex = workers.findIndex((parent) => parent.id === node.parentId);
      if (parentIndex < 0) throw new Error("An agent is missing its parent.");
      return { parentIndex };
    }));
  } catch (error) { fail((error as Error).message); }
});
export type WorkflowSelection = z.infer<typeof WorkflowSelectionSchema>;

export function selectionGraph(slots: WorkflowSlot[], library: LibraryAgent[]): GraphAgent[] {
  return slots.map((slot) => {
    const agent = library.find((item) => item.id === slot.agentId);
    const role = agent?.role === "security" ? "security" : slot.parentId ? "worker" : "orchestrator";
    return {
      id: slot.id, parentAgentId: slot.parentId, placeholder: !agent,
      name: agent?.name ?? "Choose agent", summary: agent?.summary ?? "", role, kind: role,
      status: "draft", model: agent?.model ?? "", modelId: agent?.modelId ?? null, provider: agent?.provider ?? "",
      complexity: agent?.complexity ?? "standard", dataClass: agent?.dataClass ?? "internal", tools: agent?.tools ?? [],
      grants: [], maxSteps: 12, version: 1, lastRun: null, openFindings: 0, budgetUsd: null, spentUsd: 0,
      inputTokens: 0, outputTokens: 0, durationMs: null, filesTouched: [], diff: { reads: 0, writes: 0, deletes: 0 }, trailHref: "", consoleHref: "",
      rank: slot.parentId ? "grunt" : "orchestrator", createdAt: "",
    };
  });
}

export function removeSlotBranch(slots: WorkflowSlot[], id: string): WorkflowSlot[] {
  const removed = new Set([id]);
  for (const slot of slots) if (slot.parentId && removed.has(slot.parentId)) removed.add(slot.id);
  const remaining = slots.filter((slot) => !removed.has(slot.id));
  return remaining.length ? remaining : [{ id: "lead", parentId: null, agentId: null }];
}
