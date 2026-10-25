import { describe, expect, it } from "vitest";
import { isInside, resolveInside, SandboxViolation } from "../src/runtime/sandbox";

const root = process.platform === "win32" ? "C:\\sandbox\\agent" : "/sandbox/agent";

describe("agent filesystem sandbox", () => {
  it("resolves a normal relative path", () => {
    const resolved = resolveInside(root, "notes/todo.md");
    expect(resolved).toContain("todo.md");
    expect(isInside(root, resolved)).toBe(true);
  });

  it("rejects traversal", () => {
    expect(() => resolveInside(root, "../../etc/passwd")).toThrow(SandboxViolation);
    expect(() => resolveInside(root, "a/../../../b")).toThrow(SandboxViolation);
  });

  it("rejects absolute paths", () => {
    expect(() => resolveInside(root, "/etc/passwd")).toThrow(SandboxViolation);
    expect(() => resolveInside(root, "C:\\Windows\\System32")).toThrow(SandboxViolation);
  });

  it("rejects null bytes", () => {
    expect(() => resolveInside(root, "a\u0000b")).toThrow(SandboxViolation);
  });

  it("allows nested paths that stay inside", () => {
    expect(() => resolveInside(root, "src/deep/nested/file.ts")).not.toThrow();
  });
});
