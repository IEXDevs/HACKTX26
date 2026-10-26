import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSandbox, formatTreeListing, stripSandboxPrefix, visibleSandboxEntry } from "./sandbox";
import { SandboxViolation } from "@agent-os/core";

const tmpRoots: string[] = [];

function sandbox(agentId = "agt_red_team"): AgentSandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "astronom-sandbox-"));
  tmpRoots.push(root);
  const box = new AgentSandbox(root, "ws_test", agentId);
  box.provision();
  return box;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("stripSandboxPrefix", () => {
  it("drops a leading agent id so models can retry a prefixed path", () => {
    expect(stripSandboxPrefix("agt_red_team/README.md", "agt_red_team")).toBe("README.md");
    expect(stripSandboxPrefix("agt_red_team", "agt_red_team")).toBe(".");
    expect(stripSandboxPrefix("agt_red_team/", "agt_red_team")).toBe(".");
    expect(stripSandboxPrefix("README.md", "agt_red_team")).toBe("README.md");
  });
});

describe("sandbox listing", () => {
  it("rejects traversal and symlinks to files outside the sandbox", () => {
    const box = sandbox();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "astronom-outside-"));
    tmpRoots.push(outside);
    fs.writeFileSync(path.join(outside, "private.txt"), "outside data");
    fs.symlinkSync(outside, path.join(box.root, "escape"), process.platform === "win32" ? "junction" : "dir");
    expect(() => box.read("../private.txt")).toThrow(SandboxViolation);
    expect(() => box.read("escape/private.txt")).toThrow(SandboxViolation);
    expect(() => box.write("escape/new/file.txt", "blocked")).toThrow(SandboxViolation);
    expect(() => box.remove("escape/private.txt")).toThrow(SandboxViolation);
    expect(fs.readFileSync(path.join(outside, "private.txt"), "utf8")).toBe("outside data");
    expect(fs.existsSync(path.join(outside, "new"))).toBe(false);
  });

  it("allows a symlink that stays inside the sandbox", () => {
    const box = sandbox();
    box.write("notes/result.txt", "safe");
    fs.symlinkSync(path.join(box.root, "notes"), path.join(box.root, "linked"), process.platform === "win32" ? "junction" : "dir");
    expect(box.read("linked/result.txt")).toBe("safe");
  });

  it("rejects malformed agent ids and deletion of the sandbox root", () => {
    expect(() => new AgentSandbox(os.tmpdir(), "ws", "../escape")).toThrow(SandboxViolation);
    expect(() => sandbox().remove(".")).toThrow(SandboxViolation);
  });

  it("starts empty and lists the root as . not the agent id", () => {
    const box = sandbox();
    const tree = box.tree();
    expect(tree.name).toBe("");
    expect(tree.path).toBe("");
    expect(tree.children ?? []).toEqual([]);
    const listing = formatTreeListing(tree);
    expect(listing).toContain("entries under .");
    expect(listing).not.toContain("README.md");
    expect(listing).not.toContain("agt_red_team/");
  });

  it("reads a file the agent wrote even when the model prefixes the agent id", () => {
    const box = sandbox();
    box.write("notes/hello.md", "# Red Team\n");
    const content = box.read("agt_red_team/notes/hello.md");
    expect(content).toContain("Red Team");
    const tree = box.tree("agt_red_team");
    expect(tree.path).toBe("");
    expect(tree.children?.some((child) => child.name === "notes")).toBe(true);
  });

  it("removes the old canned checkout tree", () => {
    const box = sandbox();
    box.write(
      "README.md",
      "# Demo\n\nThis directory is the agent's own filesystem. Paths outside it are unreachable.\n",
    );
    box.write("package.json", JSON.stringify({ name: "checkout-sandbox", private: true }));
    box.write("telemetry/deploy-log.json", JSON.stringify({ sha: "9f2c1ab", config: { POOL_MAX: "10" } }));
    box.write("services/checkout/pool.ts", "// Connection pool for the checkout service.\nexport const POOL_MAX = 10;\n");
    box.write("checkout.test.js", 'test("pool ceiling is restored to 40", () => {});\n');
    box.write("notes/.keep", "");
    box.provision();
    const listing = formatTreeListing(box.tree());
    expect(listing).not.toContain("README.md");
    expect(listing).not.toContain("checkout");
    expect(listing).not.toContain("deploy-log");
  });

  it("shows a GitHub checkout and hides env files", () => {
    expect(visibleSandboxEntry(".github")).toBe(true);
    expect(visibleSandboxEntry(".gitignore")).toBe(true);
    expect(visibleSandboxEntry(".env.local")).toBe(false);
    expect(visibleSandboxEntry(".github-checkout.json")).toBe(false);
    const box = sandbox();
    box.write("repo/src/app.ts", "export {}\n");
    box.write(".github-checkout.json", "{}");
    const listing = formatTreeListing(box.tree());
    expect(listing).toContain("app.ts");
    expect(listing).not.toContain(".github-checkout.json");
  });
});
