"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronDown } from "@/components/icons";
import type { HomeRun, HomeView, StepState } from "@/lib/views";
import { AdvancedSwitch, useAdvanced } from "./advanced";
import { StartRun } from "./start-run";

// Checked-off finished items hide from Home an hour after checking. Run history is untouched.
const checkedKey = "relay-home-checked";
const hideAfter = 60 * 60 * 1000;
function useChecked() {
  const [checked, setChecked] = useState<Record<string, number>>({}),
    [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    try {
      setChecked(JSON.parse(localStorage.getItem(checkedKey) || "{}"));
    } catch {}
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  function toggle(id: string) {
    const next = { ...checked };
    if (next[id]) delete next[id];
    else next[id] = Date.now();
    setChecked(next);
    try {
      localStorage.setItem(checkedKey, JSON.stringify(next));
    } catch {}
  }
  const hidden = (id: string) => !!checked[id] && now - checked[id] > hideAfter;
  return [checked, toggle, hidden] as const;
}

const stateLabel: Record<StepState, string> = {
  done: "Done",
  working: "Working",
  next: "Next",
  failed: "Stopped",
};

export function Home({ data }: { data: HomeView }) {
  const router = useRouter();
  const [advanced, toggleAdvanced] = useAdvanced(),
    [open, setOpen] = useState<string[]>([]),
    [deciding, setDeciding] = useState<string | null>(null),
    [error, setError] = useState(""),
    [checked, toggleChecked, hidden] = useChecked();
  const finished = data.finished.filter((f) => !hidden(f.id));

  // Live runs change quickly; re-read the page while any are active.
  useEffect(() => {
    if (!data.running.length) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [data.running.length, router]);

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
  const toggle = (id: string) =>
    setOpen((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <div className="page">
      <div className="page-top">
        <h1>Home</h1>
        <div className="page-actions">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
          <StartRun agents={data.agents} />
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {data.needs.length > 0 && (
        <section aria-labelledby="needs-title">
          <h2 id="needs-title">Needs you · {data.needs.length}</h2>
          <div className="needs-grid">
            {data.needs.map((n) => (
              <article key={n.id} className="need-card">
                <header>
                  <span>{n.workflow}</span>
                  <span>Waiting {n.waiting}</span>
                </header>
                <h3>{n.ask}</h3>
                <p>{n.preview}</p>
                <div className="need-card-actions">
                  <button
                    className="approve"
                    disabled={deciding === n.id}
                    onClick={() => void decide(n.id, "approved")}
                  >
                    Approve
                  </button>
                  <button disabled={deciding === n.id} onClick={() => void decide(n.id, "denied")}>
                    Deny
                  </button>
                  <Link href={`/runs/${n.runId}`}>Details</Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="home-columns">
        <section className="home-running" aria-labelledby="running-title">
          <h2 id="running-title">Running · {data.running.length}</h2>
          {data.running.length ? (
            data.running.map((r) => (
              <RunBar
                key={r.id}
                run={r}
                open={open.includes(r.id)}
                onToggle={() => toggle(r.id)}
                advanced={advanced}
              />
            ))
          ) : (
            <p className="empty">Nothing is running.</p>
          )}
        </section>

        <aside className="home-side">
          <section aria-labelledby="finished-title">
            <h2 id="finished-title">Finished today</h2>
            {finished.length ? (
              <ul className="checklist">
                {finished.map((f) => (
                  <li key={f.id} className={checked[f.id] ? "done" : ""}>
                    <input
                      type="checkbox"
                      id={`done-${f.id}`}
                      checked={!!checked[f.id]}
                      onChange={() => toggleChecked(f.id)}
                    />
                    <label htmlFor={`done-${f.id}`}>
                      <b>{f.name}</b>
                      <small className={f.stopped ? "stopped" : ""}>{f.result}</small>
                      {advanced && <small className="detail">{f.detail}</small>}
                    </label>
                    <Link href={`/runs/${f.id}`} className="check-link">
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">Nothing finished yet today.</p>
            )}
          </section>
        </aside>
      </div>

      {data.scripted && (
        <p className="note">Test mode. Runs use the scripted planner, and tools run for real.</p>
      )}
    </div>
  );
}

function RunBar({
  run,
  open,
  onToggle,
  advanced,
}: {
  run: HomeRun;
  open: boolean;
  onToggle: () => void;
  advanced: boolean;
}) {
  const pct = Math.max(4, Math.round(run.progress * 100));
  const label = (
    <>
      <span className="run-bar-title">
        <b>{run.name}</b>
        <small>{run.now}</small>
      </span>
      <span className="run-bar-meta">
        {pct}% · {run.elapsed}
      </span>
    </>
  );
  return (
    <article className={"run-bar" + (open ? " open" : "")}>
      <button
        className="run-bar-track"
        aria-expanded={open}
        aria-label={`${run.name}, ${pct} percent done. ${run.now}`}
        onClick={onToggle}
      >
        <span className="run-bar-label">{label}</span>
        {/* The filled part repeats the label, clipped to the progress. */}
        <span className="run-bar-fill" style={{ width: `${pct}%` }} aria-hidden="true">
          <span className="run-bar-label" style={{ width: `${10000 / pct}%` }}>
            {label}
          </span>
        </span>
        <ChevronDown size={18} className="run-bar-chevron" aria-hidden />
      </button>
      {open && (
        <div className="run-bar-body">
          {advanced && <p className="detail">{run.goal}</p>}
          {run.steps.length > 0 && (
            <ol className="run-steps">
              {run.steps.map((s, i) => (
                <li key={i} className={s.state}>
                  <span>{s.name}</span>
                  <span>{stateLabel[s.state]}</span>
                </li>
              ))}
            </ol>
          )}
          {run.feed.length > 0 && (
            <ol className="run-feed" aria-label={`What ${run.name} has done`}>
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
          <div className="run-bar-foot">
            <Link href={`/runs/${run.id}`} className="btn primary">
              Open run
              <ArrowUpRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </article>
  );
}
