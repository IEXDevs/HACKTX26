import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyContextDirective,
  isContextPath,
  isContextStub,
  parseContextDirectives,
  WorkspaceContextFile,
} from "./workspace-context";

describe("workspace CONTEXT.md", () => {
  it("recognises the shared context path aliases", () => {
    expect(isContextPath("CONTEXT.md")).toBe(true);
    expect(isContextPath("context.md")).toBe(true);
    expect(isContextPath("workspace/CONTEXT.md")).toBe(true);
    expect(isContextPath("services/checkout/pool.ts")).toBe(false);
  });

  it("parses include and remove instructions out of a goal", () => {
    const found = parseContextDirectives(
      "Ship the fix. Include in context: we use pnpm workspaces. Remove from context: the old Redis cluster.",
    );
    expect(found).toEqual([
      { op: "include", text: "we use pnpm workspaces" },
      { op: "remove", text: "the old Redis cluster" },
    ]);
  });

  it("appends operator notes and drops matching lines", () => {
    const withNote = applyContextDirective("# Workspace context\n\n## Operator notes\n(none)\n", {
      op: "include",
      text: "Postgres is the source of truth",
    });
    expect(withNote).toContain("Postgres is the source of truth");
    const removed = applyContextDirective(withNote, {
      op: "remove",
      text: "Postgres is the source of truth",
    });
    expect(removed).not.toContain("Postgres is the source of truth");
  });

  it("writes a stub on first ensure and treats it as a first-run file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "astronom-ctx-"));
    const file = new WorkspaceContextFile(root, "ws_test");
    const content = file.ensure();
    expect(isContextStub(content)).toBe(true);
    expect(file.promptBlock()).toMatch(/still a stub/i);
    file.write("# Workspace context\n\n## Tech stack\nNext.js 16, SQLite, Meta Muse models.\n");
    expect(isContextStub(file.read())).toBe(false);
    expect(file.promptBlock()).toContain("Next.js 16");
  });
});
