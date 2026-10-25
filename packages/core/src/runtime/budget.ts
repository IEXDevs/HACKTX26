/**
 * Budget ledger.
 *
 * Deterministic, synchronous, no I/O. The runtime asks the ledger "may I spend
 * this" before every model call and records actual usage afterwards. A hard
 * stop is a hard stop: the ledger never invents headroom, and the runtime turns
 * a `halted` result into a terminal run status.
 */
import type { Model } from "../protocol/models";

export type BudgetAction =
  | { kind: "allow" }
  | { kind: "warn"; spentUsd: number; limitUsd: number; threshold: number }
  | { kind: "halt"; spentUsd: number; limitUsd: number; reason: string };

export interface LedgerScope {
  /** Stable key, e.g. `run:01H...` or `agent:01H...`. */
  key: string;
  limitUsd: number;
  warnAt: number;
  hardStop: boolean;
}

export interface SpendRecord {
  scopeKey: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  at: number;
}

export class BudgetLedger {
  readonly #scopes = new Map<string, LedgerScope>();
  readonly #spent = new Map<string, number>();
  readonly #records: SpendRecord[] = [];
  readonly #warned = new Set<string>();

  constructor(
    scopes: readonly LedgerScope[] = [],
    private readonly now: () => number = Date.now,
  ) {
    for (const scope of scopes) this.open(scope);
  }

  open(scope: LedgerScope): void {
    this.#scopes.set(scope.key, scope);
    if (!this.#spent.has(scope.key)) this.#spent.set(scope.key, 0);
  }

  get spentUsd(): number {
    return this.#records.reduce((sum, r) => sum + r.costUsd, 0);
  }

  spentFor(key: string): number {
    return this.#spent.get(key) ?? 0;
  }

  records(): readonly SpendRecord[] {
    return this.#records;
  }

  /**
   * Pre-flight check. `projectedUsd` is the estimated cost of the call about to
   * happen. Returns the *strictest* outcome across every scope the run touches.
   */
  canSpend(projectedUsd: number, keys: readonly string[]): BudgetAction {
    let strictest: BudgetAction = { kind: "allow" };

    for (const key of keys) {
      const scope = this.#scopes.get(key);
      if (!scope) continue;
      const spent = this.spentFor(key);
      const after = spent + projectedUsd;

      if (after > scope.limitUsd) {
        if (scope.hardStop) {
          return {
            kind: "halt",
            spentUsd: spent,
            limitUsd: scope.limitUsd,
            reason: `Projected $${after.toFixed(4)} exceeds the $${scope.limitUsd.toFixed(2)} ceiling for ${key}.`,
          };
        }
        strictest = {
          kind: "warn",
          spentUsd: spent,
          limitUsd: scope.limitUsd,
          threshold: 1,
        };
        continue;
      }

      const ratio = after / Math.max(scope.limitUsd, 1e-9);
      if (ratio >= scope.warnAt && !this.#warned.has(`${key}:${scope.warnAt}`)) {
        this.#warned.add(`${key}:${scope.warnAt}`);
        if (strictest.kind === "allow") {
          strictest = {
            kind: "warn",
            spentUsd: spent,
            limitUsd: scope.limitUsd,
            threshold: scope.warnAt,
          };
        }
      }
    }

    return strictest;
  }

  /** Record actual usage. Returns the recorded spend row. */
  record(input: {
    model: Pick<Model, "id" | "inputPerMTok" | "outputPerMTok">;
    inputTokens: number;
    outputTokens: number;
    keys: readonly string[];
  }): SpendRecord {
    const costUsd =
      (input.inputTokens / 1_000_000) * input.model.inputPerMTok +
      (input.outputTokens / 1_000_000) * input.model.outputPerMTok;

    const record: SpendRecord = {
      scopeKey: input.keys[0] ?? "unscoped",
      modelId: input.model.id,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd,
      at: this.now(),
    };

    for (const key of input.keys) {
      this.#spent.set(key, this.spentFor(key) + costUsd);
    }
    this.#records.push(record);
    return record;
  }

  snapshot(): Array<{ key: string; spentUsd: number; limitUsd: number; utilization: number }> {
    return [...this.#scopes.values()].map((scope) => {
      const spent = this.spentFor(scope.key);
      return {
        key: scope.key,
        spentUsd: spent,
        limitUsd: scope.limitUsd,
        utilization: spent / Math.max(scope.limitUsd, 1e-9),
      };
    });
  }
}
