import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSandbox, formatTreeListing, stripSandboxPrefix, visibleSandboxEntry } from "./sandbox";

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
