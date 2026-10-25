"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlaskConical, LoaderCircle, Play, ShieldCheck } from "@/components/icons";
import { AdvancedSwitch, useAdvanced } from "./advanced";

export interface SuiteCard {
  id: string;
  name: string;
  description: string;
  agentId: string;
  agent: string;
  passed: number;
  total: number;
  status: "passed" | "failed" | "never";
  when: string;
  accuracy: number[];
  toolAccuracy: number;
  taskSuccess: number;
  intervention: number;
  cases: string[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function EvalsView({
  suites,
  totals,
  healable,
}: {
  suites: SuiteCard[];
  totals: { toolAccuracy: number; taskSuccess: number; intervention: number };
  healable: number;
}) {
  const router = useRouter();
  const [advanced, toggleAdvanced] = useAdvanced(),
    [busy, setBusy] = useState<string | null>(null),
    [note, setNote] = useState(""),
    [error, setError] = useState("");

  async function post(key: string, url: string, body: unknown, done: (v: any) => string) {
    setBusy(key);
    setError("");
    setNote("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error ?? "That did not work.");
      setNote(done(value));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <div className="page-top">
        <h1>Evaluations</h1>
        <div className="page-actions">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
        </div>
      </div>

      <dl className="stats">
        <div>
          <dt>Uses the right tools</dt>
          <dd>{pct(totals.toolAccuracy)}</dd>
        </div>
        <div>
          <dt>Finishes the task</dt>
          <dd>{pct(totals.taskSuccess)}</dd>
        </div>
        <div>
          <dt>Needs a person</dt>
          <dd>{pct(totals.intervention)}</dd>
        </div>
      </dl>

      {(healable > 0 || note || error) && (
        <div className="callout">
          <span className="callout-icon" aria-hidden>
            <ShieldCheck size={20} />
          </span>
          <div>
            {note ? (
              <b>{note}</b>
            ) : error ? (
              <b className="stopped">{error}</b>
            ) : (
              <>
                <b>
                  {healable} serious {healable === 1 ? "issue" : "issues"} can become guardrails
                </b>
                <small>Each one becomes a locked rule that every agent follows.</small>
              </>
            )}
          </div>
          {healable > 0 && !note && (
            <button
              className="btn primary"
              disabled={busy === "heal"}
              onClick={() =>
                post("heal", "/api/evals/autoheal", { limit: Math.min(healable, 10) }, (v) =>
                  v.healedCount
                    ? `Added ${v.healedCount} ${v.healedCount === 1 ? "guardrail" : "guardrails"}`
                    : (v.message ?? "Nothing to add"),
                )
              }
            >
              {busy === "heal" && <LoaderCircle size={15} className="animate-spin" />}
              Add guardrails
            </button>
          )}
        </div>
      )}

      <section className="section">
        <h2>Test suites</h2>
        {suites.length ? (
          <div className="tile-grid">
            {suites.map((s) => (
              <article className="tile" key={s.id}>
                <div className="tile-main">
                  <span
                    className={`tile-status ${s.status === "failed" ? "stopped" : s.status === "passed" ? "running" : ""}`}
                  >
                    {s.status === "passed" ? "Passing" : s.status === "failed" ? "Failing" : "Not run yet"}
                  </span>
                  <b>{s.name}</b>
                  <p>
                    <Link href={`/agents/${s.agentId}`}>{s.agent}</Link>
                    {s.total ? ` · ${s.passed} of ${s.total} cases pass` : ""}
                  </p>
                  {s.accuracy.length > 1 && <Spark values={s.accuracy} />}
                  {advanced && (
                    <p className="detail">
                      Tools {pct(s.toolAccuracy)} · Task {pct(s.taskSuccess)} · Person{" "}
                      {pct(s.intervention)}
                      <br />
                      {s.cases.join(" · ")}
                    </p>
                  )}
                </div>
                <footer className="tile-foot">
                  <span>{s.when}</span>
                  <button
                    className="btn small"
                    disabled={busy === s.id}
                    onClick={() =>
                      post(s.id, "/api/evals/run", { suiteId: s.id }, (v) =>
                        `${s.name}: ${v.casesPassed ?? "?"} of ${v.casesTotal ?? "?"} cases pass`,
                      )
                    }
                  >
                    {busy === s.id ? (
                      <LoaderCircle size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    Run
                  </button>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty">
            <FlaskConical size={16} style={{ display: "inline", marginRight: 6 }} />
            No test suites yet.
          </p>
        )}
      </section>
    </div>
  );
}

/** A tiny trend line of tool accuracy, oldest to newest. */
function Spark({ values }: { values: number[] }) {
  const w = 120,
    h = 28;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - v * (h - 4)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="spark" role="img" aria-label="Accuracy over recent runs">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
