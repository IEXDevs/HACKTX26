import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolveInside, toPosixPath, SandboxViolation } from "@agent-os/core";

const execAsync = promisify(exec);

export interface SandboxNode {
  name: string;
  path: string;
  type: "file" | "dir";
  bytes?: number;
  children?: SandboxNode[];
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Commands an agent may invoke. Anything else is refused before spawn. */
const ALLOWED_BINARIES = new Set([
  "npm",
  "node",
  "pnpm",
  "python",
  "python3",
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "wc",
  "git",
]);

const FORBIDDEN_PATTERN = /[;&|<>`$]|\$\(/;

/**
 * A real directory on disk, rooted at the agent's own workspace.
 *
 * Every path goes through `resolveInside`, so traversal, absolute paths and
 * null bytes are rejected before any syscall. Shell execution is allowlisted
 * and time-boxed; there is no network sandbox here, which is why egress is a
 * separately gated capability.
 */
export class AgentSandbox {
  readonly root: string;

  constructor(
    sandboxRoot: string,
    workspaceId: string,
    readonly agentId: string,
  ) {
    this.root = path.join(sandboxRoot, workspaceId, agentId);
  }

  ensure(): void {
    fs.mkdirSync(this.root, { recursive: true });
  }

  exists(): boolean {
    return fs.existsSync(this.root);
  }

  resolve(relativePath: string): string {
    return resolveInside(this.root, stripSandboxPrefix(relativePath, this.agentId));
  }

  tree(relative = ".", depth = 0): SandboxNode {
    const cleaned = stripSandboxPrefix(relative, this.agentId);
    const target = cleaned === "." ? this.root : this.resolve(cleaned);
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (!stat) {
      throw new SandboxViolation("Path does not exist.", relative);
    }

    const isRoot = cleaned === ".";
    const nodePath = isRoot ? "" : toPosixPath(cleaned);

    if (stat.isFile()) {
      return {
        name: path.basename(target),
        path: nodePath,
        type: "file",
        bytes: stat.size,
      };
    }

    const entries = fs.readdirSync(target, { withFileTypes: true });
    const children =
      depth >= 6
        ? []
        : entries
            .filter((entry) => visibleSandboxEntry(entry.name))
            .sort((a, b) => {
              if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
            .map((entry) => {
              const childRel = nodePath ? `${nodePath}/${entry.name}` : entry.name;
              return this.tree(childRel, depth + 1);
            });

    return {
      // Empty name so listings and the console treat this as the sandbox root,
      // not a folder named after the agent id (agt_red_team/README.md is wrong).
      name: isRoot ? "" : path.basename(target),
      path: nodePath,
      type: "dir",
      children,
    };
  }

  read(relativePath: string): string {
    const target = this.resolve(relativePath);
    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) throw new Error(`Not a file: ${relativePath}`);
    if (stat.size > 512 * 1024) throw new Error("File exceeds the 512 KB read limit.");
    return fs.readFileSync(target, "utf8");
  }

  write(relativePath: string, content: string): { bytes: number } {
    const target = this.resolve(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    return { bytes: Buffer.byteLength(content, "utf8") };
  }

  remove(relativePath: string): void {
    const target = this.resolve(relativePath);
    if (!fs.existsSync(target)) return;
    fs.rmSync(target, { recursive: true, force: true });
  }

  async exec(command: string, timeoutMs = 30_000): Promise<ExecResult> {
    const trimmed = command.trim();
    if (!trimmed) throw new Error("Empty command.");
    if (FORBIDDEN_PATTERN.test(trimmed)) {
      throw new Error(
        "Shell metacharacters are not permitted. Run one command at a time.",
      );
    }
    const binary = trimmed.split(/\s+/)[0] ?? "";
    if (!ALLOWED_BINARIES.has(binary)) {
      throw new Error(
        `Binary "${binary}" is not on the agent allowlist.`,
      );
    }

    this.ensure();
    try {
      const { stdout, stderr } = await execAsync(trimmed, {
        cwd: this.root,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        env: {
          PATH: process.env.PATH ?? "",
          NODE_ENV: "test",
          // Deliberately not inherited: no provider keys, no database URL.
          HOME: this.root,
          // Keep package-manager caches and logs out of the agent's sandbox so
          // the filesystem view only contains work product.
          npm_config_cache: path.join(os.tmpdir(), "agent-os-npm-cache"),
          npm_config_update_notifier: "false",
          NO_UPDATE_NOTIFIER: "1",
          npm_config_fund: "false",
          npm_config_audit: "false",
        },
        windowsHide: true,
      });
      return { code: 0, stdout, stderr, timedOut: false };
    } catch (error) {
      const err = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
        killed?: boolean;
        message?: string;
      };
      return {
        code: typeof err.code === "number" ? err.code : 1,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? err.message ?? "",
        timedOut: Boolean(err.killed),
      };
    }
  }

  /** Create an empty sandbox. Demo checkout files from older builds are removed. */
  provision(): void {
    this.ensure();
    this.scrubDemoFixtures();
  }

  /** Drop the canned checkout tree if it is still sitting in this sandbox. */
  scrubDemoFixtures(): void {
    const dropIf = (relativePath: string, matches: (text: string) => boolean) => {
      try {
        const text = this.read(relativePath);
        if (matches(text)) this.remove(relativePath);
      } catch {
        // Missing paths are already clean.
      }
    };
    dropIf("README.md", (text) => text.includes("This directory is the agent's own filesystem"));
    dropIf("package.json", (text) => text.includes("checkout-sandbox"));
    dropIf("telemetry/deploy-log.json", (text) => text.includes("9f2c1ab") && text.includes("POOL_MAX"));
    dropIf("services/checkout/pool.ts", (text) => text.includes("Connection pool for the checkout service"));
    dropIf("checkout.test.js", (text) => text.includes("pool ceiling is restored to 40"));
    dropIf("notes/.keep", (text) => text.trim() === "");
    for (const dir of ["notes", "telemetry", "services/checkout", "services"]) {
      this.pruneEmpty(dir);
    }
  }

  pruneEmpty(relativePath: string): void {
    try {
      const target = this.resolve(relativePath);
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return;
      if (fs.readdirSync(target).length === 0) fs.rmdirSync(target);
    } catch {
      // Ignore races and missing folders.
    }
  }
}

/**
 * Models often prefix sandbox paths with the agent id because the root folder
 * used to be named that way. Strip that prefix so `agt_red_team/README.md`
 * and `README.md` resolve to the same file.
 */
export function stripSandboxPrefix(relativePath: string, agentId: string): string {
  const normalised = relativePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalised || normalised === ".") return ".";
  if (normalised === agentId || normalised === `${agentId}/`) return ".";
  const prefix = `${agentId}/`;
  if (normalised.startsWith(prefix)) return normalised.slice(prefix.length) || ".";
  return normalised;
}

/** Render a sandbox tree the way fs.list shows it to the model. */
/** Dotfiles that are part of a real checkout, not secrets or tooling caches. */
export function visibleSandboxEntry(name: string): boolean {
  if (name === ".keep" || name === ".github" || name === ".gitignore" || name === ".env.example") return true;
  if (name === ".git" || name === ".github-checkout.json" || name === ".github-index.json") return false;
  if (name === ".env" || name.startsWith(".env.")) return false;
  if (name.startsWith(".astronom") || name.startsWith(".github-")) return false;
  if (name.startsWith(".")) return false;
  return true;
}

export function formatTreeListing(tree: SandboxNode, limit = 200): string {
  const lines: string[] = [];
  const walk = (node: SandboxNode, depth: number) => {
    if (lines.length >= limit) return;
    const indent = "  ".repeat(depth);
    const label = node.name || ".";
    lines.push(node.type === "dir" ? `${indent}${label}/` : `${indent}${node.name} (${node.bytes ?? 0}b)`);
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  const roots = !tree.path && tree.type === "dir" ? (tree.children ?? []) : [tree];
  for (const node of roots) walk(node, 0);
  return `${lines.length} entries under ${tree.path || "."}\n${lines.join("\n")}`;
}
