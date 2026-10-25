import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureGithubCheckout, pushGithubFile, type GithubExecutor } from "./github-sync";
import { AgentSandbox } from "./runtime/sandbox";

const tmpRoots: string[] = [];

function fakeGithub(files: Record<string, string>): GithubExecutor {
  return async ({ action, arguments: args }) => {
    if (action.includes("GET_A_REPOSITORY") || action === "GITHUB_GET_REPOSITORY") {
      return { ok: true, data: { default_branch: "main", full_name: "acme/checkout" } };
    }
    if (action.includes("GET_A_TREE") || action === "GITHUB_GET_TREE") {
      return {
        ok: true,
        data: {
          sha: "commit1",
          tree: Object.entries(files).map(([filePath, body]) => ({
            path: filePath,
            type: "blob",
            sha: `sha-${filePath}`,
            size: body.length,
          })),
        },
      };
    }
    if (action.includes("GET_REPOSITORY_CONTENT") || action.includes("GET_FILE")) {
      const filePath = String(args?.path ?? "");
      const body = files[filePath];
      if (!body) return { ok: false, data: null, error: "missing" };
      return {
        ok: true,
        data: {
          encoding: "base64",
          sha: `sha-${filePath}`,
          content: Buffer.from(body, "utf8").toString("base64"),
        },
      };
    }
    if (action.includes("CREATE_OR_UPDATE")) {
      return { ok: true, data: { sha: "sha-new", content: { sha: "sha-new" } } };
    }
    return { ok: false, data: null, error: action };
  };
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("GitHub checkout", () => {
  it("mirrors a repo into repo/ and skips a second sync of the same commit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "astronom-gh-"));
    tmpRoots.push(root);
    const sandbox = new AgentSandbox(root, "ws_test", "agt_one");
    sandbox.provision();
    const exec = fakeGithub({
      "README.md": "# Checkout\n",
      "src/app.ts": "export const n = 1;\n",
      "node_modules/left-pad/index.js": "module.exports = 1;\n",
    });
    const working = { repo: "acme/checkout", owner: "acme", name: "checkout", branch: "main" };
    const first = await ensureGithubCheckout({
      sandbox,
      workspaceId: "ws_test",
      userId: "local:test",
      exec,
      working,
    });
    expect(first.synced).toBe(true);
    expect(first.skipped).toBe(false);
    expect(sandbox.read("repo/README.md")).toContain("Checkout");
    expect(sandbox.read("repo/src/app.ts")).toContain("export const n");
    expect(() => sandbox.read("repo/node_modules/left-pad/index.js")).toThrow();

    const second = await ensureGithubCheckout({
      sandbox,
      workspaceId: "ws_test",
      userId: "local:test",
      exec,
      working,
    });
    expect(second.skipped).toBe(true);
  });

  it("pushes a checkout file back through the GitHub executor", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "astronom-gh-"));
    tmpRoots.push(root);
    const pushed: Record<string, unknown>[] = [];
    const exec: GithubExecutor = async (input) => {
      if (input.action.includes("CREATE_OR_UPDATE")) {
        pushed.push(input.arguments ?? {});
        return { ok: true, data: { sha: "sha-2" } };
      }
      return fakeGithub({ "src/app.ts": "export const n = 1;\n" })(input);
    };
    const result = await pushGithubFile({
      workspaceId: "ws_test",
      userId: "local:test",
      sandboxPath: "repo/src/app.ts",
      content: "export const n = 2;\n",
      exec,
      working: { repo: "acme/checkout", owner: "acme", name: "checkout", branch: "main" },
      sandboxRoot: root,
    });
    expect(result.ok).toBe(true);
    expect(pushed[0]).toMatchObject({ owner: "acme", repo: "checkout", path: "src/app.ts" });
  });
});
