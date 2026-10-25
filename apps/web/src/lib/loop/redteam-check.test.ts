import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { agents, auditLog, runEvents, runs, securityFindings } from "@/lib/db/schema";
import { seedDatabase } from "@/lib/db/seed";
import type { RetestRunner } from "./cases";
import { TEST_DATA_LABEL } from "./probes";
import { runRedTeamCheck } from "./redteam-check";
import { RED_TEAM_CATEGORIES } from "./redteam-limits";

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
  beforeEach(freshDb);

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
  });

  it("refuses an agent that is not published", async () => {
    await getDb().update(agents).set({ status: "draft" }).where(eq(agents.id, TARGET));
    await expect(runRedTeamCheck(TARGET, "sid@astronom.dev", { runner: runner(), waitForRun: async () => {} })).rejects.toThrow(
      /not published/,
    );
  });
});
