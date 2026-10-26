import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { runs } from "@/lib/db/schema";
import { freshDb } from "@/lib/loop/test-support";
import { TEST_DATA_LABEL } from "@/lib/loop/probes";
import { homeView } from "./views";

const WS = "ws_astronom";

function run(id: string, goal: string, purpose: "standard" | "retest", status: "succeeded" | "running" = "succeeded") {
  return {
    id,
    workspaceId: WS,
    agentId: "agt_incident_commander",
    goal,
    status,
    budgetUsd: 0.25,
    costUsd: 0.03,
    mode: "live" as const,
    purpose,
    summary: "Done.",
    startedAt: new Date(),
    endedAt: status === "running" ? null : new Date(),
  };
}

describe("Home", () => {
  beforeEach(freshDb);

  it("leaves test runs off the finished and running lists but keeps real runs", async () => {
    await (await getDb()).insert(runs).values([
      run("run_real_done", "Summarise yesterday's incidents", "standard"),
      run("run_test_done", `${TEST_DATA_LABEL}\nTask: summarise`, "retest"),
      run("run_test_live", `${TEST_DATA_LABEL}\nTask: summarise`, "retest", "running"),
    ]);

    const home = await homeView(WS);
    const finished = home.finished.map((f) => f.id);
    expect(finished).toContain("run_real_done");
    expect(finished).not.toContain("run_test_done");
    expect(home.running.map((r) => r.id)).not.toContain("run_test_live");
    expect(home.finished.some((f) => f.name.includes("TEST DATA"))).toBe(false);
  });

  it("does not let a burst of test runs push real finished runs out of the window", async () => {
    await (await getDb()).insert(runs).values([
      run("run_real_done", "Summarise yesterday's incidents", "standard"),
      ...Array.from({ length: 80 }, (_, i) =>
        run(`run_test_${i}`, `${TEST_DATA_LABEL}\nTask ${i}`, "retest"),
      ),
    ]);
    // The real run is older than every test run, as when a security check has just finished.
    await (await getDb()).update(runs).set({ startedAt: new Date(Date.now() - 60_000) }).where(
      (await import("drizzle-orm")).eq(runs.id, "run_real_done"),
    );

    const home = await homeView(WS);
    expect(home.finished.map((f) => f.id)).toContain("run_real_done");
  });
});
