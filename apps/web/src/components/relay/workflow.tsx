"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Bot, LoaderCircle, Play, Users } from "@/components/icons";
import type { WorkflowNode, WorkflowView } from "@/lib/views";
import { AdvancedSwitch, useAdvanced } from "./advanced";

function countTeam(node: WorkflowNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countTeam(child), 0);
}
function findNode(node: WorkflowNode, id: string): WorkflowNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * One workflow page. The draft view shows the team as a tree and runs the task.
 * Picking a run from the history shows that run in place.
 */
export function Workflow({
  workflow,
  runId,
  run,
}: {
  workflow: WorkflowView;
  runId: string | null;
  /** The selected run, rendered by the server. */
  run: ReactNode;
}) {
  const router = useRouter();
  const [advanced, toggleAdvanced] = useAdvanced(),
    [task, setTask] = useState(workflow.task),
    [picked, setPicked] = useState(workflow.tree.id),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const archived = workflow.status === "archived";
  const on = workflow.status === "active";
  const team = countTeam(workflow.tree);
  const node = findNode(workflow.tree, picked) ?? workflow.tree;
  const base = `/workflows/${workflow.id}`;

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function setStatus(ids: string[], status: string) {
    for (const id of ids) {
      const response = await fetch(`/api/agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const value = await response.json().catch(() => ({}));
        throw new Error(value.error ?? "The workflow was not changed.");
      }
    }
    router.refresh();
  }
  async function start() {
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: workflow.id, goal: task.trim(), mode: "live" }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "The run could not start.");
    router.push(`${base}?run=${value.runId}`);
    router.refresh();
  }

  return (
    <div className="page">
      <div className="composer-bar">
        <Link href="/workflows" className="glass-pill">
          <ArrowLeft size={16} aria-hidden />
          Workflows
        </Link>
        <div className="composer-bar-end">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
          {workflow.runs.length > 0 && (
            <label className="wf-history">
              <span className="sr-only">Run history</span>
              <select
                value={runId ?? ""}
                onChange={(e) => router.push(e.target.value ? `${base}?run=${e.target.value}` : base)}
              >
                <option value="">Draft</option>
                {workflow.runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.when} · {r.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="btn"
            disabled={busy}
            onClick={() => void act(() => setStatus([workflow.id], archived ? "active" : "archived"))}
          >
            <Archive size={15} aria-hidden />
            {archived ? "Restore" : "Archive"}
          </button>
        </div>
      </div>

      <div className="page-top" style={{ marginTop: 24, marginBottom: 8 }}>
        <div>
          <h1>{workflow.name}</h1>
          <p className="wf-meta">
            {team ? `Team of ${team + 1} agents` : "Single agent"} · {workflow.runs.length}{" "}
            {workflow.runs.length === 1 ? "run" : "runs"}
          </p>
        </div>
      </div>

      {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}

      {runId ? (
        <>
          <button className="link-btn" style={{ marginTop: 8 }} onClick={() => router.push(base)}>
            Back to draft
          </button>
          <div style={{ marginTop: 12 }}>{run}</div>
        </>
      ) : (
        <>
          {!on && !archived && (
            <div className="callout">
              <div>
                <b>This workflow is off.</b>
              </div>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() => void act(() => setStatus(workflow.agentIds, "active"))}
              >
                Turn on
              </button>
            </div>
          )}

          <form
            className="wf-command"
            onSubmit={(e) => {
              e.preventDefault();
              if (on && task.trim().length >= 8) void act(start);
            }}
          >
            <label className="field" style={{ margin: 0 }}>
              Task
              <textarea
                value={task}
                maxLength={4000}
                placeholder="Give this workflow a task…"
                onChange={(e) => setTask(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="btn primary"
              disabled={busy || !on || task.trim().length < 8}
            >
              {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <Play size={15} aria-hidden />}
              Run
            </button>
          </form>

          <div className="wf-stage">
            <div className="wf-canvas">
              <div className="wf-tree">
                <span className="wf-you">You</span>
                <ul>
                  <Branch node={workflow.tree} picked={picked} pick={setPicked} />
                </ul>
              </div>
            </div>
            <aside className="wf-panel">
              <h3>{node.name}</h3>
              {node.job && <p>{node.job}</p>}
              <small>Instructions</small>
              <p>{node.instructions}</p>
              <small>Can use</small>
              <p>{node.tools.length ? node.tools.join(", ") : "Text only"}</p>
              {advanced && (
                <Link href={`/agents/${node.id}`} className="link-btn">
                  Open agent
                </Link>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function Branch({
  node,
  picked,
  pick,
}: {
  node: WorkflowNode;
  picked: string;
  pick: (id: string) => void;
}) {
  const Icon = node.children.length ? Users : Bot;
  return (
    <li>
      <button
        type="button"
        className="wf-node"
        aria-pressed={picked === node.id}
        onClick={() => pick(node.id)}
      >
        <span className="wf-node-icon" aria-hidden>
          <Icon size={18} />
        </span>
        <b>{node.name}</b>
        {node.role === "security" && <small>Security check</small>}
      </button>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Branch key={child.id} node={child} picked={picked} pick={pick} />
          ))}
        </ul>
      )}
    </li>
  );
}
