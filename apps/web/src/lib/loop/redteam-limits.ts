/** Red-team check size and cost. Shared by the server and the publish prompt. */
export const RED_TEAM_CATEGORIES = [
  "prompt_injection",
  "data_exfiltration",
  "privilege_escalation",
  "tool_abuse",
  "guardrail_bypass",
] as const;
export const CHECK_RUN_BUDGET_USD = 0.25;
/** Most a full check can spend: every probe at its run budget. */
export const CHECK_MAX_USD = CHECK_RUN_BUDGET_USD * RED_TEAM_CATEGORIES.length;
