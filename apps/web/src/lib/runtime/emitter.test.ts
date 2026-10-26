import { verifyChain } from "@agent-os/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db/client";
import { runs, workspaces } from "../db/schema";
import { getRunEvents } from "../queries";
import { RunLogger, runBus } from "./emitter";

describe("run event persistence", () => {
  beforeEach(async () => {
    delete (globalThis as { __agentOsDb?: unknown }).__agentOsDb;
    const db = getDb();
    await db.insert(workspaces).values({ id: "ws_emitter", name: "Emitter", slug: "emitter", createdAt: new Date() });
    await db.insert(runs).values({ id: "run_emitter", workspaceId: "ws_emitter", agentId: "agent_emitter", goal: "Check event persistence.", budgetUsd: 1, startedAt: new Date() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    runBus().removeAllListeners("run_emitter");
  });

  it("serializes concurrent writes and broadcasts only persisted events", async () => {
    const logger = await RunLogger.open("run_emitter");
    const persistedCounts: number[] = [];
    runBus().on("run_emitter", () => {
      const row = getDb().select().from(runs).where(eq(runs.id, "run_emitter")).get()!;
      persistedCounts.push(row.eventCount);
    });

    await Promise.all(["first", "second", "third"].map((message) =>
      logger.emit({ type: "log", level: "info", message }),
    ));

    const events = await getRunEvents("run_emitter");
    expect(events.map((event) => event.seq)).toEqual([0, 1, 2]);
    expect(verifyChain(events)).toMatchObject({ valid: true, checked: 3 });
    expect(persistedCounts).toEqual([1, 2, 3]);
  });

  it("rolls back a failed write without leaving an event or advancing the hash chain", async () => {
    const db = getDb();
    const logger = await RunLogger.open("run_emitter");
    const listener = vi.fn();
    runBus().on("run_emitter", listener);
    // Fail after the event insert, when the run's event count is updated.
    db.$client.exec(`CREATE TRIGGER fail_event_count BEFORE UPDATE OF event_count ON runs
      BEGIN SELECT RAISE(ABORT, 'event count failed'); END;`);

    await expect(logger.emit({ type: "log", level: "info", message: "failed" })).rejects.toThrow();
    expect(await getRunEvents("run_emitter")).toEqual([]);
    expect(logger.nextSeq).toBe(0);
    expect(listener).not.toHaveBeenCalled();

    db.$client.exec("DROP TRIGGER fail_event_count");
    await logger.emit({ type: "log", level: "info", message: "recovered" });
    const reopened = await RunLogger.open("run_emitter");
    await reopened.emit({ type: "log", level: "info", message: "after reopen" });

    const events = await getRunEvents("run_emitter");
    expect(events.map((event) => event.seq)).toEqual([0, 1]);
    expect(verifyChain(events)).toMatchObject({ valid: true, checked: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
