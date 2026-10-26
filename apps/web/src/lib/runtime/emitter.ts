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
 * A run row lock orders writes across web processes. The local promise chain
 * also preserves each caller's order. Each payload links to the previous hash.
 * The row is persisted before it is broadcast, so a
 * subscriber can never observe an event that a replay would not also produce.
 */
export class RunLogger {
  #seq = 0;
  #chain: Promise<unknown> = Promise.resolve();

  private constructor(readonly runId: string) {}

  static async open(runId: string): Promise<RunLogger> {
    const logger = new RunLogger(runId);
    const [last] = await (await getDb())
      .select({ seq: runEvents.seq })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.seq))
      .limit(1);

    if (last) {
      logger.#seq = last.seq + 1;
    }
    return logger;
  }

  get nextSeq(): number {
    return this.#seq;
  }

  emit(payload: RunEventPayload, agentId?: string): Promise<RunEvent> {
    const task = this.#chain.then(async () => {
      const db = await getDb();
      // Commit both rows before advancing the in-memory chain or notifying readers.
      const event = await db.transaction(async (tx) => {
        const [run] = await tx.select({ id: runs.id }).from(runs)
          .where(eq(runs.id, this.runId)).for("update");
        if (!run) throw new Error("Cannot append an event to a missing run.");
        const [last] = await tx.select({ seq: runEvents.seq, hash: runEvents.hash })
          .from(runEvents).where(eq(runEvents.runId, this.runId))
          .orderBy(desc(runEvents.seq)).limit(1);
        const event = appendEvent(this.runId, (last?.seq ?? -1) + 1,
          new Date().toISOString(), payload, last?.hash ?? GENESIS_HASH);
        await tx.insert(runEvents).values({
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
        await tx.update(runs)
          .set({ eventCount: event.seq + 1 })
          .where(eq(runs.id, this.runId));
        return event;
      });

      this.#seq = event.seq + 1;

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
