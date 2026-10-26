import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { agents, approvals, auditLog, runEvents, runs } from "@/lib/db/schema";
import { seedDatabase } from "@/lib/db/seed";
import { RunLogger } from "./emitter";
import { insertHelperAgent } from "./helper-agents";
import { AgentLifecycle } from "./lifecycle";
import { liveRuns, reapStaleRuns, STALE_AFTER_MS } from "./reaper";

const WS = "ws_astronom";
const PARENT = "agt_incident_commander";

async function freshDb() {
  const g = globalThis as unknown as { __agentOsDb?: unknown };
  delete g.__agentOsDb;
  (await getDb());
  await seedDatabase();
}

/* ---------- Agents end when they and their delegates have no work ---------- */

describe("agent lifecycle", () => {
  it("ends a child first, then the parent once its own work is done", () => {
    const life = new AgentLifecycle();
    life.start("root", null);
    life.start("child", "root");
    expect(life.finish("child", "done")).toEqual(["child"]);
    expect(life.isTerminated("root")).toBe(false);
    expect(life.finish("root", "done")).toEqual(["root"]);
  });

  it("keeps an agent alive while anything below it still works", () => {
    const life = new AgentLifecycle();
    life.start("root", null);
    life.start("mid", "root");
    life.start("leaf", "mid");
    // The middle agent's own loop ended, but its delegate is still working.
    expect(life.finish("mid", "done")).toEqual([]);
    // When the leaf ends, the middle agent was only waiting on it, so it ends too.
    expect(life.finish("leaf", "done")).toEqual(["leaf", "mid"]);
    expect(life.isTerminated("root")).toBe(false);
  });

  it("restarts an agent that gets new work, and remembers a failure", () => {
    const life = new AgentLifecycle();
    life.start("root", null);
    life.start("helper", "root");
    life.finish("helper", "failed");
    life.start("helper", "root");
    expect(life.isTerminated("helper")).toBe(false);
    life.finish("helper", "done");
    expect(life.outcome("helper")).toBe("failed");
  });

  it("terminates everything still open when a run ends abruptly", () => {
    const life = new AgentLifecycle();
    life.start("root", null);
    life.start("child", "root");
    expect(life.terminateAll("failed").sort()).toEqual(["child", "root"]);
    expect(life.open()).toEqual([]);
  });
});

/* ---------- Concurrent runs creating the same helper ---------- */

describe("helper creation", () => {
  beforeEach(freshDb);

  const helper = (id: string, name = "Runbook Analyst", slug = "runbook-analyst") => ({
    id,
    workspaceId: WS,
    name,
    slug,
    role: "worker" as const,
    parentAgentId: PARENT,
    instructions: "Read the runbook and report.",
    modelPolicy: {
      mode: "auto" as const,
      pinnedModelId: null,
      costSensitivity: 0.7,
      latencySensitivity: 0.3,
      floorComplexity: "standard" as const,
      deniedModelIds: [],
    },
    status: "active" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it("gives two runs that create the same helper at once the same agent", async () => {
    const [a, b] = await Promise.all([
      insertHelperAgent(helper("agt_test_a")),
      insertHelperAgent(helper("agt_test_b")),
    ]);
    expect(a.row.id).toBe(b.row.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    const rows = await (await getDb()).select().from(agents).where(eq(agents.name, "Runbook Analyst"));
    expect(rows).toHaveLength(1);
  });

  it("picks a new slug when a different agent already holds it", async () => {
    await insertHelperAgent({ ...helper("agt_test_c"), parentAgentId: "agt_red_team" });
    const second = await insertHelperAgent(helper("agt_test_d"));
    expect(second.created).toBe(true);
    expect(second.row.slug).not.toBe("runbook-analyst");
    expect(second.row.slug.startsWith("runbook-analyst-")).toBe(true);
  });

  it("brings a retired helper back instead of creating a copy", async () => {
    const first = await insertHelperAgent(helper("agt_test_e"));
    await (await getDb()).update(agents).set({ status: "archived" }).where(eq(agents.id, first.row.id));
    const again = await insertHelperAgent(helper("agt_test_f"));
    expect(again).toMatchObject({ created: false, row: { id: first.row.id, status: "active" } });
  });
});

/* ---------- Runs whose process stopped ---------- */

describe("run reaper", () => {
  beforeEach(freshDb);

  async function activeRun(id: string, heartbeatAgoMs: number) {
    const at = new Date(Date.now() - heartbeatAgoMs);
    await (await getDb()).insert(runs).values({
      id,
      workspaceId: WS,
      agentId: PARENT,
      goal: "Check the checkout latency",
      status: "awaiting_approval",
      budgetUsd: 1,
      costUsd: 0.02,
      startedAt: at,
      heartbeatAt: at,
    });
    const logger = await RunLogger.open(id);
    await logger.emit({ type: "agent.spawned", agentId: PARENT, parentAgentId: null, name: "Incident Commander", role: "orchestrator", model: "muse-spark-1.3" }, PARENT);
    await (await getDb()).insert(approvals).values({
      id: `apr_${id}`,
      workspaceId: WS,
      runId: id,
      agentId: PARENT,
      resource: "shell.exec",
      scopes: ["execute"],
      risk: "high",
      reason: "test",
      status: "pending",
      requestedAt: at,
    });
  }

  it("closes a run whose heartbeat stopped, ends its agents, and expires its approvals", async () => {
    await activeRun("run_dead", STALE_AFTER_MS + 60_000);
    expect(await reapStaleRuns()).toContain("run_dead");

    const [run] = await (await getDb()).select().from(runs).where(eq(runs.id, "run_dead"));
    expect(run).toMatchObject({ status: "failed" });
    expect(run!.failureReason).toMatch(/server stopped/);
    const events = await (await getDb()).select().from(runEvents).where(eq(runEvents.runId, "run_dead"));
    const types = events.sort((x, y) => x.seq - y.seq).map((e) => e.payload);
    expect(types.at(-1)).toMatchObject({ type: "run.completed", status: "failed" });
    expect(types.some((p) => p.type === "agent.status" && p.status === "failed")).toBe(true);
    const [approval] = await (await getDb()).select().from(approvals).where(eq(approvals.id, "apr_run_dead"));
    expect(approval!.status).toBe("expired");
    const audits = await (await getDb()).select().from(auditLog).where(eq(auditLog.targetId, "run_dead"));
    expect(audits.map((a) => a.action)).toContain("run.reaped");

    // Reaping twice changes nothing.
    expect(await reapStaleRuns()).not.toContain("run_dead");
  });

  it("never reaps seeded replays", async () => {
    const reaped = await reapStaleRuns();
    expect(reaped.filter((id) => id.startsWith("run_0"))).toEqual([]);
    const [seeded] = await (await getDb()).select().from(runs).where(eq(runs.id, "run_04_contract"));
    expect(seeded!.status).toBe("awaiting_approval");
  });

  it("leaves runs with a fresh heartbeat, or running in this process, alone", async () => {
    await activeRun("run_fresh", 5_000);
    await activeRun("run_here", STALE_AFTER_MS + 60_000);
    liveRuns().add("run_here");
    try {
      const reaped = await reapStaleRuns();
      expect(reaped).not.toContain("run_fresh");
      expect(reaped).not.toContain("run_here");
    } finally {
      liveRuns().delete("run_here");
    }
  });
});
