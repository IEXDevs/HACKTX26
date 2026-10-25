import { z } from "zod";
import type { BuilderDraft } from "./runtime/builder-parse";

export const WorkflowModeSchema = z.enum(["manual", "dynamic", "automatic"]);
export type WorkflowMode = z.infer<typeof WorkflowModeSchema>;

export const WORKFLOW_MODES = [
  { id: "manual", name: "Manual", description: "Choose existing agents and connect them into a tree." },
  { id: "dynamic", name: "Dynamic", description: "Choose a lead. The model decides which agents to use as it runs." },
  { id: "automatic", name: "Automatic", description: "Describe the task. Arrange existing agents into a static tree." },
] as const;

/** Enforce the selected mode at creation, even if a client sends conflicting settings. */
export function workflowCreation(mode: WorkflowMode, draft: BuilderDraft) {
  return {
    draft: mode === "dynamic" ? { ...draft, workers: [] } : draft,
    canSpawnSubagents: mode === "dynamic",
    proposeTemplates: false,
  };
}

export function workflowBuilderGuidance(mode: Exclude<WorkflowMode, "manual">) {
  return mode === "dynamic"
    ? "Workflow mode: dynamic. Draft only the lead agent, with an empty workers array. Instruct the lead to decide which children it needs and create them through agent.delegate during the run. Do not design a fixed team in advance."
    : "Workflow mode: automatic static tree. Generate the complete team before the run. Workers may have children: use parentIndex=-1 for a direct child of the lead, or the zero-based index of an earlier worker for a nested child. Keep at most three levels below the lead. Tell each parent which named children to delegate to. No agent can create new children during the run. Return the full tree for the person to review.";
}
