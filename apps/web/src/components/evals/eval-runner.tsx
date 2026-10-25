"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, FlaskConical, Loader2 } from "lucide-react";
import { StatusBadge, buttonClass } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { pct } from "@/lib/format";

interface EvalCaseResult {
  caseId: string;
  name: string;
  input: string;
  expectedTools: string[];
  observedTools: string[];
  missingTools: string[];
  matchedRunId: string | null;
  coverage: number;
  passed: boolean;
  note: string;
}

interface EvalRunResult {
  row: {
    id: string;
    toolCallAccuracy: number;
    taskSuccess: number;
    interventionRate: number;
    casesPassed: number;
    casesTotal: number;
    status: string;
  };
  cases: EvalCaseResult[];
  matchedRuns: number;
}

export function EvalRunner({ suiteId }: { suiteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EvalRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    // Drop the previous result immediately so a re-run never leaves the old
    // score on screen as if it were the fresh one.
    setResult(null);
    setError(null);
    try {
      const response = await fetch("/api/evals/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suiteId }),
      });
      const payload = (await response.json()) as EvalRunResult & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? `Eval failed (HTTP ${response.status}).`);
        return;
      }
      setResult(payload);
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <span className="text-[10px] leading-relaxed text-ink-4">
          Scores the newest recorded traces for this agent. No runs, no score.
        </span>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className={buttonClass("secondary", "sm")}
        >
          {busy ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <FlaskConical size={11} />
          )}
          {busy ? "Scoring" : "Run eval"}
        </button>
      </div>

      {error ? (
        <p className="mx-4 mb-3 rounded-xs border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="animate-fade-up border-t border-line bg-surface-2/40">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            <StatusBadge status={result.row.status} />
            <span className="mono text-[10px] text-ink-2">
              tool accuracy {pct(result.row.toolCallAccuracy)}
            </span>
            <span className="mono text-[10px] text-ink-3">
              {result.row.casesPassed}/{result.row.casesTotal} cases
            </span>
            <span className="mono text-[10px] text-ink-4">
              {result.matchedRuns} trace{result.matchedRuns === 1 ? "" : "s"} matched
            </span>
            <span className="mono ml-auto text-[9px] text-ink-4">{result.row.id}</span>
          </div>
          <ul className="divide-y divide-line/70">
            {result.cases.map((testCase) => (
              <li key={testCase.caseId} className="px-4 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        testCase.passed ? "bg-ok" : "bg-danger",
                      )}
                    />
                    <span className="truncate text-[11px] text-ink-2">{testCase.name}</span>
                  </span>
                  <span className="mono shrink-0 text-[9.5px] text-ink-4">
                    {Math.round(testCase.coverage * 100)}%
                  </span>
                </div>
                <div className="mono mt-0.5 flex flex-wrap items-center gap-1.5 pl-3 text-[9px] text-ink-4">
                  <span>{testCase.note}</span>
                  {testCase.matchedRunId ? (
                    <Link
                      href={`/runs/${testCase.matchedRunId}`}
                      className="focus-ring flex items-center gap-0.5 text-accent hover:text-accent/80"
                    >
                      trace <ArrowUpRight size={8} />
                    </Link>
                  ) : null}
                </div>
                {testCase.missingTools.length > 0 ? (
                  <div className="mono mt-0.5 pl-3 text-[9px] text-danger/80">
                    missing: {testCase.missingTools.join(", ")}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
