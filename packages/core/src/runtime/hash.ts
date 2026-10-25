import { createHash } from "node:crypto";
import type { RunEvent, RunEventPayload } from "../protocol/events";

export const GENESIS_HASH = "0".repeat(64);

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace. Two
 * semantically identical payloads always hash identically, regardless of the
 * order the producer happened to build them in.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] !== undefined) out[key] = sortValue(obj[key]);
    }
    return out;
  }
  return value;
}

export function hashPayload(prevHash: string, payload: RunEventPayload): string {
  return createHash("sha256")
    .update(prevHash)
    .update("\u0000")
    .update(canonicalJson(payload))
    .digest("hex");
}

export function appendEvent(
  runId: string,
  seq: number,
  ts: string,
  payload: RunEventPayload,
  prevHash: string,
): RunEvent {
  return {
    id: `${runId}:${seq.toString(36).padStart(4, "0")}`,
    runId,
    seq,
    ts,
    protocol: 1,
    payload,
    hash: hashPayload(prevHash, payload),
    prevHash,
  };
}

export interface ChainVerification {
  valid: boolean;
  brokenAt: number | null;
  checked: number;
}

/** Recompute the chain. Any mutation or reordering breaks it. */
export function verifyChain(events: readonly RunEvent[]): ChainVerification {
  let prev = GENESIS_HASH;
  for (const event of events) {
    if (event.prevHash !== prev) {
      return { valid: false, brokenAt: event.seq, checked: event.seq };
    }
    const expected = hashPayload(prev, event.payload);
    if (expected !== event.hash) {
      return { valid: false, brokenAt: event.seq, checked: event.seq };
    }
    prev = event.hash;
  }
  return { valid: true, brokenAt: null, checked: events.length };
}
