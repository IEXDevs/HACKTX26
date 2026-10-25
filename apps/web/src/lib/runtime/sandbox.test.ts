import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSandbox, formatTreeListing, stripSandboxPrefix } from "./sandbox";

const tmpRoots: string[] = [];

function sandbox(agentId = "agt_red_team"): AgentSandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "astronom-sandbox-"));
  tmpRoots.push(root);
  const box = new AgentSandbox(root, "ws_test", agentId);
  box.provision({
    agentName: "Red Team",
    role: "security",
    summary: "Probe the target.",
  });
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
  it("lists the sandbox root as . not the agent id", () => {
    const box = sandbox();
    const tree = box.tree();
    expect(tree.name).toBe("");
    expect(tree.path).toBe("");
    const listing = formatTreeListing(tree);
    expect(listing).toContain("entries under .");
    expect(listing).toContain("README.md");
    expect(listing).not.toContain("agt_red_team/");
  });

  it("reads README.md even when the model prefixes the agent id", () => {
    const box = sandbox();
    const content = box.read("agt_red_team/README.md");
    expect(content).toContain("Red Team");
    const tree = box.tree("agt_red_team");
    expect(tree.path).toBe("");
    expect(tree.children?.some((child) => child.name === "README.md")).toBe(true);
  });
});

describe("a new agent's sandbox", () => {
  it("holds only its README and an empty notes folder, no sample material", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-test-"));
    tmpRoots.push(root);
    const box = new AgentSandbox(root, "ws_test", "agt_test");
    box.provision({ agentName: "Resume Reviewer", role: "orchestrator", summary: "Reviews resumes." });
    const dir = path.join(root, "ws_test", "agt_test");
    const files = fs.readdirSync(dir, { recursive: true }).map(String).map((f) => f.replace(/\\/g, "/")).sort();
    expect(files).toEqual(["README.md", "notes", "notes/.keep"]);
  });
});
