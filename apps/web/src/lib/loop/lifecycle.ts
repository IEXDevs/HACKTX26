/**
 * Finding lifecycle for the red-team feedback loop. Pure: no database, no app
 * imports, so the rules are easy to test and reuse in the schema.
 *
 * A finding moves:
 *   open -> accepted -> proposed_fix -> approved -> applied -> retesting
 *        -> retest_passed -> fixed
 *        -> retest_failed -> proposed_fix (next round)
 *
 * Only retest_passed may become fixed. A fix alone never closes a finding.
 */

export const FINDING_STATUSES = [
  "open",
  "accepted",
  "proposed_fix",
  "approved",
  "applied",
  "retesting",
  "retest_passed",
  "retest_failed",
  "fixed",
  "false_positive",
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

const NEXT: Record<FindingStatus, readonly FindingStatus[]> = {
  open: ["accepted", "false_positive"],
  accepted: ["proposed_fix", "false_positive"],
  // A revised proposal replaces the last one and voids any approval of it.
  proposed_fix: ["proposed_fix", "approved", "false_positive"],
  approved: ["applied", "proposed_fix"],
  applied: ["retesting"],
  retesting: ["retest_passed", "retest_failed"],
  retest_passed: ["fixed"],
  retest_failed: ["proposed_fix"],
  fixed: [],
  false_positive: [],
};

export function canTransition(from: FindingStatus, to: FindingStatus): boolean {
  return NEXT[from].includes(to);
}

export function assertTransition(from: FindingStatus, to: FindingStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`A finding cannot move from ${from.replaceAll("_", " ")} to ${to.replaceAll("_", " ")}.`);
  }
}

export function isFindingStatus(value: unknown): value is FindingStatus {
  return typeof value === "string" && (FINDING_STATUSES as readonly string[]).includes(value);
}

/* ---------- Rounds and budget ---------- */

export const DEFAULT_MAX_ROUNDS = 3;
export const DEFAULT_LOOP_BUDGET_USD = 2;
export const DEFAULT_RETEST_RUN_BUDGET_USD = 0.25;

/** What happens after a failed retest. */
export function afterRetestFailure(round: number, maxRounds: number): "next_round" | "escalate" {
  return round >= maxRounds ? "escalate" : "next_round";
}

/**
 * A round may start only if its reserved run budgets fit under the cap with
 * what the loop already spent. The cap is never raised here.
 */
export function roundFitsBudget(spentUsd: number, roundCostUsd: number, capUsd: number): boolean {
  return spentUsd + roundCostUsd <= capUsd + 1e-9;
}
