import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, routeModel } from "../src/protocol/models";

describe("routeModel", () => {
  it("routes a trivial task to a cheap model", () => {
    const result = routeModel({
      complexity: "trivial",
      dataClass: "public",
      estimatedInputTokens: 800,
      estimatedOutputTokens: 200,
    });
    expect(["fast", "local", "balanced"]).toContain(
      MODEL_CATALOG.find((m) => m.id === result.chosenModel)?.tier,
    );
    expect(result.estimatedCostUsd).toBeLessThan(0.01);
  });

  it("does not route restricted data to a third-party model", () => {
    const result = routeModel({
      complexity: "standard",
      dataClass: "restricted",
      estimatedInputTokens: 2000,
      estimatedOutputTokens: 500,
    });
    const model = MODEL_CATALOG.find((m) => m.id === result.chosenModel);
    expect(model?.selfHosted).toBe(true);
  });

  it("forces a frontier model for a critical task", () => {
    const result = routeModel({
      complexity: "critical",
      dataClass: "internal",
      estimatedInputTokens: 2000,
      estimatedOutputTokens: 800,
    });
    const model = MODEL_CATALOG.find((m) => m.id === result.chosenModel);
    expect(model?.tier).toBe("frontier");
  });

  it("reports why models were excluded", () => {
    const result = routeModel({
      complexity: "complex",
      dataClass: "confidential",
      estimatedInputTokens: 4000,
      estimatedOutputTokens: 1000,
    });
    const rejected = result.candidates.filter((c) => c.rejectedReason);
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.some((c) => c.rejectedReason?.includes("data"))).toBe(true);
  });

  it("honours an explicit pin and flags data-class violations", () => {
    const result = routeModel({
      complexity: "trivial",
      dataClass: "restricted",
      estimatedInputTokens: 100,
      estimatedOutputTokens: 50,
      pinnedModelId: "anthropic/claude-haiku-4-5",
    });
    expect(result.chosenModel).toBe("anthropic/claude-haiku-4-5");
    expect(result.reason).toContain("WARNING");
  });

  it("respects the org deny list", () => {
    const result = routeModel({
      complexity: "standard",
      dataClass: "internal",
      estimatedInputTokens: 1200,
      estimatedOutputTokens: 300,
      deniedModelIds: ["selfhost/llama-4-70b", "selfhost/qwen-3-coder-32b"],
    });
    expect(result.chosenModel.startsWith("selfhost/")).toBe(false);
  });

  it("fails loudly when nothing satisfies policy", () => {
    expect(() =>
      routeModel({
        complexity: "critical",
        dataClass: "restricted",
        estimatedInputTokens: 10_000,
        estimatedOutputTokens: 2000,
        deniedModelIds: ["selfhost/llama-4-70b", "selfhost/qwen-3-coder-32b"],
      }),
    ).toThrow(/No model satisfies/);
  });
});
