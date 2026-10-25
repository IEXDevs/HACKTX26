"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, LoaderCircle, Play, Square } from "@/components/icons";
import { GraphSpace } from "@/components/graph/graph-space";
import type { GraphSnapshot } from "@/lib/graph-data";
import type { WorkflowView } from "@/lib/views";
import { canArchiveAgent } from "@/lib/required-agents";
import { WorkspaceContextPanel } from "./workspace-context";

/**
 * One workflow page. The map stays on screen while a run is live so the team
 * is visible as subagents appear. Click an agent on the map to read its log.
 */
export function Workflow({
  workflow,
  graph,
  context,
  runId,
  run,
}: {
  workflow: WorkflowView;
  graph: GraphSnapshot | null;
  context: { content: string; stub: boolean };
  runId: string | null;
  /** Historical run log, only when the URL asked for a specific run. */
  run: ReactNode;
}) {
  const router = useRouter();
  const [task, setTask] = useState(workflow.task || ""),
    [runningGoal, setRunningGoal] = useState(""),
    [startedRunId, setStartedRunId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [stopping, setStopping] = useState(false),
    [error, setError] = useState("");
  const archived = workflow.status === "archived";
  const on = workflow.status === "active";
  const liveId = startedRunId ?? workflow.liveRunId;
  const live = Boolean(liveId) && (!runId || runId === liveId);

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
    const goal = task.trim();
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: workflow.id, goal, mode: "live" }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "The run could not start.");
    setStartedRunId(value.runId);
    setRunningGoal(goal);
    setTask("");
    router.refresh();
  }
  async function stop() {
    const id = liveId;
    if (!id) return;
    setStopping(true);
    setError("");
    try {
      const response = await fetch(`/api/runs/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error ?? "Could not stop the run.");
      setStartedRunId(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="page">
      <div className="composer-bar">
        <Link href="/workflows" className="glass-pill">
          <ArrowLeft size={16} aria-hidden />
          Workflows
        </Link>
        <div className="composer-bar-end">
          <div className="btn-group">
            {live ? (
              <button
                className="btn danger"
                disabled={stopping || busy}
                onClick={() => void stop()}
              >
                <Square size={14} aria-hidden />
                {stopping ? "Stopping" : "Force stop"}
              </button>
            ) : null}
            {(archived || canArchiveAgent(workflow.id)) && <button
              className="btn"
              disabled={busy}
              onClick={() => void act(() => setStatus([workflow.id], archived ? "active" : "archived"))}
            >
              <Archive size={15} aria-hidden />
              {archived ? "Restore" : "Archive"}
            </button>}
          </div>
        </div>
      </div>

      <div className="page-top" style={{ marginTop: 24, marginBottom: 8 }}>
        <div>
          <h1>{workflow.name}</h1>
        </div>
      </div>

      {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}

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

      {live ? (
        <div className="wf-live">
          <div>
            <b>Running</b>
            <small>{runningGoal || workflow.task || graph?.now || "The team is working."}</small>
          </div>
          {liveId ? (
            <Link href={`/runs/${liveId}`} className="btn small">
              Open run log
            </Link>
          ) : null}
        </div>
      ) : (
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
      )}

      <WorkspaceContextPanel initial={context} defaultOpen={false} />

      {graph ? (
        <div className={"wf-graph" + (live ? " live" : "")}>
          <GraphSpace
            workflowId={workflow.id}
            agents={graph.agents}
            tasks={graph.tasks}
            flows={graph.flows}
          />
        </div>
      ) : null}

      {runId && run ? (
        <details className="wf-run-log">
          <summary>Selected run log</summary>
          <div>{run}</div>
        </details>
      ) : null}
    </div>
  );
}
