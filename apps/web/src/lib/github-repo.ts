/** Pure GitHub checkout helpers. No Composio or filesystem I/O. */

export const GITHUB_CHECKOUT_DIR = "repo";
export const GITHUB_SIDECAR = ".github-checkout.json";
export const GITHUB_INDEX = ".github-index.json";

export const MAX_GITHUB_FILES = 150;
export const MAX_GITHUB_FILE_BYTES = 180_000;

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  "out",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".turbo",
  ".cache",
  ".pnpm-store",
]);

const TEXT_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "md",
  "mdx",
  "yml",
  "yaml",
  "toml",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "rb",
  "php",
  "css",
  "scss",
  "html",
  "htm",
  "sql",
  "sh",
  "bash",
  "zsh",
  "graphql",
  "gql",
  "proto",
  "xml",
  "txt",
  "csv",
  "svg",
  "env",
  "example",
  "gitignore",
  "dockerignore",
  "editorconfig",
  "prettierrc",
  "eslintrc",
]);

const ROOT_TEXT_NAMES = new Set([
  "dockerfile",
  "makefile",
  "license",
  "licence",
  "readme",
  "changelog",
  "gemfile",
  "procfile",
  "justfile",
]);

export interface GithubWorkingRepo {
  repo: string;
  owner: string;
  name: string;
  branch: string;
}

export interface GithubRepoSummary {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string;
}

export interface GithubTreeEntry {
  path: string;
  type: "file" | "dir";
  sha?: string;
  size?: number;
}

export interface GithubCheckoutSidecar {
  repo: string;
  branch: string;
  commit: string;
  files: number;
  syncedAt: string;
}

export function parseRepoRef(value: string, branch = "main"): GithubWorkingRepo | null {
  let raw = value.trim();
  raw = raw.replace(/^git@github\.com:/i, "https://github.com/");
  raw = raw.replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/");
  raw = raw.replace(/^git:\/\/github\.com\//i, "https://github.com/");
  raw = raw.replace(/^https?:\/\/(www\.)?github\.com\//i, "");
  raw = raw.replace(/[?#].*$/, "");
  raw = raw.replace(/\.git$/i, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0] ?? "";
  const name = (parts[1] ?? "").replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  let branchName = branch.trim() || "main";
  if ((parts[2] === "tree" || parts[2] === "blob") && parts[3]) {
    try {
      branchName = decodeURIComponent(parts[3]);
    } catch {
      branchName = parts[3];
    }
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branchName)) return null;
  return { repo: `${owner}/${name}`, owner, name, branch: branchName };
}

export function parseGithubMetadata(metadata: Record<string, unknown> | null | undefined): GithubWorkingRepo | null {
  if (!metadata) return null;
  const repo = typeof metadata.repo === "string" ? metadata.repo : "";
  const branch = typeof metadata.branch === "string" ? metadata.branch : "main";
  return parseRepoRef(repo, branch);
}

export function isGithubSandboxPath(relativePath: string): boolean {
  const normalised = posixPath(relativePath);
  return normalised === GITHUB_CHECKOUT_DIR || normalised.startsWith(`${GITHUB_CHECKOUT_DIR}/`);
}

export function githubPathFromSandbox(relativePath: string): string | null {
  const normalised = posixPath(relativePath);
  if (normalised === GITHUB_CHECKOUT_DIR) return null;
  if (!normalised.startsWith(`${GITHUB_CHECKOUT_DIR}/`)) return null;
  const rest = normalised.slice(GITHUB_CHECKOUT_DIR.length + 1);
  if (!rest || rest === GITHUB_SIDECAR || rest === GITHUB_INDEX) return null;
  return rest;
}

export function sandboxPathForGithub(repoPath: string): string {
  const cleaned = posixPath(repoPath);
  return cleaned ? `${GITHUB_CHECKOUT_DIR}/${cleaned}` : GITHUB_CHECKOUT_DIR;
}

export function shouldSkipGithubPath(relativePath: string): boolean {
  const parts = posixPath(relativePath).split("/").filter(Boolean);
  if (parts.length === 0) return true;
  for (const part of parts.slice(0, -1)) {
    if (SKIP_DIR_NAMES.has(part)) return true;
  }
  const file = parts[parts.length - 1] ?? "";
  if (SKIP_DIR_NAMES.has(file) && parts.length > 1) return true;
  if (file === ".env" || (file.startsWith(".env.") && file !== ".env.example")) return true;
  return false;
}

export function isGithubTextFile(relativePath: string, size = 0): boolean {
  if (size > MAX_GITHUB_FILE_BYTES) return false;
  const file = posixPath(relativePath).split("/").pop()?.toLowerCase() ?? "";
  if (ROOT_TEXT_NAMES.has(file)) return true;
  if (file.startsWith(".") && TEXT_EXTENSIONS.has(file.slice(1))) return true;
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return size > 0 && size <= 8_192;
  return TEXT_EXTENSIONS.has(file.slice(dot + 1));
}

export function selectGithubFiles(entries: GithubTreeEntry[]): GithubTreeEntry[] {
  const files = entries.filter((entry) => {
    if (entry.type !== "file") return false;
    if (shouldSkipGithubPath(entry.path)) return false;
    return isGithubTextFile(entry.path, entry.size ?? 0);
  });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files.slice(0, MAX_GITHUB_FILES);
}

export function collectGithubRepos(data: unknown): GithubRepoSummary[] {
  const found: GithubRepoSummary[] = [];
  const seen = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (depth > 6 || found.length >= 80) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const record = asObject(value);
    if (!record) return;
    const fullName =
      str(record, "full_name", "fullName", "fullNameWithOwner") ??
      (str(record, "owner") && str(record, "name") ? `${str(record, "owner")}/${str(record, "name")}` : null);
    if (fullName?.includes("/")) {
      const parsed = parseRepoRef(fullName);
      if (parsed && !seen.has(parsed.repo)) {
        seen.add(parsed.repo);
        found.push({
          fullName: parsed.repo,
          defaultBranch: str(record, "default_branch", "defaultBranch") ?? "main",
          private: Boolean(record.private),
          description: str(record, "description") ?? "",
        });
      }
      return;
    }
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object") walk(nested, depth + 1);
    }
  };
  walk(data, 0);
  return found;
}

export function collectGithubTree(data: unknown): { sha: string; truncated: boolean; entries: GithubTreeEntry[] } {
  const record = deepestRecord(data, ["tree", "sha", "truncated"]);
  const tree = Array.isArray(record?.tree)
    ? record.tree
    : Array.isArray(data)
      ? data
      : findArray(data, (item) => Boolean(asObject(item)?.path));
  const entries: GithubTreeEntry[] = [];
  for (const item of tree) {
    const row = asObject(item);
    if (!row) continue;
    const path = str(row, "path");
    if (!path) continue;
    const typeRaw = str(row, "type", "kind") ?? "";
    const type: GithubTreeEntry["type"] =
      typeRaw === "tree" || typeRaw === "dir" || typeRaw === "directory" ? "dir" : "file";
    const size = typeof row.size === "number" ? row.size : undefined;
    entries.push({ path, type, sha: str(row, "sha") ?? undefined, size });
  }
  return {
    sha: str(record ?? {}, "sha", "tree_sha", "commit") ?? "",
    truncated: Boolean(record?.truncated),
    entries,
  };
}

export function collectDirEntries(data: unknown): GithubTreeEntry[] {
  const rows = Array.isArray(data) ? data : findArray(data, (item) => Boolean(asObject(item)?.path || asObject(item)?.name));
  const entries: GithubTreeEntry[] = [];
  for (const item of rows) {
    const row = asObject(item);
    if (!row) continue;
    const path = str(row, "path", "name");
    if (!path) continue;
    const typeRaw = str(row, "type", "kind") ?? "";
    const type: GithubTreeEntry["type"] =
      typeRaw === "dir" || typeRaw === "directory" || typeRaw === "tree" ? "dir" : "file";
    entries.push({
      path,
      type,
      sha: str(row, "sha") ?? undefined,
      size: typeof row.size === "number" ? row.size : undefined,
    });
  }
  return entries;
}

export function decodeGithubFile(data: unknown): { text: string; sha: string; size: number } | null {
  const record = deepestRecord(data, ["content", "encoding", "sha"]) ?? asObject(data);
  if (!record) return null;
  const sha = str(record, "sha") ?? "";
  const encoding = (str(record, "encoding") ?? "").toLowerCase();
  const decoded = str(record, "decoded_content", "decodedContent", "text");
  if (decoded) {
    return { text: decoded, sha, size: Buffer.byteLength(decoded, "utf8") };
  }
  const content = str(record, "content");
  if (!content) return null;
  const text =
    encoding === "base64" || looksLikeBase64(content)
      ? Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8")
      : content;
  if (text.includes("\u0000")) return null;
  return { text, sha, size: Buffer.byteLength(text, "utf8") };
}

export function readRepoField(data: unknown, ...keys: string[]): string | null {
  const record = deepestRecord(data, keys) ?? asObject(data);
  return record ? str(record, ...keys) : null;
}

function posixPath(relativePath: string): string {
  return relativePath.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function looksLikeBase64(value: string): boolean {
  const compact = value.replace(/\s/g, "");
  return compact.length > 24 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+=*$/.test(compact);
}

function findArray(value: unknown, predicate: (item: unknown) => boolean): unknown[] {
  if (Array.isArray(value) && value.some(predicate)) return value;
  const record = asObject(value);
  if (!record) return [];
  for (const nested of Object.values(record)) {
    const found = findArray(nested, predicate);
    if (found.length > 0) return found;
  }
  return [];
}

function deepestRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
  const record = asObject(value);
  if (!record) return null;
  if (keys.some((key) => key in record)) return record;
  for (const nested of Object.values(record)) {
    const found = deepestRecord(nested, keys);
    if (found) return found;
  }
  return null;
}
