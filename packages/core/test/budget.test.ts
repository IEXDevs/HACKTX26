import { describe, expect, it } from "vitest";
import { BudgetLedger } from "../src/runtime/budget";

const model = {
  id: "test/model",
  inputPerMTok: 10,
  outputPerMTok: 30,
};

function ledger(limitUsd: number, hardStop = true) {
  return new BudgetLedger([
    { key: "run:1", limitUsd, warnAt: 0.8, hardStop },
    { key: "agent:a", limitUsd, warnAt: 0.8, hardStop },
  ]);
}

describe("BudgetLedger", () => {
  it("preserves earlier spend when a run resumes", () => {
    const l = ledger(1);
    l.restore("run:1", 0.9);
    expect(l.spentUsd).toBeCloseTo(0.9);
    expect(l.canSpend(0.2, ["run:1"]).kind).toBe("halt");
    l.restore("run:1", 0.9);
    expect(l.spentUsd).toBeCloseTo(0.9);
    expect(() => l.restore("run:1", -1)).toThrow();
  });
  it("allows spend under the ceiling", () => {
    const l = ledger(1);
    expect(l.canSpend(0.1, ["run:1", "agent:a"]).kind).toBe("allow");
  });

  it("warns once when crossing the threshold", () => {
    const l = ledger(1);
    l.record({ model, inputTokens: 90_000, outputTokens: 0, keys: ["run:1", "agent:a"] });
    // 0.9 USD spent of 1.00 -> next projection crosses 80%
    const first = l.canSpend(0.001, ["run:1", "agent:a"]);
    expect(first.kind).toBe("warn");
    const second = l.canSpend(0.001, ["run:1", "agent:a"]);
    expect(second.kind).toBe("allow");
  });

  it("halts when the projection exceeds a hard ceiling", () => {
    const l = ledger(0.5);
    l.record({ model, inputTokens: 40_000, outputTokens: 0, keys: ["run:1", "agent:a"] });
    const action = l.canSpend(0.2, ["run:1", "agent:a"]);
    expect(action.kind).toBe("halt");
    if (action.kind === "halt") {
      expect(action.spentUsd).toBeCloseTo(0.4);
    }
  });

  it("only warns when hardStop is disabled", () => {
    const l = ledger(0.5, false);
    l.record({ model, inputTokens: 40_000, outputTokens: 0, keys: ["run:1", "agent:a"] });
    expect(l.canSpend(0.4, ["run:1", "agent:a"]).kind).toBe("warn");
  });

  it("attributes spend across every scope the run touches", () => {
    const l = ledger(10);
    l.record({ model, inputTokens: 100_000, outputTokens: 10_000, keys: ["run:1", "agent:a"] });
    expect(l.spentFor("run:1")).toBeCloseTo(1.3);
    expect(l.spentFor("agent:a")).toBeCloseTo(1.3);
    expect(l.spentUsd).toBeCloseTo(1.3);
  });
});
