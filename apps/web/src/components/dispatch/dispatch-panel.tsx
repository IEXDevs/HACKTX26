"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Play, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

export interface DispatchAgentOption {
  id: string;
  name: string;
  role: string;
  status: string;
  dataClass: string;
  runBudgetUsd: number | null;
  /** Goal drafted with the agent. */
  defaultGoal?: string;
}

/** Only a goal someone wrote for this agent. Nothing is invented as a starting point. */
function goalFor(option: DispatchAgentOption | undefined): string {
  const stored = option?.defaultGoal?.trim();
  return stored && stored.length >= 8 ? stored : "";
}

export function DispatchPanel({
  agents,
  defaultAgentId,
  compact = false,
  className,
}: {
  agents: DispatchAgentOption[];
  defaultAgentId?: string;
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [agentId, setAgentId] = useState(defaultAgentId ?? agents[0]?.id ?? "");
  const agent = agents.find((option) => option.id === agentId);
  const [goal, setGoal] = useState(() => goalFor(agent));
  const [budget, setBudget] = useState<string>(
    agent?.runBudgetUsd ? String(agent.runBudgetUsd) : "2.5",
  );
  const [mode, setMode] = useState<"scripted" | "live">("live");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const disabled = agents.length === 0 || submitting || pending;

  async function dispatch() {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId,
          goal,
          budgetUsd: Number(budget) > 0 ? Number(budget) : undefined,
          mode,
        }),
      });
      const payload = (await response.json()) as { runId?: string; error?: string };
      if (!response.ok || !payload.runId) {
        setError(payload.error ?? `Dispatch failed (HTTP ${response.status}).`);
        return;
      }
      startTransition(() => {
        router.push(`/runs/${payload.runId}`);
        router.refresh();
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="micro mb-1 block">Root agent</span>
          <select
            value={agentId}
            onChange={(event) => {
              const next = event.target.value;
              setAgentId(next);
              const option = agents.find((a) => a.id === next);
              setGoal(goalFor(option));
              setBudget(option?.runBudgetUsd ? String(option.runBudgetUsd) : "2.5");
            }}
            className="focus-ring h-8 w-full rounded-sm border border-line-strong bg-surface-2 px-2 text-[12px] text-ink"
          >
            {agents.map((option) => (
              <option key={option.id} value={option.id} disabled={option.status !== "active"}>
                {option.name}
                {option.status !== "active" ? ` (${option.status})` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="micro mb-1 block">Run ceiling</span>
            <div className="relative">
              <span className="mono pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-4">
                $
              </span>
              <input
                value={budget}
                onChange={(event) => setBudget(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className="focus-ring h-8 w-full rounded-sm border border-line-strong bg-surface-2 pl-5 pr-2 font-mono text-[12px] text-ink"
              />
            </div>
          </label>
          <label className="block">
            <span className="micro mb-1 block">Planner</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as "scripted" | "live")}
              className="focus-ring h-8 w-full rounded-sm border border-line-strong bg-surface-2 px-2 text-[12px] text-ink"
              title="Live mode needs MODEL_GATEWAY and a provider key; otherwise the run falls back to the scripted planner."
            >
              <option value="scripted">scripted</option>
              <option value="live">live</option>
            </select>
          </label>
        </div>
      </div>

      <label className="block">
        <span className="micro mb-1 block">Goal</span>
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          rows={compact ? 3 : 4}
          className="focus-ring w-full resize-y rounded-sm border border-line-strong bg-surface-2 px-2.5 py-2 text-[12px] leading-relaxed text-ink placeholder:text-ink-4"
          placeholder="State the outcome, not the steps. The orchestrator decomposes it."
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] leading-relaxed text-ink-4">
          {agent?.dataClass ? `${agent.dataClass} data · ` : ""}
          every tool call is policy-checked and recorded
        </span>
        <Button variant="primary" onClick={dispatch} disabled={disabled || goal.trim().length < 8}>
          {submitting || pending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Play size={13} />
          )}
          {submitting || pending ? "Dispatching" : "Dispatch run"}
        </Button>
      </div>

      {error ? (
        <p className="rounded-xs border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
