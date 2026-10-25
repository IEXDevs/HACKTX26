"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2, Wand2 } from "lucide-react";
import { Button, RiskTag } from "@/components/ui/primitives";

interface OpenFinding {
  id: string;
  title: string;
  category: string;
  severity: string;
}

interface HealResult {
  findingId: string;
  title: string;
  promptBlockId: string;
  promptBlockName: string;
  version: number;
  attachedTo: number;
}

export function AutoHealPanel({ findings }: { findings: OpenFinding[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [healed, setHealed] = useState<HealResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function heal() {
    setRunning(true);
    setError(null);
    setHealed(null);
    try {
      const response = await fetch("/api/evals/autoheal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Heal everything the panel lists, capped at the API's per-call max.
        body: JSON.stringify({ limit: Math.min(findings.length, 10) }),
      });
      const payload = (await response.json()) as {
        healed?: HealResult[];
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? `Auto-heal failed (HTTP ${response.status}).`);
        return;
      }
      setHealed(payload.healed ?? []);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      {findings.length === 0 ? (
        <p className="text-[10.5px] leading-relaxed text-ink-4">
          No open high or critical findings. The guardrail stack is current.
        </p>
      ) : (
        <ul className="space-y-2">
          {findings.map((finding) => (
            <li key={finding.id} className="rounded-xs border border-line bg-surface-2/40 px-2 py-1.5">
              <div className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-[10.5px] leading-snug text-ink-2">
                  {finding.title}
                </span>
                <RiskTag risk={finding.severity} />
              </div>
              <div className="mono mt-0.5 text-[8.5px] text-ink-4">
                {finding.category.replaceAll("_", " ")}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="primary"
        size="sm"
        className="w-full"
        disabled={running || findings.length === 0}
        onClick={() => void heal()}
      >
        {running ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
        {running ? "Synthesizing guardrails" : "Evaluate & auto-heal"}
      </Button>

      <p className="text-[9.5px] leading-relaxed text-ink-4">
        Creates a locked org prompt block per finding, attaches it to every agent, and marks the
        finding fixed. The next run resolves it through the normal prompt assembler.
      </p>

      {error ? (
        <p
          role="alert"
          className="rounded-xs border border-danger/30 bg-danger/10 px-2 py-1.5 text-[10px] leading-relaxed text-danger"
        >
          {error}
        </p>
      ) : null}

      {healed ? (
        healed.length === 0 ? (
          <p className="mono text-[10px] text-ink-4">Nothing to heal.</p>
        ) : (
          <ul className="space-y-1.5">
            {healed.map((result) => (
              <li
                key={result.findingId}
                className="rounded-xs border border-ok/25 bg-ok/[0.06] px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5 text-[10px] text-ok">
                  <Check size={10} />
                  <span className="truncate">{result.promptBlockName}</span>
                </div>
                <div className="mono mt-0.5 text-[8.5px] text-ink-4">
                  v{result.version} · attached to {result.attachedTo} agent
                  {result.attachedTo === 1 ? "" : "s"}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
