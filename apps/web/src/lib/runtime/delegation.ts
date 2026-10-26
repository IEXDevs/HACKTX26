import { TOOL_BY_NAME, nextAgentRank, provisionMetaModel, type AgentRank, type ModelPolicy, type PermissionGrant, type TaskComplexity } from "@agent-os/core";
import type { AgentRow } from "../db/schema";
import { CASE_TOOL_BY_NAME } from "../loop/case-tools";
import { isBlueLead, isProbeLead } from "./capabilities";
import { BLUE_TEAM_SPECIALISTS, RED_TEAM_SPECIALISTS, DELEGATION_GUIDANCE, SEVERITY_RUBRIC } from "./scripts";

export function childRank(parent: AgentRow): AgentRank {
  return nextAgentRank(parent.rank) ?? "grunt";
}

export function delegationGuidance(agent: AgentRow): string {
  if (agent.rank === "grunt") {
    return "\n\nYou are a grunt. Do the assigned task and report upward. You cannot create subagents or propose templates.";
  }
  // Team leads already get a closed roster in specialistRoster. Generic
  // "name a grunt" guidance made Red Team invent extra workers the platform
  // then refused.
  if (isProbeLead(agent) || isBlueLead(agent)) return "";
  const spawn = agent.canSpawnSubagents
    ? " Dynamic subagent creation is on: a missing child is created one rank below you."
    : " Dynamic subagent creation is off: you can only delegate to a child that already exists.";
  const approval = agent.proposeTemplates
    ? " Template proposal is on: a reusable child is filed for the operator to approve."
    : "";
  return `\n\n${DELEGATION_GUIDANCE}${spawn}${approval}`;
}

export function specialistRoster(agent: AgentRow): string {
  if (isBlueLead(agent)) {
    const names = BLUE_TEAM_SPECIALISTS.map((spec) => spec.name).join(", ");
    return [
      "",
      "",
      "You lead the blue team. Do not triage, draft, or verify yourself.",
      `Delegate each step with agent.delegate, passing agent as one of: ${names}, and pass the case id as "case". Each is created for one case (a Verifier for one round) and retires when the case closes. Do not invent other agents.`,
      "The Verifier is never the Fix Drafter. A person approves every change; the platform applies it. Start a retest only with case.start_retest, after a Verifier has the round.",
    ].join("\n");
  }
  if (!isProbeLead(agent)) return "";
  const names = RED_TEAM_SPECIALISTS.map((spec) => spec.name).join(", ");
  return [
    "",
    "",
    "You lead the probe. Plan the probes from the run goal. Do not run the vectors yourself.",
    `Delegate each one with agent.delegate, passing agent as one of: ${names}. A specialist is created on first use and reused after that. Do not invent other agents or extra workers.`,
    "Each specialist files its own finding. A denied credential request is the control working, not a finding.",
    "Accept a finding only when its reproduction is exact: the input, the output or action observed, and the steps to repeat it.",
    SEVERITY_RUBRIC,
    "Test data is synthetic and labeled as test data, and stays in sandbox corpora. Use canary secrets only; a real secret never goes into a finding, a case, a diff, or a log.",
  ].join("\n");
}

/**
 * A specialist holds low and medium tools from its roster entry, never
 * delegation. The one exception is the Egress Prober's secret.use: asking is
 * the probe, and the engine always denies it to security agents.
 */
export function specialistTools(tools: readonly string[]): string[] {
  return tools.filter((name) => {
    if (name === "agent.delegate" || name === "security.report") return false;
    if (name === "secret.use") return true;
    const entry = TOOL_BY_NAME.get(name) ?? CASE_TOOL_BY_NAME.get(name);
    return entry?.risk === "low" || entry?.risk === "medium";
  });
}

export function complexityForTask(task: string, requested?: string | null): TaskComplexity {
  if (
    requested === "trivial" ||
    requested === "standard" ||
    requested === "complex" ||
    requested === "critical"
  ) {
    return requested;
  }
  if (/(critical|production|security|exploit|red.?team)/i.test(task)) return "complex";
  if (/(lookup|list|summar|triage|draft|status update)/i.test(task)) return "trivial";
  return "standard";
}

export function pinnedMetaPolicy(complexity: TaskComplexity, deniedModelIds: readonly string[]): ModelPolicy {
  return {
    mode: "pinned",
    pinnedModelId: provisionMetaModel(complexity, deniedModelIds),
    costSensitivity: complexity === "trivial" ? 0.75 : 0.2,
    latencySensitivity: 0.15,
    floorComplexity: complexity === "trivial" ? "standard" : complexity,
    deniedModelIds: [],
  };
}

export function grantsForSpecialist(tools: readonly string[]): PermissionGrant[] {
  const grants: PermissionGrant[] = [];
  for (const tool of tools) {
    const entry = TOOL_BY_NAME.get(tool);
    if (!entry || (entry.risk !== "low" && entry.risk !== "medium")) continue;
    grants.push({
      resource: entry.name,
      scopes: entry.scopes,
      // From the roster a person approved, never from the lead that spawned it.
      grantedBy: "team-roster",
      note: "Standing grant for a team specialist.",
    });
  }
  return grants;
}
