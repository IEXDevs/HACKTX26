"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Square } from "@/components/icons";
import type { RunLive } from "@/lib/views";
import { plainText } from "@/lib/plain-text";
import { LogStream } from "./log-stream";
import { useAutoRefresh } from "./use-auto-refresh";

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

/** Plain run view. */
export function RunView({
  run,
  embedded = false,
}: {
  run: RunViewData;
  /** Drops the back bar and title, for pages that show the run inside their own header. */
  embedded?: boolean;
}) {
  const router = useRouter();
  const [deciding, setDeciding] = useState<string | null>(null),
    [stopping, setStopping] = useState(false),
    [error, setError] = useState("");
  const waiting = run.approvals.length > 0;
  const history = run.history ?? [];
  const live = run.active || waiting;

  useAutoRefresh(live, 3000);

  async function stop() {
    setStopping(true);
    setError("");
    try {
      const response = await fetch(`/api/runs/${run.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      if (!response.ok) {
        const value = await response.json().catch(() => ({}));
        throw new Error(value.error ?? "Could not stop the run.");
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStopping(false);
    }
  }

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
        <small>{run.active ? run.now : plainText(run.result ?? run.label)}</small>
      </span>
      <span className="run-bar-meta">
        {pct}% · {run.elapsed}
      </span>
    </>
  );

  return (
    <div className={embedded ? undefined : "page"}>
      {!embedded && (
        <>
          <div className="composer-bar">
            <Link href="/runs" className="glass-pill">
              <ArrowLeft size={16} aria-hidden />
              Runs
            </Link>
            {live ? (
              <div className="composer-bar-end">
                <button className="btn danger" disabled={stopping} onClick={() => void stop()}>
                  <Square size={14} aria-hidden />
                  {stopping ? "Stopping" : "Force stop"}
                </button>
              </div>
            ) : null}
          </div>
          <div className="page-top" style={{ marginTop: 24 }}>
            <div>
              <h1>
                <Link href={`/workflows/${run.agentId}`}>{run.name}</Link>
              </h1>
            </div>
          </div>
        </>
      )}
      {embedded && live ? (
        <div className="composer-bar-end" style={{ justifyContent: "flex-end", margin: "8px 0 0" }}>
          <button className="btn danger" disabled={stopping} onClick={() => void stop()}>
            <Square size={14} aria-hidden />
            {stopping ? "Stopping" : "Force stop"}
          </button>
        </div>
      ) : null}

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

      {(history.length > 0 || run.draft) && (
        <section className="section">
          <h2>Activity</h2>
          <div className="log-panel">
            <LogStream
              rows={history}
              empty="No events yet."
              agentHref={(id) => `/agents/${id}/trail`}
            />
            {run.draft && (
              <div className="log-draft" aria-live="polite">
                <span>{run.draft.who} is writing</span>
                <p>{plainText(run.draft.text).slice(0, 280)}</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
