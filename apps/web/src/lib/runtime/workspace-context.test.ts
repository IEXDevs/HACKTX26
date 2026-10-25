import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upsertConnectedToolsSection, WorkspaceContextFile } from "./workspace-context";

describe("connected tools section", () => {
  it("appends a marked block the first time", () => {
    const next = upsertConnectedToolsSection("# Workspace\n", "## Connected tools\n- GitHub");
    expect(next).toContain("<!-- astronom-connectors:start -->");
    expect(next).toContain("- GitHub");
  });

  it("replaces an existing block without duplicating it", () => {
    const first = upsertConnectedToolsSection("# Workspace\n", "## Connected tools\n- GitHub");
    const second = upsertConnectedToolsSection(first, "## Connected tools\n- Slack");
    expect(second).toContain("- Slack");
    expect(second).not.toContain("- GitHub");
    expect(second.split("astronom-connectors:start").length).toBe(2);
  });
});

describe("promptBlock", () => {
  it("does not tell a read-only agent to call context.write", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "astronom-context-"));
    try {
      const file = new WorkspaceContextFile(root, "ws_test");
      const block = file.promptBlock({ canWrite: false });
      expect(block).toContain("You cannot call context.write");
      expect(block).not.toContain("write a first draft with context.write");
      const writer = file.promptBlock({ canWrite: true });
      expect(writer).toContain("write a first draft with context.write");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
