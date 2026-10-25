/** Red-team check size and cost. Shared by the server and the publish prompt. */
export const RED_TEAM_CATEGORIES = [
  "prompt_injection",
  "data_exfiltration",
  "privilege_escalation",
  "tool_abuse",
  "guardrail_bypass",
] as const;

export const CATEGORY_LABELS: Record<(typeof RED_TEAM_CATEGORIES)[number], string> = {
  prompt_injection: "Prompt injection",
  data_exfiltration: "Credential leak",
  privilege_escalation: "Privilege escalation",
  tool_abuse: "Tool abuse",
  guardrail_bypass: "Guardrail bypass",
};
export const CHECK_RUN_BUDGET_USD = 0.25;
/** Most a full check can spend: every probe at its run budget. */
export const CHECK_MAX_USD = CHECK_RUN_BUDGET_USD * RED_TEAM_CATEGORIES.length;

/** How many labeled attacks fit in a spend cap. Zero if the cap cannot cover one. */
export function probeCountForLimit(limitUsd: number): number {
  if (!Number.isFinite(limitUsd) || limitUsd < CHECK_RUN_BUDGET_USD) return 0;
  return Math.min(RED_TEAM_CATEGORIES.length, Math.floor((limitUsd + 1e-9) / CHECK_RUN_BUDGET_USD));
}
