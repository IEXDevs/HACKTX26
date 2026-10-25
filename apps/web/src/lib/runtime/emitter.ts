import { EventEmitter } from "node:events";
import { appendEvent, GENESIS_HASH, type RunEvent, type RunEventPayload } from "@agent-os/core";
import { getDb } from "@/lib/db/client";
import { runEvents, runs } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

const globalForBus = globalThis as unknown as { __agentOsBus?: EventEmitter };

export function runBus(): EventEmitter {
  if (!globalForBus.__agentOsBus) {
    const bus = new EventEmitter();
    bus.setMaxListeners(200);
    globalForBus.__agentOsBus = bus;
  }
  return globalForBus.__agentOsBus;
}

/**
 * The only writer of run events.
 *
 * Writes are serialised through a promise chain so `seq` is strictly ordered
 * even when several subagents emit concurrently, and each payload is linked to
 * the previous hash. The row is persisted before it is broadcast, so a
 * subscriber can never observe an event that a replay would not also produce.
 */
export class RunLogger {
  #seq = 0;
  #prevHash = GENESIS_HASH;
  #chain: Promise<unknown> = Promise.resolve();
  #count = 0;

  private constructor(readonly runId: string) {}

  static async open(runId: string): Promise<RunLogger> {
    const logger = new RunLogger(runId);
    const [last] = await getDb()
      .select({ seq: runEvents.seq, hash: runEvents.hash })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.seq))
      .limit(1);

    if (last) {
      logger.#seq = last.seq + 1;
      logger.#prevHash = last.hash;
      logger.#count = last.seq + 1;
    }
    return logger;
  }

  get nextSeq(): number {
    return this.#seq;
  }

  emit(payload: RunEventPayload, agentId?: string): Promise<RunEvent> {
    const task = this.#chain.then(async () => {
      const db = getDb();
      const ts = new Date().toISOString();
      const seq = this.#seq++;
      const event = appendEvent(this.runId, seq, ts, payload, this.#prevHash);
      this.#prevHash = event.hash;

      await db.insert(runEvents).values({
        id: event.id,
        runId: event.runId,
        seq: event.seq,
        ts: new Date(event.ts),
        type: payload.type,
        agentId: agentId ?? extractAgentId(payload),
        hash: event.hash,
        prevHash: event.prevHash,
        payload,
      });

      this.#count += 1;
      await db
        .update(runs)
        .set({ eventCount: this.#count })
        .where(eq(runs.id, this.runId));

      runBus().emit(this.runId, event);
      return event;
    });

    // Keep the chain alive even if one write rejects.
    this.#chain = task.catch(() => undefined);
    return task;
  }
}

function extractAgentId(payload: RunEventPayload): string | null {
  if ("agentId" in payload) {
    const value = (payload as { agentId?: unknown }).agentId;
    return typeof value === "string" ? value : null;
  }
  return null;
}
