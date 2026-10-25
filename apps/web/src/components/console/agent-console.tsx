"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  File,
  FilePlus2,
  Folder,
  FolderOpen,
  Loader2,
  Play,
  Save,
  Terminal,
  Wrench,
  X,
} from "@/components/icons";
import {
  Button,
  Divider,
  Meter,
  Panel,
  StatusBadge,
  Tag,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { clockTime, relativeTime, tokens, usd } from "@/lib/format";

export interface ConsoleNode {
  name: string;
  path: string;
  type: "file" | "dir";
  bytes?: number;
  children?: ConsoleNode[];
}

export interface ConsoleToolCall {
  id: string;
  tool: string;
  status: string;
  durationMs: number | null;
  preview: string | null;
  error: string | null;
  at: string;
}

export interface ConsoleRun {
  id: string;
  status: string;
  goal: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: string;
}

function collectFiles(node: ConsoleNode, out: ConsoleNode[] = []): ConsoleNode[] {
  if (node.type === "file") out.push(node);
  for (const child of node.children ?? []) collectFiles(child, out);
  return out;
}

function TreeEntry({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: ConsoleNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);

  if (node.type === "file") {
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className={cn(
          "focus-ring flex w-full items-center gap-1.5 rounded-xs py-[3px] pr-2 text-left transition-colors",
          selected === node.path
            ? "bg-surface-3 text-ink"
            : "text-ink-3 hover:bg-surface-2 hover:text-ink-2",
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={node.path}
      >
        <File size={10} className="shrink-0 text-ink-4" />
        <span className="min-w-0 flex-1 truncate text-[11px]">{node.name}</span>
        {node.bytes !== undefined ? (
          <span className="mono shrink-0 text-[8.5px] text-ink-4">
            {node.bytes > 1024 ? `${Math.round(node.bytes / 1024)}k` : node.bytes}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`Folder ${node.name || "workspace"}`}
        className="focus-ring flex w-full items-center gap-1 rounded-xs py-[3px] pr-2 text-left text-ink-3 hover:bg-surface-2 hover:text-ink-2"
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        <ChevronRight
          size={9}
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        />
        {open ? (
          <FolderOpen size={10} className="shrink-0 text-ink-4" />
        ) : (
          <Folder size={10} className="shrink-0 text-ink-4" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px]">{node.name || "workspace"}</span>
        <span className="mono shrink-0 text-[8.5px] text-ink-4">
          {node.children?.length ?? 0}
        </span>
      </button>
      {open
        ? (node.children ?? []).map((child) => (
            <TreeEntry
              key={child.path || child.name}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

export function AgentConsole({
  agentId,
  agentName,
  role,
  status,
  summary,
  model,
  dataClass,
  initialTree,
  root,
  toolCalls,
  toolCallRunId,
  recentRun,
  budgets,
  workflowHref,
  githubHint,
}: {
  agentId: string;
  agentName: string;
  role: string;
  status: string;
  summary: string;
  model: string;
  dataClass: string;
  initialTree: ConsoleNode;
  root: string;
  toolCalls: ConsoleToolCall[];
  toolCallRunId: string | null;
  recentRun: ConsoleRun | null;
  budgets: { runUsd: number | null; dayUsd: number | null; spentTodayUsd: number };
  workflowHref?: string;
  githubHint?: { repo: string; branch: string } | null;
}) {
  const router = useRouter();
  const [tree, setTree] = useState<ConsoleNode>(initialTree);
  // Derived from the live tree so the sidebar count and "files" tab stay in
  // sync after every sandbox write.
  const files = useMemo(() => collectFiles(tree), [tree]);
  const [selected, setSelected] = useState<string | null>(() => {
    const initialFiles = collectFiles(initialTree);
    return (
      initialFiles.find((file) => file.name === "README.md")?.path ??
      initialFiles[0]?.path ??
      null
    );
  });
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newPath, setNewPath] = useState<string | null>(null);
  const [goal, setGoal] = useState(
    "State what you can do inside your current grants. If you need a note, write it in the sandbox.",
  );
  const [dispatching, setDispatching] = useState(false);
  const [activityTab, setActivityTab] = useState<"tools" | "files">("tools");
  const loadSeq = useRef(0);

  const loadFile = useCallback(
    async (path: string) => {
      // Sequence reads so a slow response for an earlier click can never
      // overwrite the file shown after a later one.
      const sequence = ++loadSeq.current;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/fs?agentId=${encodeURIComponent(agentId)}&mode=read&path=${encodeURIComponent(path)}`,
        );
        if (sequence !== loadSeq.current) return;
        const payload = (await response.json()) as { content?: string; error?: string };
        if (sequence !== loadSeq.current) return;
        if (!response.ok || payload.content === undefined) {
          setError(payload.error ?? "Could not read that file.");
          return;
        }
        setSelected(path);
        setContent(payload.content);
        setDirty(false);
        setStatusLine(null);
      } catch (cause) {
        if (sequence === loadSeq.current) {
          setError((cause as Error).message || "Could not read that file.");
        }
      } finally {
        if (sequence === loadSeq.current) setLoading(false);
      }
    },
    [agentId],
  );

  useEffect(() => {
    if (selected) void loadFile(selected);
    // Only on mount: `selected` is set to the README above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/fs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, path: selected, content }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        bytes?: number;
        tree?: ConsoleNode;
        error?: string;
        github?: { ok: boolean; preview?: string; error?: string } | null;
      };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Write refused.");
        return;
      }
      if (payload.tree) setTree(payload.tree);
      setDirty(false);
      const githubLine = payload.github
        ? payload.github.ok
          ? ` · ${payload.github.preview}`
          : ` · GitHub: ${payload.github.error ?? "push failed"}`
        : "";
      setStatusLine(`saved ${payload.bytes} bytes · audited as sandbox.write${githubLine}`);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message || "Could not save that file.");
    } finally {
      setLoading(false);
    }
  }

  function createFile() {
    if (!newPath || newPath.trim().length === 0) {
      setNewPath(null);
      return;
    }
    void savePath(newPath.trim());
  }

  async function savePath(path: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/fs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, path, content: "" }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        tree?: ConsoleNode;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Could not create that file.");
        return;
      }
      if (payload.tree) setTree(payload.tree);
      setNewPath(null);
      await loadFile(path);
      setStatusLine("created");
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message || "Could not create that file.");
    } finally {
      setLoading(false);
    }
  }

  async function dispatch() {
    setDispatching(true);
    setError(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, goal, mode: "live" }),
      });
      const payload = (await response.json()) as { runId?: string; error?: string };
      if (!response.ok || !payload.runId) {
        setError(payload.error ?? "Dispatch failed.");
        return;
      }
      router.push(workflowHref ?? `/workflows/${agentId}`);
    } catch (cause) {
      setError((cause as Error).message || "Dispatch failed.");
    } finally {
      setDispatching(false);
    }
  }

  // Opening a different file would silently discard unsaved edits; ask first.
  // Same-file re-opens are allowed and just re-fetch the latest content.
  function openFile(path: string) {
    if (dirty && path !== selected && !window.confirm("Discard unsaved changes?")) return;
    void loadFile(path);
  }

  const lines = content.split("\n");
  const lineNumbers = lines.map((_, index) => index + 1);
  const runBudget = budgets.runUsd;

  return (
    <div className="bundle-grid console-grid">
      {/* Files ------------------------------------------------------------- */}
      <Panel className="flex min-h-[520px] flex-col self-start">
        <div className="flex items-center justify-between border-b border-line px-2.5 py-2">
          <span className="micro">sandbox</span>
          <button
            type="button"
            onClick={() => setNewPath("")}
            className="focus-ring rounded-xs p-0.5 text-ink-4 hover:text-ink"
            title="New file"
            aria-label="New file"
          >
            <FilePlus2 size={12} />
          </button>
        </div>
        <div className="max-h-[520px] flex-1 overflow-auto px-1.5 py-1.5">
          {files.length === 0 && newPath === null ? (
            <p className="px-2 py-6 text-[12px] leading-relaxed text-ink-4">
              {githubHint
                ? `GitHub ${githubHint.repo}@${githubHint.branch} will show under repo/ after the first sync.`
                : "Empty. Files this agent writes show up here. Link a GitHub repo on Connectors to load a codebase."}
            </p>
          ) : null}
          {newPath !== null ? (
            <div className="mb-1.5 flex items-center gap-1 px-1">
              <input
                autoFocus
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createFile();
                  if (event.key === "Escape") setNewPath(null);
                }}
                placeholder="incident/note.md"
                aria-label="New file path"
                className="focus-ring h-6 w-full rounded-xs border border-line-strong bg-surface-2 px-1.5 font-mono text-[10px] text-ink"
              />
              <button
                type="button"
                onClick={createFile}
                className="focus-ring rounded-xs p-0.5 text-accent"
                title="Create"
                aria-label="Create file"
              >
                <Save size={11} />
              </button>
              <button
                type="button"
                onClick={() => setNewPath(null)}
                className="focus-ring rounded-xs p-0.5 text-ink-4"
                title="Cancel"
                aria-label="Cancel new file"
              >
                <X size={11} />
              </button>
            </div>
          ) : null}
          {files.length > 0 ? (
            <TreeEntry
              node={tree}
              depth={0}
              selected={selected}
              onSelect={openFile}
            />
          ) : null}
        </div>
        <div className="border-t border-line px-2.5 py-2">
          <div className="mono break-all text-[8.5px] leading-relaxed text-ink-4">{root}</div>
          <div className="mono mt-1 text-[8.5px] text-ink-4">
            {files.length} files · path guard active
          </div>
        </div>
      </Panel>

      {/* Editor ------------------------------------------------------------ */}
      <Panel className="flex min-h-[520px] min-w-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <File size={11} className="shrink-0 text-ink-4" />
            <span className="mono truncate text-[10.5px] text-ink-2">
              {selected ?? "no file selected"}
            </span>
            {dirty ? <span className="size-1.5 rounded-full bg-warn" title="Unsaved changes" /> : null}
          </div>
          <div className="flex items-center gap-1.5">
            {loading ? <Loader2 size={11} className="animate-spin text-ink-4" /> : null}
            <span className="mono hidden text-[9px] text-ink-4 sm:inline">
              {lines.length} lines · {content.length} chars
            </span>
            <Button
              variant={dirty ? "primary" : "secondary"}
              size="sm"
              disabled={!selected || loading || !dirty}
              onClick={() => void save()}
            >
              <Save size={11} /> Save
            </Button>
          </div>
        </div>

        <div className="relative flex min-h-[400px] flex-1 overflow-hidden bg-void">
          <div
            aria-hidden
            className="mono select-none border-r border-line bg-surface/40 px-2 py-2 text-right text-[10.5px] leading-[1.65] text-ink-4"
          >
            {lineNumbers.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
          <textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setDirty(true);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                void save();
              }
            }}
            spellCheck={false}
            disabled={!selected}
            className="mono min-h-[400px] flex-1 resize-none bg-transparent px-3 py-2 text-[10.5px] leading-[1.65] text-ink-2 outline-none placeholder:text-ink-4"
            placeholder={
              selected ? "Select a file from the sandbox tree." : "Nothing here yet. Create a file or let the agent write one."
            }
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-1.5">
          <span
            className={cn(
              "mono text-[9.5px]",
              error ? "text-danger" : statusLine ? "text-ok" : "text-ink-4",
            )}
          >
            {error ?? statusLine ?? "every write is path-guarded and written to the audit log"}
          </span>
          <span className="mono text-[9px] text-ink-4">⌘S to save</span>
        </div>
      </Panel>

      {/* Side -------------------------------------------------------------- */}
      <div className="space-y-4">
        <Panel>
          <div className="border-b border-line px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="truncate text-[12px] font-medium text-ink">{agentName}</span>
              <StatusBadge status={status} />
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              <Tag tone={role === "security" ? "audit" : "accent"}>{role}</Tag>
              <Tag>{dataClass}</Tag>
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">{summary}</p>
          </div>
          <div className="space-y-2 px-3 py-2.5">
            <div className="flex items-center justify-between text-[10.5px]">
              <span className="text-ink-3">Routed model</span>
              <span className="mono truncate pl-2 text-ink-2">{model}</span>
            </div>
            <div className="flex items-center justify-between text-[10.5px]">
              <span className="text-ink-3">Run ceiling</span>
              <span className="mono text-ink-2">
                {runBudget ? usd(runBudget, { precise: true }) : "workspace default"}
              </span>
            </div>
            <div>
              <div className="flex items-center justify-between text-[10.5px]">
                <span className="text-ink-3">Workspace day</span>
                <span className="mono text-ink-2">
                  {usd(budgets.spentTodayUsd)} / {usd(budgets.dayUsd ?? 0)}
                </span>
              </div>
              <Meter
                value={
                  budgets.dayUsd ? budgets.spentTodayUsd / Math.max(budgets.dayUsd, 0.01) : 0
                }
                tone={
                  budgets.dayUsd && budgets.spentTodayUsd / budgets.dayUsd > 0.8
                    ? "danger"
                    : "accent"
                }
                className="mt-1"
                label="Workspace spend today"
              />
            </div>
            {recentRun ? (
              <>
                <Divider />
                <Link
                  href={`/runs/${recentRun.id}`}
                  className="focus-ring block rounded-xs border border-line bg-surface-2/50 px-2 py-1.5 hover:border-line-strong"
                >
                  <div className="mono flex items-center justify-between text-[9px] text-ink-4">
                    <span>last run</span>
                    <span>{relativeTime(recentRun.startedAt)}</span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-ink-2">
                    {recentRun.goal}
                  </div>
                  <div className="mono mt-1 flex items-center gap-2 text-[9px] text-ink-4">
                    <StatusBadge status={recentRun.status} />
                    <span>{usd(recentRun.costUsd, { precise: true })}</span>
                    <span>{tokens(recentRun.inputTokens + recentRun.outputTokens)} tok</span>
                  </div>
                </Link>
              </>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between border-b border-line px-2 py-1.5">
            <div className="flex items-center gap-1">
              {(["tools", "files"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActivityTab(tab)}
                  className={cn(
                    "focus-ring rounded-xs px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.06em]",
                    activityTab === tab ? "bg-surface-3 text-ink" : "text-ink-4 hover:text-ink-2",
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <span className="mono text-[9px] text-ink-4">
              {activityTab === "tools" ? toolCalls.length : files.length}
            </span>
          </div>
          {activityTab === "tools" ? (
            toolCalls.length === 0 ? (
              <p className="px-3 py-4 text-[10.5px] leading-relaxed text-ink-4">
                No tool calls yet.
              </p>
            ) : (
              <>
                {toolCallRunId ? (
                  <p className="mono px-3 pt-2 text-[8.5px] text-ink-4">
                    from{" "}
                    <Link href={`/runs/${toolCallRunId}`} className="text-accent hover:text-accent/80">
                      {toolCallRunId}
                    </Link>
                  </p>
                ) : null}
              <ul className="max-h-[260px] divide-y divide-line overflow-y-auto">
                {toolCalls.map((call) => (
                  <li key={call.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono flex min-w-0 items-center gap-1 text-[10px] text-ink-2">
                        <Wrench size={9} className="shrink-0 text-ink-4" />
                        <span className="truncate">{call.tool}</span>
                      </span>
                      <StatusBadge status={call.status} />
                    </div>
                    <div className="mono mt-0.5 flex items-center gap-2 text-[8.5px] text-ink-4">
                      <span>{clockTime(call.at)}</span>
                      {call.durationMs !== null ? (
                        <>
                          <span>·</span>
                          <span>{call.durationMs}ms</span>
                        </>
                      ) : null}
                    </div>
                    {call.error ? (
                      <p className="mt-1 line-clamp-2 text-[9.5px] leading-relaxed text-danger">
                        {call.error}
                      </p>
                    ) : call.preview ? (
                      <p className="mono mt-1 line-clamp-2 text-[9px] leading-relaxed text-ink-4">
                        {call.preview}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              </>
            )
          ) : (
            <ul className="max-h-[260px] divide-y divide-line overflow-y-auto">
              {files.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => openFile(file.path)}
                    className="focus-ring flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-surface-2"
                  >
                    <span className="mono truncate text-[10px] text-ink-3">{file.path}</span>
                    <span className="mono shrink-0 text-[8.5px] text-ink-4">
                      {file.bytes ?? 0}b
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <div className="border-b border-line px-3 py-2">
            <span className="panel-title">Prompt this agent</span>
          </div>
          <div className="space-y-2 p-3">
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={3}
              className="focus-ring w-full resize-y rounded-sm border border-line-strong bg-surface-2 px-2 py-1.5 text-[11px] leading-relaxed text-ink placeholder:text-ink-4"
            />
            <Button
              variant="primary"
              size="sm"
              className="w-full"
              disabled={dispatching || goal.trim().length < 8 || status !== "active"}
              onClick={() => void dispatch()}
            >
              {dispatching ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              {status === "active" ? "Dispatch" : `Agent is ${status}`}
            </Button>
            <Link
              href={`/agents/${agentId}`}
              className="focus-ring mono flex items-center justify-center gap-1 text-[9.5px] text-ink-4 hover:text-ink-2"
            >
              <Terminal size={9} /> full profile & policy
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}
