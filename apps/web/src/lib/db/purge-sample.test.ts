import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "./client";
import {
  agents,
  approvals,
  auditLog,
  budgetPolicies,
  connectors,
  credentials,
  evalRuns,
  evalSuites,
  memories,
  promptBlocks,
  runEvents,
  runs,
  securityFindings,
  taskLog,
  templates,
  triggers,
  users,
  workspaces,
} from "./schema";
import { purgeSample } from "./purge-sample";
import { seedDatabase, seedPlatform } from "./seed";

const TABLES = {
  workspaces,
  users,
  promptBlocks,
  agents,
  templates,
  connectors,
  credentials,
  runs,
  runEvents,
  taskLog,
  approvals,
  memories,
  securityFindings,
  evalSuites,
  evalRuns,
  triggers,
  budgetPolicies,
  auditLog,
};

async function freshDb(seed: () => Promise<void>) {
  const g = globalThis as unknown as { __agentOsDb?: unknown };
  delete g.__agentOsDb;
  const db = getDb();
  await seed();
  return db;
}

async function idsOf(db: ReturnType<typeof getDb>) {
  const out: Record<string, string[]> = {};
  for (const [name, table] of Object.entries(TABLES)) {
    const rows = (await db.select().from(table)) as Array<{ id: string }>;
    out[name] = rows.map((row) => row.id).sort();
  }
  return out;
}

describe("purging the sample company", () => {
  let platformIds: Record<string, string[]>;

  beforeEach(async () => {
    platformIds = await idsOf(await freshDb(seedPlatform));
  });

  it("leaves exactly the platform seed behind", async () => {
    const db = await freshDb(seedDatabase);
    const report = purgeSample(db.$client, { apply: true });
    expect(report.applied).toBe(true);
    expect(await idsOf(db)).toEqual(platformIds);
  });

  it("changes nothing on a dry run", async () => {
    const db = await freshDb(seedDatabase);
    const before = await idsOf(db);
    const report = purgeSample(db.$client, { apply: false });
    expect(report.removed.agents).toBeGreaterThan(0);
    expect(await idsOf(db)).toEqual(before);
  });

  it("keeps what people made, and removes what the sample agents spawned", async () => {
    const db = await freshDb(seedDatabase);
    const now = new Date();
    const base = {
      workspaceId: "ws_astronom",
      summary: "",
      instructions: "x",
      inheritedPromptBlockIds: [],
      modelPolicy: {
        mode: "auto" as const,
        pinnedModelId: null,
        costSensitivity: 0.5,
        latencySensitivity: 0.5,
        floorComplexity: "standard" as const,
        deniedModelIds: [],
      },
      grants: [],
      allowedTools: [],
      complexity: "standard" as const,
      maxSteps: 8,
      dataClass: "internal" as const,
      status: "active" as const,
      version: 1,
      templateId: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(agents).values([
      { ...base, id: "agt_mine", name: "Mine", slug: "mine", role: "orchestrator", parentAgentId: null },
      { ...base, id: "agt_mine_worker", name: "Mine worker", slug: "mine-worker", role: "worker", parentAgentId: "agt_mine" },
      // Spawned at run time under a sample agent.
      { ...base, id: "agt_spawned", name: "Spawned", slug: "spawned", role: "worker", parentAgentId: "agt_incident_commander" },
    ]);
    await db.insert(runs).values([
      { id: "run_mine", workspaceId: "ws_astronom", agentId: "agt_mine", goal: "real", status: "succeeded", budgetUsd: 1, costUsd: 0.1, mode: "live", startedAt: now },
      { id: "run_on_sample", workspaceId: "ws_astronom", agentId: "agt_incident_commander", goal: "live", status: "succeeded", budgetUsd: 1, costUsd: 0.2, mode: "live", startedAt: now },
    ]);

    const dry = purgeSample(db.$client, { apply: false });
    expect(dry.runs.live).toBe(1);
    expect(dry.runs.liveCostUsd).toBeCloseTo(0.2);

    purgeSample(db.$client, { apply: true });

    const agentIds = (await db.select().from(agents)).map((a) => a.id);
    expect(agentIds).toContain("agt_mine");
    expect(agentIds).toContain("agt_mine_worker");
    expect(agentIds).not.toContain("agt_spawned");
    expect(agentIds).not.toContain("agt_incident_commander");
    const runIds = (await db.select().from(runs)).map((r) => r.id);
    expect(runIds).toEqual(["run_mine"]);
    expect(await db.select().from(securityFindings)).toHaveLength(0);
  });
});
