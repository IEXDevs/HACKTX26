import { describe, expect, it } from "vitest";
import { clipText, contentHash, sanitizeMessages } from "./observability";

describe("observability sanitization", () => {
  it("redacts tokens and clips long tool output", () => {
    const messages = sanitizeMessages([
      { role: "system", content: "You are a reviewer." },
      { role: "user", content: "Use Bearer sk-abcdefghijklmnopqrstuvwxyz012345" },
      { role: "tool", content: `LLM_FAKE_TEST_TOKEN ${"secret-file-body ".repeat(80)}` },
    ]);
    expect(messages[1]?.content).toContain("[redacted");
    expect(messages[2]?.content.length).toBeLessThan(500);
    expect(messages[2]?.content).toContain("[redacted-token]");
    expect(messages[2]?.chars).toBeGreaterThan(messages[2]!.content.length);
  });

  it("hashes the raw prompt so two identical turns match", () => {
    const messages = [{ content: "hello" }];
    expect(contentHash(messages, "world")).toBe(contentHash(messages, "world"));
    expect(contentHash(messages, "world")).not.toBe(contentHash(messages, "other"));
  });

  it("marks clipped text with the dropped length", () => {
    expect(clipText("abcdefghij", 4)).toBe("abcd…[+6 chars]");
  });
});
