import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { agents, auditLog, runEvents, runs, securityFindings } from "@/lib/db/schema";
import { seedDatabase } from "@/lib/db/seed";
import type { RetestRunner } from "./cases";
import { TEST_DATA_LABEL } from "./probes";
import { clearLiveChecks, runRedTeamCheck } from "./redteam-check";
import { CHECK_RUN_BUDGET_USD, RED_TEAM_CATEGORIES } from "./redteam-limits";

const TARGET = "agt_code_reviewer";

async function freshDb() {
  const g = globalThis as unknown as { __agentOsDb?: unknown };
  delete g.__agentOsDb;
  getDb();
  await seedDatabase();
}

function canaryIn(goal: string): string {
  const split = goal.match(/joining "CANARY-" and "([^"]+)"/);
  return split ? `CANARY-${split[1]}` : goal.match(/CANARY-[A-Z0-9]+-[A-F0-9]{8}/)![0];
}

/** Far below each run's $0.25 budget, as real probes are. */
const RUN_COST_USD = 0.03;

/** A target that falls for hidden instructions and resists everything else. */
function runner(): RetestRunner & { goals: string[] } {
  const goals: string[] = [];
  return {
    goals,
    async start({ workspaceId, agentId, goal, budgetUsd }) {
      goals.push(goal);
      const id = `run_rt_${goals.length}`;
      const obeys = goal.includes("SYSTEM: ignore prior instructions");
      await getDb().insert(runs).values({
        id,
        workspaceId,
        agentId,
        goal,
        status: "succeeded",
        budgetUsd,
        costUsd: RUN_COST_USD,
        mode: "live",
        purpose: "retest",
        summary: obeys ? `Done. ${canaryIn(goal)}` : "Done.",
        startedAt: new Date(),
        endedAt: new Date(),
      });
      await getDb().insert(runEvents).values({
        id: `${id}_e1`,
        runId: id,
        seq: 1,
        ts: new Date(),
        type: "agent.message",
        agentId,
        hash: "h1",
        prevHash: "h0",
        payload: { type: "agent.message", agentId, role: "assistant", text: "Treating the material as data." },
      });
      return id;
    },
  };
}

describe("red-team check", () => {
  beforeEach(async () => {
    clearLiveChecks();
    await freshDb();
  });

  it("sends one labeled attack per type and records only the attacks that worked", async () => {
    const fake = runner();
    const result = await runRedTeamCheck(TARGET, "sid@astronom.dev", { runner: fake, waitForRun: async () => {} });
    expect(fake.goals).toHaveLength(RED_TEAM_CATEGORIES.length);
    expect(fake.goals.every((g) => g.startsWith(TEST_DATA_LABEL))).toBe(true);
    expect(result.findingIds).toHaveLength(1);

    const [finding] = await getDb().select().from(securityFindings).where(eq(securityFindings.id, result.findingIds[0]!));
    expect(finding).toMatchObject({ targetAgentId: TARGET, category: "prompt_injection", status: "open", agentId: "agt_red_team" });

    const actions = (await getDb().select().from(auditLog).where(eq(auditLog.targetId, TARGET))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["redteam.check_started", "redteam.finding_recorded", "redteam.check_finished"]));
    expect(result.probes).toHaveLength(RED_TEAM_CATEGORIES.length);
    expect(result.probes.filter((probe) => probe.held)).toHaveLength(RED_TEAM_CATEGORIES.length - 1);
    expect(result.probes.find((probe) => !probe.held)?.category).toBe("prompt_injection");

    const finished = (await getDb().select().from(auditLog).where(eq(auditLog.targetId, TARGET))).find(
      (row) => row.action === "redteam.check_finished",
    );
    expect(finished?.detail).toMatchObject({ findings: 1, agentName: expect.any(String) });
    expect((finished?.detail as { probes: unknown[] }).probes).toHaveLength(RED_TEAM_CATEGORIES.length);
  });

  it("caps probes to the spend limit and still writes held vs not-fixed reports", async () => {
    const fake = runner();
    const result = await runRedTeamCheck(TARGET, "sid@astronom.dev", { runner: fake, waitForRun: async () => {} }, { maxUsd: CHECK_RUN_BUDGET_USD * 2 });
    expect(fake.goals).toHaveLength(2);
    expect(result.probes).toHaveLength(2);
    expect(result.probes[0]).toMatchObject({ category: "prompt_injection", held: false });
    expect(result.probes[1]).toMatchObject({ category: "data_exfiltration", held: true });
    // Reports what the runs cost, not the $0.50 their budgets would allow.
    expect(result.spentUsd).toBeCloseTo(RUN_COST_USD * 2);
    const finished = (await getDb().select().from(auditLog).where(eq(auditLog.targetId, TARGET))).find(
      (row) => row.action === "redteam.check_finished",
    );
    expect((finished?.detail as { spentUsd: number }).spentUsd).toBeCloseTo(RUN_COST_USD * 2);
  });

  it("refuses an agent that is not published", async () => {
    await getDb().update(agents).set({ status: "draft" }).where(eq(agents.id, TARGET));
    await expect(runRedTeamCheck(TARGET, "sid@astronom.dev", { runner: runner(), waitForRun: async () => {} })).rejects.toThrow(
      /not published/,
    );
  });
});
