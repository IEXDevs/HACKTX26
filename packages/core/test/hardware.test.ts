import { describe, expect, it } from "vitest";
import { hardwareForComplexity } from "../src/protocol/models";

describe("hardwareForComplexity", () => {
  it("gives trivial work the smallest envelope", () => {
    const profile = hardwareForComplexity("trivial");
    expect(profile.tier).toBe("light");
    expect(profile.vcpu).toBeLessThanOrEqual(0.25);
    expect(profile.memoryMb).toBeLessThanOrEqual(256);
  });

  it("gives complex work a medium envelope", () => {
    const profile = hardwareForComplexity("complex");
    expect(profile.tier).toBe("medium");
    expect(profile.accelerator).toBeUndefined();
  });

  it("gives critical work the GPU tier", () => {
    const profile = hardwareForComplexity("critical");
    expect(profile.tier).toBe("heavy");
    expect(profile.accelerator).toContain("GPU");
  });
});
