import { TOOL_BY_NAME, type DataClass } from "@agent-os/core";
import type { AgentRow } from "../db/schema";
import { CASE_TOOL_BY_NAME } from "../loop/case-tools";
import { delegateToolDescription, heldToolNames } from "./capabilities";
import type { ToolSpec } from "./types";

export function toolSpecsFor(agent: AgentRow, connectors: readonly string[], dataClass: DataClass, rootAgentId: string): ToolSpec[] {
  const names = heldToolNames(agent, connectors, dataClass);
  if (agent.id === rootAgentId) names.add("motivator.report");
  else names.delete("motivator.report");
  return [...names].flatMap((name) => {
    const entry = TOOL_BY_NAME.get(name) ?? CASE_TOOL_BY_NAME.get(name);
    if (!entry) return [];
    if (!entry.parameters) throw new Error(`No argument schema for ${name}.`);
    return [{ name, description: name === "agent.delegate" ? delegateToolDescription(agent) : entry.description, parameters: entry.parameters }];
  });
}
