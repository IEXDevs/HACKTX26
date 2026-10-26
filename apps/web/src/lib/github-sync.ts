/**
 * Mirror a linked GitHub repo into agent sandboxes and push edits back.
 *
 * The working repo lives on the operator's connected GitHub account. A workspace
 * cache under the sandbox root avoids refetching for every agent; each sandbox
 * gets a copy at repo/.
 */
import fs from "node:fs";
import path from "node:path";
import { executeComposioActionRaw } from "./composio";
import { getConnectedComposioAccountId, getGithubWorkingRepo } from "./connectors";
import { env } from "./env";
import {
  collectDirEntries,
  collectGithubRepos,
  collectGithubTree,
  decodeGithubFile,
  GITHUB_CHECKOUT_DIR,
  GITHUB_INDEX,
  GITHUB_SIDECAR,
  githubPathFromSandbox,
  type GithubCheckoutSidecar,
  type GithubRepoSummary,
  type GithubTreeEntry,
  type GithubWorkingRepo,
  MAX_GITHUB_FILE_BYTES,
  readRepoField,
  selectGithubFiles,
} from "./github-repo";
import type { AgentSandbox } from "./runtime/sandbox";

export type GithubExecutor = (input: {
  userId: string;
  action: string;
  arguments?: Record<string, unknown>;
  connectedAccountId?: string | null;
}) => Promise<{ ok: boolean; data: unknown; error?: string }>;

export interface GithubSyncResult {
  synced: boolean;
  repo?: string;
  branch?: string;
  commit?: string;
  files: number;
  skipped: boolean;
  error?: string;
}

const LIST_REPO_ACTIONS = [
  "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
  "GITHUB_LIST_REPOS_FOR_THE_AUTHENTICATED_USER",
];
const GET_REPO_ACTIONS = ["GITHUB_GET_A_REPOSITORY", "GITHUB_GET_REPOSITORY"];
const GET_TREE_ACTIONS = ["GITHUB_GET_A_TREE", "GITHUB_GET_TREE"];
const GET_CONTENT_ACTIONS = ["GITHUB_GET_REPOSITORY_CONTENT", "GITHUB_GET_FILE_CONTENTS"];
const PUT_FILE_ACTIONS = ["GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS", "GITHUB_CREATE_OR_UPDATE_FILE"];
const DELETE_FILE_ACTIONS = ["GITHUB_DELETE_A_FILE", "GITHUB_DELETE_FILE"];

function defaultExecutor(): GithubExecutor {
  return async (input) =>
    executeComposioActionRaw({
      userId: input.userId,
      toolkit: "github",
      action: input.action,
      arguments: input.arguments,
      connectedAccountId: input.connectedAccountId,
    });
}

function withAccount(exec: GithubExecutor, connectedAccountId?: string | null): GithubExecutor {
  if (!connectedAccountId) return exec;
  return (input) => exec({ ...input, connectedAccountId: input.connectedAccountId ?? connectedAccountId });
}

async function githubAction(
  exec: GithubExecutor,
  userId: string,
  slugs: string[],
  args: Record<string, unknown>,
  connectedAccountId?: string | null,
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  let last: { ok: boolean; data: unknown; error?: string } = {
    ok: false,
    data: null,
    error: "No matching GitHub action.",
  };
  for (const action of slugs) {
    last = await exec({ userId, action, arguments: args, connectedAccountId });
    if (last.ok) return last;
  }
  return last;
}

export async function listGithubRepos(
  userId: string,
  exec: GithubExecutor = defaultExecutor(),
  connectedAccountId?: string | null,
): Promise<GithubRepoSummary[]> {
  const result = await githubAction(
    withAccount(exec, connectedAccountId),
    userId,
    LIST_REPO_ACTIONS,
    {
      per_page: 100,
      sort: "pushed",
      type: "all",
    },
    connectedAccountId,
  );
  if (!result.ok) {
    throw new Error(result.error ?? "Could not list GitHub repositories.");
  }
  return collectGithubRepos(result.data);
}

function workspaceCacheRoot(workspaceId: string, sandboxRoot?: string): string {
  return path.join(sandboxRoot ?? env.sandboxRoot, workspaceId, ".github-cache");
}

function cacheRootFromSandbox(sandbox: AgentSandbox): string {
  return path.join(path.dirname(sandbox.root), ".github-cache");
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 0 }, () => worker()));
  return out;
}

async function fetchTree(
  exec: GithubExecutor,
  userId: string,
  working: GithubWorkingRepo,
): Promise<{ sha: string; files: GithubTreeEntry[] }> {
  const repo = await githubAction(exec, userId, GET_REPO_ACTIONS, {
    owner: working.owner,
    repo: working.name,
  });
  const branch =
    working.branch ||
    readRepoField(repo.data, "default_branch", "defaultBranch") ||
    "main";
  const tree = await githubAction(exec, userId, GET_TREE_ACTIONS, {
    owner: working.owner,
    repo: working.name,
    tree_sha: branch,
    recursive: true,
  });
  if (tree.ok) {
    const parsed = collectGithubTree(tree.data);
    return { sha: parsed.sha || branch, files: selectGithubFiles(parsed.entries) };
  }

  const files: GithubTreeEntry[] = [];
  const walk = async (dir: string) => {
    if (files.length >= 150) return;
    const listing = await githubAction(exec, userId, GET_CONTENT_ACTIONS, {
      owner: working.owner,
      repo: working.name,
      path: dir,
      ref: branch,
    });
    if (!listing.ok) return;
    for (const entry of collectDirEntries(listing.data)) {
      const pathName = dir ? `${dir}/${entry.path.split("/").pop()}` : entry.path;
      if (entry.type === "dir") await walk(pathName);
      else files.push({ ...entry, path: pathName });
    }
  };
  await walk("");
  return { sha: branch, files: selectGithubFiles(files) };
}

async function fetchFile(
  exec: GithubExecutor,
  userId: string,
  working: GithubWorkingRepo,
  filePath: string,
): Promise<{ text: string; sha: string } | null> {
  const result = await githubAction(exec, userId, GET_CONTENT_ACTIONS, {
    owner: working.owner,
    repo: working.name,
    path: filePath,
    ref: working.branch,
  });
  if (!result.ok) return null;
  const decoded = decodeGithubFile(result.data);
  if (!decoded || decoded.size > MAX_GITHUB_FILE_BYTES) return null;
  return { text: decoded.text, sha: decoded.sha };
}

function copyCacheToSandbox(cache: string, sandbox: AgentSandbox): number {
  const from = path.join(cache, GITHUB_CHECKOUT_DIR);
  if (!fs.existsSync(from)) return 0;
  sandbox.ensure();
  const dest = sandbox.resolve(GITHUB_CHECKOUT_DIR);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(from, dest, { recursive: true });
  const sidecar = readJson<GithubCheckoutSidecar>(path.join(cache, GITHUB_SIDECAR));
  const index = readJson<Record<string, string>>(path.join(cache, GITHUB_INDEX)) ?? {};
  if (sidecar) writeJson(path.join(sandbox.root, GITHUB_SIDECAR), sidecar);
  writeJson(path.join(sandbox.root, GITHUB_INDEX), index);
  return sidecar?.files ?? 0;
}

export async function refreshGithubCache(input: {
  workspaceId: string;
  userId: string;
  exec?: GithubExecutor;
  working?: GithubWorkingRepo | null;
  sandboxRoot?: string;
}): Promise<GithubSyncResult> {
  const working =
    input.working !== undefined ? input.working : await getGithubWorkingRepo(input.workspaceId, input.userId);
  if (!working) return { synced: false, files: 0, skipped: true };
  const accountId = input.exec
    ? null
    : await getConnectedComposioAccountId(input.workspaceId, input.userId, "github");
  const exec = withAccount(input.exec ?? defaultExecutor(), accountId);
  const cache = workspaceCacheRoot(input.workspaceId, input.sandboxRoot);
  const sidecarPath = path.join(cache, GITHUB_SIDECAR);
  const existing = readJson<GithubCheckoutSidecar>(sidecarPath);
  const tree = await fetchTree(exec, input.userId, working);
  if (existing && existing.repo === working.repo && existing.branch === working.branch && existing.commit === tree.sha) {
    return { synced: true, repo: working.repo, branch: working.branch, commit: tree.sha, files: existing.files, skipped: true };
  }

  const repoDir = path.join(cache, GITHUB_CHECKOUT_DIR);
  fs.rmSync(repoDir, { recursive: true, force: true });
  fs.mkdirSync(repoDir, { recursive: true });
  const index: Record<string, string> = {};
  const fetched = await mapPool(tree.files, 6, async (file) => {
    const body = await fetchFile(exec, input.userId, { ...working, branch: working.branch }, file.path);
    if (!body) return false;
    const target = path.join(repoDir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body.text, "utf8");
    index[file.path] = body.sha || file.sha || "";
    return true;
  });
  const files = fetched.filter(Boolean).length;
  const sidecar: GithubCheckoutSidecar = {
    repo: working.repo,
    branch: working.branch,
    commit: tree.sha,
    files,
    syncedAt: new Date().toISOString(),
  };
  writeJson(sidecarPath, sidecar);
  writeJson(path.join(cache, GITHUB_INDEX), index);
  return { synced: true, repo: working.repo, branch: working.branch, commit: tree.sha, files, skipped: false };
}

export async function ensureGithubCheckout(input: {
  sandbox: AgentSandbox;
  workspaceId: string;
  userId: string;
  exec?: GithubExecutor;
  working?: GithubWorkingRepo | null;
}): Promise<GithubSyncResult> {
  const working =
    input.working !== undefined ? input.working : await getGithubWorkingRepo(input.workspaceId, input.userId);
  if (!working) return { synced: false, files: 0, skipped: true };
  const cache = cacheRootFromSandbox(input.sandbox);
  const local = readJson<GithubCheckoutSidecar>(path.join(input.sandbox.root, GITHUB_SIDECAR));
  const cached = readJson<GithubCheckoutSidecar>(path.join(cache, GITHUB_SIDECAR));
  if (
    local &&
    cached &&
    local.repo === working.repo &&
    local.branch === working.branch &&
    local.commit === cached.commit &&
    local.repo === cached.repo
  ) {
    return { synced: true, repo: working.repo, branch: working.branch, commit: local.commit, files: local.files, skipped: true };
  }
  const refreshed = await refreshGithubCache({
    workspaceId: input.workspaceId,
    userId: input.userId,
    exec: input.exec,
    working,
    sandboxRoot: path.dirname(path.dirname(input.sandbox.root)),
  });
  if (!refreshed.synced) return refreshed;
  const files = copyCacheToSandbox(cache, input.sandbox);
  return { ...refreshed, files, skipped: refreshed.skipped && Boolean(local) };
}

export async function pushGithubFile(input: {
  workspaceId: string;
  userId: string;
  sandboxPath: string;
  content: string;
  message?: string;
  exec?: GithubExecutor;
  working?: GithubWorkingRepo | null;
  sandboxRoot?: string;
}): Promise<{ ok: boolean; preview: string; error?: string }> {
  const repoPath = githubPathFromSandbox(input.sandboxPath);
  if (!repoPath) return { ok: true, preview: "not a GitHub checkout path" };
  const working =
    input.working !== undefined ? input.working : await getGithubWorkingRepo(input.workspaceId, input.userId);
  if (!working) return { ok: false, preview: "", error: "No working GitHub repository is selected." };
  const accountId = input.exec
    ? null
    : await getConnectedComposioAccountId(input.workspaceId, input.userId, "github");
  const exec = withAccount(input.exec ?? defaultExecutor(), accountId);
  const indexPath = path.join(workspaceCacheRoot(input.workspaceId, input.sandboxRoot), GITHUB_INDEX);
  const index = readJson<Record<string, string>>(indexPath) ?? {};
  let sha = index[repoPath];
  if (!sha) {
    const current = await fetchFile(exec, input.userId, working, repoPath);
    sha = current?.sha ?? "";
  }
  const result = await githubAction(exec, input.userId, PUT_FILE_ACTIONS, {
    owner: working.owner,
    repo: working.name,
    path: repoPath,
    branch: working.branch,
    message: input.message ?? `Astronom: update ${repoPath}`,
    content: Buffer.from(input.content, "utf8").toString("base64"),
    sha: sha || undefined,
  });
  if (!result.ok) {
    return { ok: false, preview: "", error: result.error ?? "Could not push the file to GitHub." };
  }
  const nextSha = readRepoField(result.data, "sha") ?? sha;
  if (nextSha) {
    index[repoPath] = nextSha;
    writeJson(indexPath, index);
  }
  return { ok: true, preview: `committed ${repoPath} to ${working.repo}@${working.branch}` };
}

export async function deleteGithubFile(input: {
  workspaceId: string;
  userId: string;
  sandboxPath: string;
  message?: string;
  exec?: GithubExecutor;
  working?: GithubWorkingRepo | null;
  sandboxRoot?: string;
}): Promise<{ ok: boolean; preview: string; error?: string }> {
  const repoPath = githubPathFromSandbox(input.sandboxPath);
  if (!repoPath) return { ok: true, preview: "not a GitHub checkout path" };
  const working =
    input.working !== undefined ? input.working : await getGithubWorkingRepo(input.workspaceId, input.userId);
  if (!working) return { ok: false, preview: "", error: "No working GitHub repository is selected." };
  const accountId = input.exec
    ? null
    : await getConnectedComposioAccountId(input.workspaceId, input.userId, "github");
  const exec = withAccount(input.exec ?? defaultExecutor(), accountId);
  const index = readJson<Record<string, string>>(path.join(workspaceCacheRoot(input.workspaceId, input.sandboxRoot), GITHUB_INDEX)) ?? {};
  const result = await githubAction(exec, input.userId, DELETE_FILE_ACTIONS, {
    owner: working.owner,
    repo: working.name,
    path: repoPath,
    branch: working.branch,
    message: input.message ?? `Astronom: delete ${repoPath}`,
    sha: index[repoPath] || undefined,
  });
  if (!result.ok) {
    return { ok: false, preview: "", error: result.error ?? "Could not delete the file on GitHub." };
  }
  delete index[repoPath];
  writeJson(path.join(workspaceCacheRoot(input.workspaceId, input.sandboxRoot), GITHUB_INDEX), index);
  return { ok: true, preview: `deleted ${repoPath} on ${working.repo}@${working.branch}` };
}

export type { GithubWorkingRepo, GithubRepoSummary };
