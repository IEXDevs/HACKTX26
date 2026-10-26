/**
 * End-to-end smoke test against the real engine, real SQLite, and real
 * sandboxes. Run from apps/web: `pnpm exec tsx src/lib/runtime/__smoke.ts`.
 *
 * It dispatches three runs (incident, security, and a deliberately tiny budget)
 * and auto-approves anything the policy escalates, printing the resulting event
 * stream. This is the script used to prove the pipeline before the UI exists.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { seedDatabase } from "../db/seed";
import {
  approvals,
  runEvents,
  runs,
  securityFindings,
  workspaces,
} from "../db/schema";
import { createRun } from "./orchestrator";
import { AgentSandbox } from "./sandbox";
import { verifyChain, type RunEvent, type RunStatus } from "@agent-os/core";
import { env } from "../env";

const TERMINAL = new Set<RunStatus>(["succeeded", "failed", "halted", "cancelled"]);

async function waitForRun(runId: string, timeoutMs = 180_000): Promise<void> {
  const db = await getDb();
  const deadline = Date.now() + timeoutMs;
  let approvalsHandled = 0;

  while (Date.now() < deadline) {
    const pending = await db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, runId));

    for (const approval of pending) {
      if (approval.status !== "pending") continue;
      await db
        .update(approvals)
        .set({
          status: "approved",
          decidedBy: "smoke@local",
          note: "auto-approved by smoke test",
          resolvedAt: new Date(),
        })
        .where(eq(approvals.id, approval.id));
      approvalsHandled += 1;
      console.log(`  · approved ${approval.resource} (${approval.risk})`);
    }

    const [row] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (row && TERMINAL.has(row.status)) {
      console.log(
        `  · terminal: ${row.status} · $${row.costUsd.toFixed(4)} · ${row.eventCount} events · ${approvalsHandled} approvals`,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(`Run ${runId} did not terminate within ${timeoutMs}ms.`);
}

async function inspect(runId: string, workspaceId: string, agentIds: string[]) {
  const db = await getDb();
  const rows = await db.select().from(runEvents).where(eq(runEvents.runId, runId));
  const events: RunEvent[] = rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    seq: row.seq,
    ts: row.ts.toISOString(),
    protocol: 1,
    payload: row.payload,
    hash: row.hash,
    prevHash: row.prevHash,
  }));

  const chain = verifyChain(events);
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.payload.type, (counts.get(event.payload.type) ?? 0) + 1);
  }
  console.log(
    `  · chain ${chain.valid ? "valid" : `BROKEN at ${chain.brokenAt}`} over ${chain.checked} events`,
  );
  console.log(
    `  · event mix: ${[...counts.entries()].map(([type, n]) => `${type}×${n}`).join(", ")}`,
  );

  for (const agentId of agentIds) {
    const sandbox = new AgentSandbox(env.sandboxRoot, workspaceId, agentId);
    if (!sandbox.exists()) {
      console.log(`  · ${agentId}: no sandbox yet`);
      continue;
    }
    const files: string[] = [];
    const walk = (node: ReturnType<AgentSandbox["tree"]>) => {
      if (node.type === "file") files.push(node.path);
      for (const child of node.children ?? []) walk(child);
    };
    walk(sandbox.tree());
    console.log(`  · ${agentId} files (${files.length}): ${files.slice(0, 8).join(", ")}`);
  }
}

async function main() {
  // The smoke runs name sample agents, so it seeds the sample company. Boot does not.
  await seedDatabase();
  const db = await getDb();
  const [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) throw new Error("No workspace; seed failed.");

  console.log(`workspace: ${workspace.name} (${workspace.id})`);

  /* ------------------------------------------------------------- incident */
  console.log("\n[1] incident run");
  const incidentRun = await createRun({
    workspaceId: workspace.id,
    agentId: "agt_incident_commander",
    goal: "Checkout p95 latency jumped to 4.2s after the 14:05 deploy. Restore latency below 800ms.",
    dataClass: "internal",
    mode: "scripted",
  });
  await waitForRun(incidentRun);
  await inspect(incidentRun, workspace.id, [
    "agt_incident_commander",
    "agt_log_triage",
    "agt_patch_author",
    "agt_comms",
  ]);

  /* ------------------------------------------------------------- security */
  console.log("\n[2] red-team run");
  const securityRun = await createRun({
    workspaceId: workspace.id,
    agentId: "agt_red_team",
    goal: "Red-team Incident Commander: prompt injection, scope escalation, and credential exfiltration.",
    dataClass: "confidential",
    mode: "scripted",
  });
  await waitForRun(securityRun);
  await inspect(securityRun, workspace.id, ["agt_red_team"]);

  const findings = await db
    .select()
    .from(securityFindings)
    .where(eq(securityFindings.runId, securityRun));
  console.log(`  · findings recorded: ${findings.length}`);
  for (const finding of findings) {
    console.log(`    - [${finding.severity}] ${finding.title}`);
  }

  /* --------------------------------------------------------------- budget */
  console.log("\n[3] budget-halt run");
  const tinyRun = await createRun({
    workspaceId: workspace.id,
    agentId: "agt_incident_commander",
    goal: "Investigate checkout latency regression with a deliberately tiny ceiling.",
    dataClass: "internal",
    budgetUsd: 0.02,
    mode: "scripted",
  });
  await waitForRun(tinyRun);
  await inspect(tinyRun, workspace.id, []);

  const [tiny] = await db.select().from(runs).where(eq(runs.id, tinyRun)).limit(1);
  console.log(`  · failureReason: ${tiny?.failureReason ?? "(none)"}`);

  console.log("\nsmoke complete");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
