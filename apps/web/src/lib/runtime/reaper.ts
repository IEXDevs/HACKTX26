/**
 * Run reaper. A run executes inside one server process and writes a heartbeat
 * while it does. If that process stops (a restart, a crash, a quit app), the
 * heartbeat stops and the run would stay "running" forever. The reaper closes
 * such runs: it marks them failed, ends their agents, records the reason in
 * the event log, and expires their pending approvals.
 */
import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { approvals, auditLog, runEvents, runs } from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { RunLogger } from "./emitter";

export const HEARTBEAT_MS = 15_000;
export const STALE_AFTER_MS = 90_000;
const SWEEP_MS = 60_000;
const ACTIVE = ["queued", "running", "awaiting_approval"] as const;
const REASON = "The server stopped while this run was in progress, so it did not finish.";

/** Runs this process is executing. These are never reaped here. */
export function liveRuns(): Set<string> {
  const g = globalThis as unknown as { __agentOsLiveRuns?: Set<string> };
  g.__agentOsLiveRuns ??= new Set<string>();
  return g.__agentOsLiveRuns;
}

/** Operator force-stop. The engine checks this between steps. */
export function cancelledRuns(): Set<string> {
  const g = globalThis as unknown as { __agentOsCancelledRuns?: Set<string> };
  g.__agentOsCancelledRuns ??= new Set<string>();
  return g.__agentOsCancelledRuns;
}

/** Agents that spawned in a run but never reported a final status. */
async function openAgents(runId: string): Promise<string[]> {
  const rows = await (await getDb())
    .select({ type: runEvents.type, payload: runEvents.payload })
    .from(runEvents)
    .where(eq(runEvents.runId, runId));
  const open = new Set<string>();
  for (const { payload } of rows) {
    if (payload.type === "agent.spawned") open.add(payload.agentId);
    if (payload.type === "agent.status" && (payload.status === "done" || payload.status === "failed")) {
      open.delete(payload.agentId);
    }
  }
  return [...open];
}

/** Close every active run whose heartbeat stopped. Returns the run ids it closed. */
export async function reapStaleRuns(now = Date.now()): Promise<string[]> {
  const db = await getDb();
  const cutoff = new Date(now - STALE_AFTER_MS);
  const candidates = await db
    .select()
    .from(runs)
    .where(
      and(
        inArray(runs.status, [...ACTIVE]),
        // Replays are recorded fixtures: no process ever runs them.
        ne(runs.mode, "replay"),
        or(lt(runs.heartbeatAt, cutoff), and(isNull(runs.heartbeatAt), lt(runs.startedAt, cutoff))),
      ),
    );

  const reaped: string[] = [];
  for (const run of candidates) {
    if (liveRuns().has(run.id)) continue;
    // Claim the run first, so two reapers never close it twice.
    const claimed = await db
      .update(runs)
      .set({ status: "failed", failureReason: REASON, summary: "Run stopped before it could complete.", endedAt: new Date(now) })
      .where(and(eq(runs.id, run.id), inArray(runs.status, [...ACTIVE])))
      .returning({ id: runs.id });
    if (claimed.length === 0) continue;

    const logger = await RunLogger.open(run.id);
    for (const agentId of await openAgents(run.id)) {
      await logger.emit({ type: "agent.status", agentId, status: "failed" }, agentId);
    }
    await logger.emit({ type: "log", level: "error", message: REASON, agentId: run.agentId }, run.agentId);
    await logger.emit({
      type: "run.completed",
      status: "failed",
      summary: "Run stopped before it could complete.",
      reason: REASON,
      totalCostUsd: run.costUsd,
      durationMs: Math.max(1, now - run.startedAt.getTime()),
    });
    await db.update(runs).set({ eventCount: logger.nextSeq }).where(eq(runs.id, run.id));

    await db
      .update(approvals)
      .set({ status: "expired", decidedBy: "system", resolvedAt: new Date(now), note: REASON })
      .where(and(eq(approvals.runId, run.id), eq(approvals.status, "pending")));

    await db.insert(auditLog).values({
      id: newId("aud"),
      workspaceId: run.workspaceId,
      actor: "system",
      action: "run.reaped",
      targetType: "run",
      targetId: run.id,
      detail: { previousStatus: run.status, lastHeartbeat: run.heartbeatAt?.toISOString() ?? null },
      at: new Date(now),
    });

    if (run.purpose === "retest") {
      const { noteRunFinished } = await import("@/lib/loop/cases");
      await noteRunFinished(run.id);
    }
    reaped.push(run.id);
  }
  return reaped;
}

/** Sweep once at boot, then every minute. Safe to call more than once. */
export function startRunReaper(): void {
  const g = globalThis as unknown as { __agentOsReaper?: NodeJS.Timeout };
  if (g.__agentOsReaper) return;
  const sweep = () =>
    reapStaleRuns().catch((error) => {
       
      console.error("[reaper] sweep failed", error);
    });
  void sweep();
  g.__agentOsReaper = setInterval(sweep, SWEEP_MS);
  g.__agentOsReaper.unref?.();
}
