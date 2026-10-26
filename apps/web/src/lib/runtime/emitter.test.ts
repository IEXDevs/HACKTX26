import { verifyChain } from "@agent-os/core";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db/client";
import { runs, workspaces } from "../db/schema";
import { getRunEvents } from "../queries";
import { RunLogger, runBus } from "./emitter";

describe("run event persistence", () => {
  beforeEach(async () => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    const db = await getDb();
    await db.insert(workspaces).values({ id: "ws_emitter", name: "Emitter", slug: "emitter", createdAt: new Date() });
    await db.insert(runs).values({ id: "run_emitter", workspaceId: "ws_emitter", agentId: "agent_emitter", goal: "Check event persistence.", budgetUsd: 1, startedAt: new Date() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    runBus().removeAllListeners("run_emitter");
  });

  it("serializes concurrent writes and broadcasts only persisted events", async () => {
    const logger = await RunLogger.open("run_emitter");
    const persistedCounts: { seq: number; count: number }[] = [];
    const reads: Promise<void>[] = [];
    runBus().on("run_emitter", (event) => {
      reads.push((async () => {
        const [row] = await (await getDb()).select().from(runs).where(eq(runs.id, "run_emitter"));
        persistedCounts.push({ seq: event.seq, count: row!.eventCount });
      })());
    });

    await Promise.all(["first", "second", "third"].map((message) =>
      logger.emit({ type: "log", level: "info", message }),
    ));
    await Promise.all(reads);

    const events = await getRunEvents("run_emitter");
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2]);
    expect(verifyChain(events)).toMatchObject({ valid: true, checked: 3 });
    expect(persistedCounts).toHaveLength(3);
    expect(persistedCounts.every(({ seq, count }) => count >= seq + 1)).toBe(true);
  });

  it("keeps one hash chain when two logger instances write to the same run", async () => {
    const first = await RunLogger.open("run_emitter");
    const second = await RunLogger.open("run_emitter");
    await Promise.all([
      first.emit({ type: "log", level: "info", message: "first process" }),
      second.emit({ type: "log", level: "info", message: "second process" }),
    ]);
    const events = await getRunEvents("run_emitter");
    expect(events.map((event) => event.seq)).toEqual([0, 1]);
    expect(verifyChain(events)).toMatchObject({ valid: true, checked: 2 });
  });

  it("rolls back a failed write without leaving an event or advancing the hash chain", async () => {
    const db = await getDb();
    const logger = await RunLogger.open("run_emitter");
    const listener = vi.fn();
    runBus().on("run_emitter", listener);
    // Fail after the event insert, when the run's event count is updated.
    await db.execute(sql`alter table astronom.runs add constraint fail_event_count check (event_count = 0)`);

    await expect(logger.emit({ type: "log", level: "info", message: "failed" })).rejects.toThrow();
    expect(await getRunEvents("run_emitter")).toEqual([]);
    expect(logger.nextSeq).toBe(0);
    expect(listener).not.toHaveBeenCalled();

    await db.execute(sql`alter table astronom.runs drop constraint fail_event_count`);
    await logger.emit({ type: "log", level: "info", message: "recovered" });
    const reopened = await RunLogger.open("run_emitter");
    await reopened.emit({ type: "log", level: "info", message: "after reopen" });

    const events = await getRunEvents("run_emitter");
    expect(events.map((event) => event.seq)).toEqual([0, 1]);
    expect(verifyChain(events)).toMatchObject({ valid: true, checked: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
