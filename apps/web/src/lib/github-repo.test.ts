import { describe, expect, it } from "vitest";
import {
  collectDirEntries,
  collectGithubRepos,
  collectGithubTree,
  decodeGithubFile,
  githubPathFromSandbox,
  isGithubSandboxPath,
  isGithubTextFile,
  parseRepoRef,
  selectGithubFiles,
  shouldSkipGithubPath,
} from "./github-repo";

describe("parseRepoRef", () => {
  it("accepts owner/name, URLs, and a branch", () => {
    expect(parseRepoRef("acme/checkout")).toEqual({
      repo: "acme/checkout",
      owner: "acme",
      name: "checkout",
      branch: "main",
    });
    expect(parseRepoRef("https://github.com/acme/checkout.git", "release")).toMatchObject({
      repo: "acme/checkout",
      branch: "release",
    });
    expect(parseRepoRef("not-a-repo")).toBeNull();
  });

  it("parses ssh, www, query, hash, and tree/blob links", () => {
    expect(parseRepoRef("git@github.com:acme/checkout.git")).toMatchObject({ repo: "acme/checkout" });
    expect(parseRepoRef("ssh://git@github.com/acme/checkout.git")).toMatchObject({ repo: "acme/checkout" });
    expect(parseRepoRef("https://www.github.com/acme/checkout")).toMatchObject({ repo: "acme/checkout" });
    expect(parseRepoRef("https://github.com/acme/checkout.git?tab=readme-ov-file#file")).toMatchObject({
      repo: "acme/checkout",
    });
    expect(parseRepoRef("https://github.com/acme/checkout/tree/release")).toMatchObject({
      repo: "acme/checkout",
      branch: "release",
    });
    expect(parseRepoRef("https://github.com/acme/checkout/blob/main/src/app.ts")).toMatchObject({
      repo: "acme/checkout",
      branch: "main",
    });
  });
});

describe("sandbox GitHub paths", () => {
  it("maps repo/ files onto GitHub paths", () => {
    expect(isGithubSandboxPath("repo/src/app.ts")).toBe(true);
    expect(isGithubSandboxPath("notes/hello.md")).toBe(false);
    expect(githubPathFromSandbox("repo/src/app.ts")).toBe("src/app.ts");
    expect(githubPathFromSandbox("repo")).toBeNull();
  });
});

describe("file filters", () => {
  it("skips dependency trees and env files, keeps source", () => {
    expect(shouldSkipGithubPath("apps/web/node_modules/left-pad/index.js")).toBe(true);
    expect(shouldSkipGithubPath(".env.local")).toBe(true);
    expect(shouldSkipGithubPath("apps/web/src/page.tsx")).toBe(false);
    expect(isGithubTextFile("apps/web/src/page.tsx", 1200)).toBe(true);
    expect(isGithubTextFile("photo.png", 800)).toBe(false);
  });

  it("caps the checkout at source files", () => {
    const picked = selectGithubFiles([
      { path: "node_modules/x/index.js", type: "file", size: 10 },
      { path: "src/a.ts", type: "file", size: 20 },
      { path: "src/b.ts", type: "file", size: 20 },
      { path: "dist/out.js", type: "file", size: 20 },
      { path: "README.md", type: "file", size: 80 },
    ]);
    expect(picked.map((row) => row.path)).toEqual(["README.md", "src/a.ts", "src/b.ts"]);
  });
});

describe("Composio payload unwrap", () => {
  it("reads full_name repos out of nested payloads", () => {
    const repos = collectGithubRepos({
      data: {
        items: [{ full_name: "acme/one", default_branch: "main", private: true, description: "api" }],
      },
    });
    expect(repos).toEqual([
      { fullName: "acme/one", defaultBranch: "main", private: true, description: "api" },
    ]);
    expect(
      collectGithubRepos({
        repositories: [{ full_name: "acme/two", default_branch: "dev", private: false, description: "" }],
      }),
    ).toEqual([{ fullName: "acme/two", defaultBranch: "dev", private: false, description: "" }]);
  });

  it("reads a git tree and a base64 file", () => {
    const tree = collectGithubTree({
      sha: "abc",
      truncated: false,
      tree: [
        { path: "src/a.ts", type: "blob", sha: "1", size: 12 },
        { path: "src", type: "tree", sha: "2" },
      ],
    });
    expect(tree.sha).toBe("abc");
    expect(tree.entries.map((row) => row.type)).toEqual(["file", "dir"]);
    const file = decodeGithubFile({
      encoding: "base64",
      sha: "fff",
      content: Buffer.from("export const n = 1;\n", "utf8").toString("base64"),
    });
    expect(file?.text).toContain("export const n");
    expect(file?.sha).toBe("fff");
  });

  it("reads directory listings", () => {
    expect(
      collectDirEntries([
        { path: "src", type: "dir" },
        { name: "README.md", type: "file", sha: "1" },
      ]).map((row) => row.path),
    ).toEqual(["src", "README.md"]);
  });
});
