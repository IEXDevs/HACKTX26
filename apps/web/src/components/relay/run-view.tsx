"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "@/components/icons";
import type { RunLive, StepState } from "@/lib/views";
import { AdvancedSwitch, useAdvanced } from "./advanced";

export interface RunViewData extends RunLive {
  id: string;
  agentId: string;
  name: string;
  goal: string;
  label: string;
  tone: string;
  active: boolean;
  result: string | null;
  elapsed: string;
  cost: string;
  approvals: Array<{ id: string; ask: string; reason: string }>;
}

const stateLabel: Record<StepState, string> = {
  done: "Done",
  working: "Working",
  next: "Next",
  failed: "Stopped",
};

/** Plain run view. The full event trace sits behind Advanced. */
export function RunView({ run, trace }: { run: RunViewData; trace: ReactNode }) {
  const router = useRouter();
  const [advanced, toggleAdvanced] = useAdvanced(),
    [deciding, setDeciding] = useState<string | null>(null),
    [error, setError] = useState("");
  const waiting = run.approvals.length > 0;

  useEffect(() => {
    if (!run.active && !waiting) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [run.active, waiting, router]);

  async function decide(id: string, decision: "approved" | "denied") {
    setDeciding(id);
    setError("");
    try {
      const response = await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        const value = await response.json().catch(() => ({}));
        throw new Error(value.error ?? "The decision was not saved.");
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeciding(null);
    }
  }

  const pct = Math.max(4, Math.round(run.progress * 100));
  const label = (
    <>
      <span className="run-bar-title">
        <b>{run.label}</b>
        <small>{run.active ? run.now : (run.result ?? run.label)}</small>
      </span>
      <span className="run-bar-meta">
        {pct}% · {run.elapsed}
      </span>
    </>
  );

  return (
    <div className="page">
      <div className="composer-bar">
        <Link href="/runs" className="glass-pill">
          <ArrowLeft size={16} aria-hidden />
          Runs
        </Link>
        <div className="composer-bar-end">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
        </div>
      </div>

      <div className="page-top" style={{ marginTop: 24 }}>
        <div>
          <h1>
            <Link href={`/agents/${run.agentId}`}>{run.name}</Link>
          </h1>
          <p className="composer-summary" style={{ textAlign: "left", margin: "6px 0 0" }}>
            {run.goal}
          </p>
        </div>
      </div>

      <div className="run-bar">
        <div className="run-bar-track" style={{ cursor: "default" }}>
          <span className="run-bar-label">{label}</span>
          <span className="run-bar-fill" style={{ width: `${pct}%` }} aria-hidden="true">
            <span className="run-bar-label" style={{ width: `${10000 / pct}%` }}>
              {label}
            </span>
          </span>
        </div>
      </div>

      {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}

      {waiting && (
        <section className="section">
          <h2>Needs you</h2>
          <div className="needs-grid">
            {run.approvals.map((a) => (
              <article key={a.id} className="need-card" style={{ minHeight: 0 }}>
                <h3 style={{ marginTop: 0 }}>{a.ask}</h3>
                <p>{a.reason}</p>
                <div className="need-card-actions">
                  <button
                    className="approve"
                    disabled={deciding === a.id}
                    onClick={() => void decide(a.id, "approved")}
                  >
                    Approve
                  </button>
                  <button disabled={deciding === a.id} onClick={() => void decide(a.id, "denied")}>
                    Deny
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {run.result && !run.active && (
        <section className="section">
          <h2>Result</h2>
          <div className="card">
            <p className={run.tone === "stopped" ? "stopped" : ""}>{run.result}</p>
          </div>
        </section>
      )}

      {run.steps.length > 0 && (
        <section className="section">
          <h2>Steps</h2>
          <ol className="run-steps">
            {run.steps.map((s, i) => (
              <li key={i} className={s.state}>
                <span>{s.name}</span>
                <span>{stateLabel[s.state]}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(run.feed.length > 0 || run.draft) && (
        <section className="section">
          <h2>What the agents said</h2>
          <div className="card" style={{ display: "grid", gap: 16 }}>
            {run.feed.length > 0 && (
              <ol className="run-feed">
                {run.feed.map((o) => (
                  <li key={o.id}>
                    <time>{o.at}</time>
                    <div>
                      <b>{o.who}</b>
                      <p>{o.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {run.draft && (
              <div className="run-draft" aria-live="polite">
                <span>{run.draft.who} is writing</span>
                <p>
                  {run.draft.text}
                  <i className="run-caret" aria-hidden="true" />
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {advanced && (
        <section className="section">
          <h2>Full trace · {run.cost}</h2>
          {trace}
        </section>
      )}
    </div>
  );
}
