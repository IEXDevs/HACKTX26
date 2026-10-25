import { describe, expect, it } from "vitest";
import { appendEvent, canonicalJson, GENESIS_HASH, verifyChain } from "../src/runtime/hash";

describe("audit hash chain", () => {
  const build = () => {
    const a = appendEvent("run_1", 0, "2026-10-24T12:00:00.000Z", {
      type: "run.started",
      goal: "triage alerts",
      orchestratorAgentId: "a1",
      trigger: "manual",
      budgetUsd: 2.5,
      dataClass: "internal",
    }, GENESIS_HASH);
    const b = appendEvent("run_1", 1, "2026-10-24T12:00:01.000Z", {
      type: "log",
      level: "info",
      message: "hello",
    }, a.hash);
    return [a, b];
  };

  it("verifies an untouched chain", () => {
    const result = verifyChain(build());
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(2);
  });

  it("detects a mutated payload", () => {
    const events = build();
    const tampered = structuredClone(events);
    tampered[0]!.payload = { ...tampered[0]!.payload, goal: "exfiltrate" } as typeof tampered[0]["payload"];
    const result = verifyChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it("detects a dropped event", () => {
    const events = build();
    const result = verifyChain([events[1]!]);
    expect(result.valid).toBe(false);
  });

  it("canonicalises key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});
