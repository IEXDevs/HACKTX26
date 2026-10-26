import { eq } from "drizzle-orm";
import { buildGraph, validateGraph, type AgentConfig } from "@agent-os/core";
import { getDb } from "./db/client";
import { agents, auditLog, budgetPolicies, type Workspace } from "./db/schema";
import { newId } from "./env";
import { workerDepths } from "./agent-tree";
import { WorkflowSelectionSchema, type WorkflowSelection } from "./workflow-selection";

/** Workflow instances reuse reviewed library configurations without moving the library agents. */
export async function saveLibraryWorkflow(workspace: Workspace, input: WorkflowSelection, actor: string) {
  const selection = WorkflowSelectionSchema.parse(input);
  const db = await getDb();
  const library = await db.select().from(agents).where(eq(agents.workspaceId, workspace.id));
  const sources = selection.nodes.map((node) => {
    const source = library.find((agent) => agent.id === node.agentId && !agent.sourceAgentId && agent.status !== "archived");
    if (!source) throw new Error("A selected agent is no longer available in this workspace.");
    return source;
  });
  const ids = new Map(selection.nodes.map((node) => [node.id, newId("agt")]));
  const indexes = new Map(selection.nodes.slice(1).map((node, index) => [node.id, index]));
  const depths = [0, ...workerDepths(selection.nodes.slice(1).map((node) => ({ parentIndex: indexes.get(node.parentId!) ?? -1 })))];
  const ranks = ["orchestrator", "intermediate", "intermediate_2", "grunt"] as const;
  const now = new Date();
  const rows = selection.nodes.map((node, index) => {
    const source = sources[index]!;
    const id = ids.get(node.id)!;
    const children = selection.nodes.filter((child) => child.parentId === node.id).map((child) => sources[selection.nodes.indexOf(child)]!.name);
    return {
      ...source, id, sourceAgentId: source.id, slug: `workflow-${id}`,
      name: index === 0 ? selection.name : source.name,
      defaultGoal: index === 0 ? selection.goal || source.defaultGoal : source.defaultGoal,
      parentAgentId: node.parentId ? ids.get(node.parentId)! : null,
      rank: ranks[depths[index]!]!, canSpawnSubagents: selection.mode === "dynamic" && index === 0,
      proposeTemplates: false, status: "active" as const, createdAt: now, updatedAt: now,
      instructions: children.length
        ? `${source.instructions}\n\nWorkflow children: ${children.join(", ")}. Delegate their assigned work with agent.delegate and collect their reports.`
        : source.instructions,
    };
  });
  const configs = rows.map((row, index): AgentConfig => ({
    ...row, role: index === 0 ? "orchestrator" : row.role,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  }));
  const problems = validateGraph(buildGraph(configs)).filter((issue) => issue.severity === "error");
  if (problems.length) throw new Error(problems.map((issue) => issue.message).join(" "));
  const workflowId = rows[0]!.id;
  await db.transaction(async (transaction) => {
    await transaction.insert(agents).values(rows);
    await transaction.insert(budgetPolicies).values({
      id: newId("bp"), workspaceId: workspace.id, agentId: workflowId, period: "run",
      limitUsd: workspace.defaultRunBudgetUsd, warnAt: 0.8, hardStop: true, createdAt: now,
    });
    await transaction.insert(auditLog).values({
      id: newId("aud"), workspaceId: workspace.id, actor, action: "workflow.created", targetType: "agent", targetId: workflowId,
      detail: { mode: selection.mode, sourceAgentIds: sources.map((source) => source.id), createdAgents: rows.map((row) => row.id) }, at: now,
    });
  });
  return { workflowId, nodes: selection.nodes.map((node) => ({ id: node.id, agentId: ids.get(node.id)! })) };
}
