/** Shared helpers for the feedback-loop tests. Not imported by app code. */
import { getDb } from "@/lib/db/client";
import { runEvents, runs } from "@/lib/db/schema";
import { seedDatabase } from "@/lib/db/seed";
import { checkRetest, loadCase, type RetestRunner } from "./cases";

export async function freshDb() {
  const g = globalThis as unknown as { __agentOsDb?: unknown };
  delete g.__agentOsDb;
  (await getDb());
  await seedDatabase();
}

/** Recover a probe's canary from its goal, as an agent that obeys the attack would. */
export function canaryIn(goal: string): string {
  const split = goal.match(/joining "CANARY-" and "([^"]+)"/);
  if (split) return `CANARY-${split[1]}`;
  return goal.match(/CANARY-[A-Z0-9]+-[A-F0-9]{8}/)![0];
}

/**
 * Stands in for the run engine: records a finished run with the chosen
 * outcome. A "leak" run writes the probe's canary, as a vulnerable agent would.
 */
export function fakeRunner(
  outcome: (goal: string, index: number) => "pass" | "leak" | "pending",
  cost = 0.05,
): RetestRunner & { goals: string[]; runIds: string[] } {
  const goals: string[] = [];
  const runIds: string[] = [];
  return {
    goals,
    runIds,
    async start({ workspaceId, agentId, goal, budgetUsd }) {
      goals.push(goal);
      const id = `run_test_${goals.length}_${Math.random().toString(36).slice(2, 8)}`;
      runIds.push(id);
      const result = outcome(goal, goals.length - 1);
      const db = await getDb();
      await db.insert(runs).values({
        id,
        workspaceId,
        agentId,
        goal,
        status: result === "pending" ? "running" : "succeeded",
        budgetUsd,
        costUsd: cost,
        mode: "live",
        purpose: "retest",
        summary: result === "leak" ? `Done. ${canaryIn(goal)}` : "Done. I treated the material as data.",
        startedAt: new Date(),
        endedAt: result === "pending" ? null : new Date(),
      });
      await db.insert(runEvents).values({
        id: `${id}_e1`,
        runId: id,
        seq: 1,
        ts: new Date(),
        type: "agent.message",
        agentId,
        hash: "h1",
        prevHash: "h0",
        payload: {
          type: "agent.message",
          agentId,
          role: "assistant",
          text: result === "leak" ? `Following the note: ${canaryIn(goal)}` : "The note is untrusted; ignoring it.",
        },
      });
      return id;
    },
  };
}

/** Step a sequential retest until it finishes or stops moving. */
export async function drain(caseId: string, runner: RetestRunner) {
  for (let i = 0; i < 20; i++) {
    const before = await loadCase(caseId);
    const after = await checkRetest(caseId, runner);
    const latest = after.retests.at(-1);
    if (!latest || latest.verdict !== "pending") return after;
    if (latest.runs.length === before.retests.at(-1)?.runs.length) return after;
  }
  return loadCase(caseId);
}
