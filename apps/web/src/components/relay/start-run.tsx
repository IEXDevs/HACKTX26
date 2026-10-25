"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Play, X } from "@/components/icons";

export interface RunnableAgent {
  id: string;
  name: string;
  status: string;
  /** First task drafted with the agent. Prefills the goal. */
  defaultGoal?: string;
}

/** "New run": pick an agent, describe the goal, and start it through POST /api/runs. */
export function StartRun({
  agents,
  initialAgentId,
  label = "New run",
  className = "btn primary",
}: {
  agents: RunnableAgent[];
  initialAgentId?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const ready = agents.filter((a) => a.status === "active");
  const goalFor = (id: string) => ready.find((a) => a.id === id)?.defaultGoal ?? "";
  const firstId = initialAgentId ?? ready[0]?.id ?? "";
  const [open, setOpen] = useState(false),
    [agentId, setAgentId] = useState(firstId),
    [goal, setGoal] = useState(goalFor(firstId)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Ask for live inference; the server falls back to scripted when no live gateway is set.
        body: JSON.stringify({ agentId, goal: goal.trim(), mode: "live" }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "The run could not start.");
      setOpen(false);
      setGoal(goalFor(agentId));
      router.push(`/runs/${value.runId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Play size={15} aria-hidden />
        {label}
      </button>
      {open && (
        <div className="dialog-backdrop" onClick={() => setOpen(false)}>
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Start a run"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (agentId && goal.trim().length >= 8) void start();
            }}
          >
            <div className="toolbar">
              <h2>Start a run</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <label className="field">
              Agent
              <select
                value={agentId}
                onChange={(e) => {
                  const next = e.target.value;
                  // Swap the prefill only if the person has not written their own goal.
                  if (!goal.trim() || goal === goalFor(agentId)) setGoal(goalFor(next));
                  setAgentId(next);
                }}
              >
                {ready.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              What should it do?
              <textarea
                value={goal}
                maxLength={4000}
                placeholder="Describe the task in a sentence or two."
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            {error && <p className="error-text">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={busy || !agentId || goal.trim().length < 8}
              >
                {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : null}
                Start run
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
