"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CalendarClock, Loader2, MessageSquarePlus, Radio, Zap } from "lucide-react";
import { cn } from "@/lib/cn";

export interface TriggerPreset {
  triggerId: string;
  kind: "manual" | "schedule" | "webhook";
  label: string;
  hint: string;
  agentId: string;
  agentName: string;
  goal: string;
  disabled: boolean;
}

const ICON = {
  manual: MessageSquarePlus,
  webhook: Radio,
  schedule: CalendarClock,
} as const;

/**
 * The three ways a run starts, one click from every screen.
 *
 * Manual is a typed request; webhook replays a real event payload; schedule is
 * the same entry point cron uses. All three call the one run API, so the trace,
 * budget and approval behaviour are identical whichever door was used.
 */
export function TriggerMenu({ presets }: { presets: TriggerPreset[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function fire(preset: TriggerPreset) {
    setBusyId(preset.triggerId);
    setError(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: preset.agentId,
          goal: preset.goal,
          triggerId: preset.triggerId,
          mode: "scripted",
        }),
      });
      const payload = (await response.json()) as { runId?: string; error?: string };
      if (!response.ok || !payload.runId) {
        setError(payload.error ?? `Trigger failed (HTTP ${response.status}).`);
        return;
      }
      setOpen(false);
      router.push(`/runs/${payload.runId}`);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "focus-ring flex h-7 items-center gap-1.5 rounded-xs border px-2 font-mono text-[10px] transition-colors",
          open
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink",
        )}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Zap size={11} />
        trigger
      </button>

      {open ? (
        <div className="animate-fade-up absolute right-0 top-9 z-50 w-[320px] overflow-hidden rounded-md border border-line-strong bg-surface shadow-2xl">
          <div className="border-b border-line px-3 py-2">
            <div className="micro">Start a run</div>
            <p className="mt-0.5 text-[10px] leading-relaxed text-ink-4">
              One runtime, three entry points. Every run is budgeted and policy-gated.
            </p>
          </div>
          <ul className="py-1" role="menu">
            {presets.map((preset) => {
              const Icon = ICON[preset.kind] ?? Zap;
              const busy = busyId === preset.triggerId;
              return (
                <li key={preset.triggerId}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={preset.disabled || busy}
                    onClick={() => void fire(preset)}
                    className={cn(
                      "focus-ring flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors",
                      preset.disabled
                        ? "cursor-not-allowed opacity-45"
                        : "hover:bg-surface-2",
                    )}
                  >
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-xs border border-line bg-surface-2 text-ink-3">
                      {busy ? <Loader2 size={10} className="animate-spin" /> : <Icon size={11} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[11.5px] text-ink">{preset.label}</span>
                        <span className="mono text-[8.5px] uppercase tracking-[0.08em] text-ink-4">
                          {preset.kind}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-ink-3">
                        {preset.agentName} · {preset.hint}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {error ? (
            <p
              role="alert"
              className="border-t border-danger/30 bg-danger/10 px-3 py-1.5 text-[10px] leading-relaxed text-danger"
            >
              {error}
            </p>
          ) : null}
          <div className="border-t border-line px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/graph");
              }}
              className="focus-ring mono flex w-full items-center justify-center gap-1 text-[9.5px] text-accent hover:text-accent/80"
            >
              open dispatch console for a custom request →
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
