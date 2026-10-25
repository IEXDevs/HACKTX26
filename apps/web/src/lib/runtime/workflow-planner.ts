import { MODEL_BY_ID } from "@agent-os/core";
import { createLiveGateway, liveGatewayAvailable } from "./gateway";
import { BUILDER_MODEL } from "./builder";
import { WorkflowSelectionSchema, type WorkflowSelection } from "../workflow-selection";
import type { AgentRow } from "../db/schema";
import { recordModelTurn } from "../observability";

/** A planner arranges library agents. It never authors or persists agents. */
export async function planLibraryWorkflow(options: {
  workspaceId: string;
  mode: "automatic" | "dynamic";
  prompt: string;
  current?: string;
  library: AgentRow[];
}): Promise<WorkflowSelection> {
  const library = options.library.filter((agent) => !agent.sourceAgentId && agent.status !== "archived");
  if (!library.length) throw new Error("Add an agent in Agents before arranging a workflow.");
  if (!liveGatewayAvailable()) throw new Error("No live model is configured for arranging agents.");
  const catalog = library.map((agent) => ({ id: agent.id, name: agent.name, summary: agent.summary, tools: agent.allowedTools }));
  const messages = [
    { role: "system" as const, content: `Arrange existing agents into a workflow. Select only agentId values from this library: ${JSON.stringify(catalog)}.
Do not invent agents, write their instructions, or request new agents. Return only JSON: {"name":"short workflow title","goal":"the task the workflow should execute","nodes":[{"id":"lead","parentId":null,"agentId":"existing id"},{"id":"child-1","parentId":"lead","agentId":"existing id"}]}.
Use one lead, at most 25 nodes, and at most three levels below the lead. List parents before their children. Give each node a unique id. The same library agent can be reused in different nodes.
${options.mode === "dynamic" ? "Dynamic mode: select only the lead agent. It will decide its children during the run." : "Automatic mode: choose and connect the complete static tree now."}
Preserve existing choices and the goal in the current graph unless the person asks to change them.` },
    ...(options.current ? [{ role: "user" as const, content: `Current graph: ${options.current}` }] : []),
    { role: "user" as const, content: options.prompt },
  ];
  let text = "", inputTokens = 0, outputTokens = 0;
  for await (const chunk of createLiveGateway().complete({
    model: BUILDER_MODEL, messages, tools: [], temperature: 0.2, maxOutputTokens: 2500,
    reasoningEffort: MODEL_BY_ID.get(BUILDER_MODEL)?.provider === "meta" ? "medium" : undefined,
  })) {
    if (chunk.type === "text") text += chunk.text;
    if (chunk.type === "usage") { inputTokens = chunk.inputTokens; outputTokens = chunk.outputTokens; }
  }
  await recordModelTurn({ workspaceId: options.workspaceId, source: "builder", agentName: "Workflow planner", model: BUILDER_MODEL, messages, completion: text, inputTokens, outputTokens });
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model did not return a workflow graph. Try describing the task again.");
  const selection = WorkflowSelectionSchema.parse({ ...JSON.parse(text.slice(start, end + 1)), mode: options.mode });
  if (selection.nodes.some((node) => !library.some((agent) => agent.id === node.agentId))) throw new Error("The model selected an unavailable agent. Try again.");
  if (options.mode === "dynamic") selection.nodes = selection.nodes.slice(0, 1);
  return selection;
}
