/**
 * Which tools an agent may actually call on a run.
 *
 * The model only sees this set, and the executor only honours this set. If a
 * tool is advertised but denied at call time (or the other way around), the
 * model burns steps on retries that cannot succeed.
 */
import type { DataClass } from "@agent-os/core";
import { TOOL_BY_NAME } from "@agent-os/core";
import { SERPAPI_TOOLKIT } from "@/lib/composio";
import type { AgentRow } from "@/lib/db/schema";
import { CASE_TOOL_BY_NAME, mayUseCaseTool } from "@/lib/loop/case-tools";
import {
  BLUE_TEAM_SPECIALISTS,
  RED_TEAM_SPECIALISTS,
  redTeamSpecialist,
} from "./scripts";

export type CapabilityAgent = Pick<AgentRow, "name" | "role" | "rank" | "team" | "allowedTools">;

export function mayDelegate(agent: Pick<CapabilityAgent, "rank">): boolean {
  return agent.rank !== "grunt";
}

export function isProbeLead(agent: CapabilityAgent): boolean {
  return (
    agent.role === "security" &&
    agent.team !== "blue" &&
    agent.rank !== "grunt" &&
    redTeamSpecialist(agent.name) === undefined
  );
}

export function isBlueLead(agent: Pick<CapabilityAgent, "team" | "rank">): boolean {
  return agent.team === "blue" && agent.rank !== "grunt";
}

export function heldToolNames(
  agent: CapabilityAgent,
  connectors: readonly string[],
  dataClass: DataClass,
): Set<string> {
  const names = new Set(
    agent.allowedTools.filter((name) => !CASE_TOOL_BY_NAME.has(name) || mayUseCaseTool(agent, name)),
  );
  if (mayDelegate(agent)) names.add("agent.delegate");
  if (agent.role === "security" && agent.team !== "blue") names.add("security.report");
  names.add("context.read");
  names.add("user.ask");
  // CONTEXT.md is workspace-wide. File-writing agents (Red Team, Patch Author)
  // keep fs.write for their own sandbox; they do not inherit context.write
  // from it. Orchestrators, and anyone granted the tool, may update the file.
  if (agent.role === "orchestrator" || names.has("context.write")) {
    names.add("context.write");
  }
  if (connectors.length > 0) names.add("connector.call");
  const publicWeb = dataClass !== "confidential" && dataClass !== "restricted";
  if (publicWeb && connectors.includes(SERPAPI_TOOLKIT)) names.add("web.search");
  return names;
}

/** Pull the child name out of an agent.delegate call, including common aliases. */
export function delegateAgentName(args: Record<string, unknown>): string | null {
  for (const key of ["agent", "name", "specialist"]) {
    const found = stringFrom(args[key]);
    if (found) return found;
  }
  return null;
}

function stringFrom(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nested = value as Record<string, unknown>;
    for (const key of ["name", "agent"]) {
      if (typeof nested[key] === "string" && nested[key].trim()) return nested[key].trim();
    }
  }
  return null;
}

export function delegateToolDescription(agent: CapabilityAgent): string {
  const base =
    TOOL_BY_NAME.get("agent.delegate")?.description ??
    "Hand a bounded subtask to a child grunt that reports back to you.";
  if (isProbeLead(agent)) {
    const names = RED_TEAM_SPECIALISTS.map((spec) => spec.name).join(", ");
    return `Hand one probe to a specialist. The agent argument must be exactly one of: ${names}. Do not invent other agents or spawn extra workers.`;
  }
  if (isBlueLead(agent)) {
    const names = BLUE_TEAM_SPECIALISTS.map((spec) => spec.name).join(", ");
    return `Hand one case step to a specialist. The agent argument must be one of: ${names}. Pass the case id as "case". Do not invent other agents.`;
  }
  return base;
}

export function closedRosterNames(agent: CapabilityAgent): string | null {
  if (isProbeLead(agent)) return RED_TEAM_SPECIALISTS.map((spec) => spec.name).join(", ");
  if (isBlueLead(agent)) return BLUE_TEAM_SPECIALISTS.map((spec) => spec.name).join(", ");
  return null;
}
