"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronDown } from "@/components/icons";
import type { HomeRun, HomeView, StepState } from "@/lib/views";
import { LogStream } from "./log-stream";
import { StartRun } from "./start-run";
import { useAutoRefresh } from "./use-auto-refresh";

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
  // Hide these items now instead of after the hour. Run history is untouched.
  function hideNow(ids: string[]) {
    const next = { ...checked };
    for (const id of ids) next[id] = 1;
    setChecked(next);
    try {
      localStorage.setItem(checkedKey, JSON.stringify(next));
    } catch {}
  }
  const hidden = (id: string) => !!checked[id] && now - checked[id] > hideAfter;
  return [checked, toggle, hidden, hideNow] as const;
}

const stateLabel: Record<StepState, string> = {
  done: "Done",
  working: "Working",
  next: "Next",
  failed: "Stopped",
};

export function Home({ data }: { data: HomeView }) {
  const router = useRouter();
  const [open, setOpen] = useState<string[]>([]),
    [deciding, setDeciding] = useState<string | null>(null),
    [error, setError] = useState(""),
    [checked, toggleChecked, hidden, hideNow] = useChecked();
  const finished = data.finished.filter((f) => !hidden(f.id));
  const crossedOff = finished.filter((f) => checked[f.id]).map((f) => f.id);

  // Live runs change quickly; re-read the page while any are active.
  useAutoRefresh(data.running.length > 0, 3000);

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
              />
            ))
          ) : (
            <p className="empty">Nothing is running.</p>
          )}
        </section>

        <aside className="home-side">
          <section className="home-panel" aria-labelledby="finished-title">
            <div className="section-head">
              <h2 id="finished-title">Finished today</h2>
              {/* Always shown: green when it can act, grey when there is nothing to do. */}
              <div className="section-head-actions">
                <button
                  type="button"
                  className="clear-btn"
                  disabled={crossedOff.length === 0}
                  onClick={() => hideNow(crossedOff)}
                  title="Remove the crossed-off tasks. Run history stays."
                >
                  Declutter
                </button>
                <button
                  type="button"
                  className="clear-btn"
                  disabled={finished.length === 0}
                  onClick={() => hideNow(finished.map((f) => f.id))}
                  title="Remove every task from this list. Run history stays."
                >
                  Clear
                </button>
              </div>
            </div>
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
                      <small className={f.stopped ? "stopped" : ""}>
                        {f.result}
                        {f.detail ? ` · ${f.detail}` : ""}
                      </small>
                    </label>
                    <Link href={`/runs/${f.id}`} className="check-link">
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">{data.finished.length ? "All clear." : "Nothing finished yet today."}</p>
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
}: {
  run: HomeRun;
  open: boolean;
  onToggle: () => void;
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
          {run.history.length > 0 && (
            <LogStream rows={run.history} limit={8} />
          )}
          {run.draft && (
            <div className="log-draft" aria-live="polite">
              <span>{run.draft.who} is writing</span>
              <p>{run.draft.text.slice(0, 180)}</p>
            </div>
          )}
          <div className="run-bar-foot">
            <Link href={`/workflows/${run.agentId}`} className="btn primary">
              Open map
              <ArrowUpRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </article>
  );
}
