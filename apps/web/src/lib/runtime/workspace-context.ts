/**
 * Shared CONTEXT.md for a workspace.
 *
 * Lives next to per-agent sandboxes (`{sandboxRoot}/{workspaceId}/CONTEXT.md`),
 * not inside any one agent jail. Orchestrators read it on every run, fill it
 * in on first contact with the repo, and keep it current. Operators can edit
 * it directly or tell an agent to include/remove a fact.
 */
import fs from "node:fs";
import path from "node:path";

export const CONTEXT_FILENAME = "CONTEXT.md";
export const CONNECTORS_START = "<!-- astronom-connectors:start -->";
export const CONNECTORS_END = "<!-- astronom-connectors:end -->";

const STUB = [
  "# Workspace context",
  "",
  "Shared notes the orchestrator keeps about this workspace: tech stack,",
  "layout, conventions, and operator preferences. Agents read this on their",
  "own at the start of a run and update it as they learn. Never put secrets here.",
  "",
  "## Tech stack",
  "(unknown — fill in on first run)",
  "",
  "## Layout",
  "(unknown — fill in on first run)",
  "",
  "## Conventions",
  "(unknown — fill in on first run)",
  "",
  "## Operator notes",
  "(none)",
  "",
].join("\n");

const CONTEXT_PATHS = new Set([
  "context.md",
  "context",
  "/context.md",
  "workspace/context.md",
  "./context.md",
]);

export function isContextPath(relativePath: string): boolean {
  const normalised = relativePath.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  return CONTEXT_PATHS.has(normalised) || normalised === CONTEXT_FILENAME.toLowerCase();
}

export function isContextStub(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length === 0 || trimmed.includes("(unknown — fill in on first run)");
}

/** A partially filled file can already contain notes that must survive hydration. */
export function hasContextContent(content: string): boolean {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 && normalized !== STUB.trim();
}

export interface ContextDirective {
  op: "include" | "remove";
  text: string;
}

/** Pull explicit "include/remove from context" instructions out of a goal. */
export function parseContextDirectives(goal: string): ContextDirective[] {
  const found: ContextDirective[] = [];
  const patterns: Array<{ op: ContextDirective["op"]; re: RegExp }> = [
    { op: "include", re: /(?:add|include|put|remember)\s+(?:this\s+)?(?:in(?:to)?|to)\s+(?:the\s+)?context(?:\s+file)?:\s*([^.;\n]+)/gi },
    { op: "remove", re: /(?:remove|delete|forget|drop)\s+(?:this\s+)?(?:from\s+)?(?:the\s+)?context(?:\s+file)?:\s*([^.;\n]+)/gi },
  ];
  for (const { op, re } of patterns) {
    for (const match of goal.matchAll(re)) {
      const text = (match[1] ?? "").trim().replace(/[.;]+$/, "");
      if (text.length >= 2) found.push({ op, text });
    }
  }
  return found;
}

export function applyContextDirective(content: string, directive: ContextDirective): string {
  const body = content.trimEnd() || STUB.trimEnd();
  if (directive.op === "remove") {
    const needle = directive.text.toLowerCase();
    const kept = body
      .split(/\r?\n/)
      .filter((line) => !line.toLowerCase().includes(needle));
    const next = kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
    return `${next}\n`;
  }
  const note = directive.text.trim();
  if (body.toLowerCase().includes(note.toLowerCase())) return `${body}\n`;
  if (/^##\s+Operator notes/m.test(body)) {
    if (body.includes("## Operator notes\n(none)")) {
      return `${body.replace("## Operator notes\n(none)", `## Operator notes\n- ${note}`).trimEnd()}\n`;
    }
    return `${body.replace(/^(##\s+Operator notes\s*)$/m, `$1\n- ${note}`).trimEnd()}\n`;
  }
  return `${body}\n\n## Operator notes\n- ${note}\n`;
}

/** Replace (or append) the generated connected-tools block. Agents should not edit it. */
export function upsertConnectedToolsSection(content: string, body: string): string {
  const block = `${CONNECTORS_START}\n${body.trim()}\n${CONNECTORS_END}\n`;
  const start = content.indexOf(CONNECTORS_START);
  const end = content.indexOf(CONNECTORS_END);
  if (start >= 0 && end >= start) {
    const after = content.slice(end + CONNECTORS_END.length).replace(/^\r?\n/, "");
    return `${content.slice(0, start)}${block}${after}`;
  }
  const trimmed = (content.trimEnd() || STUB.trimEnd());
  return `${trimmed}\n\n${block}`;
}

export class WorkspaceContextFile {
  readonly file: string;

  constructor(sandboxRoot: string, readonly workspaceId: string) {
    this.file = path.join(sandboxRoot, workspaceId, CONTEXT_FILENAME);
  }

  get exists(): boolean {
    return fs.existsSync(this.file);
  }

  ensure(): string {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!this.exists) fs.writeFileSync(this.file, STUB, "utf8");
    return this.read();
  }

  read(): string {
    if (!this.exists) return STUB;
    return fs.readFileSync(this.file, "utf8");
  }

  write(content: string): { bytes: number } {
    if (Buffer.byteLength(content, "utf8") > 256 * 1024) {
      throw new Error("CONTEXT.md is limited to 256 KB.");
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    return { bytes: Buffer.byteLength(content, "utf8") };
  }

  apply(directive: ContextDirective): { bytes: number; content: string } {
    const next = applyContextDirective(this.exists ? this.read() : STUB, directive);
    const { bytes } = this.write(next);
    return { bytes, content: next };
  }

  /** Prompt block injected into every agent that runs in this workspace. */
  promptBlock(): string {
    const content = this.read();
    const stub = isContextStub(content);
    const body = [
      "Workspace CONTEXT.md (read this on your own; keep it current):",
      "",
      content.trim(),
      ...(stub ? ["",
          "The workspace CONTEXT.md still has unfinished sections.",
          "On this first run: inspect the repo (fs.list, README, package.json, kb.search)",
          "and fill the missing tech stack, layout, and conventions with context.write.",
          "Preserve existing builder context and operator notes while filling in the missing sections.",
        ] : []),
    ].join("\n");
    return [
      "",
      "",
      body,
      "The operator may tell you to include or remove facts from this file; honour that with context.write / context.read.",
      "Do not put secrets, credentials, or raw PII in CONTEXT.md.",
    ].join("\n");
  }
}
