'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Plus } from 'lucide-react';
import type { HomeData, HomeRun, HomeStep } from './home-data';
import { AdvancedSwitch, useAdvanced } from './advanced';
import './simple.css';

function duration(seconds?: number) {
  if (seconds === undefined) return '';
  return seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
}
const stateLabel: Record<HomeStep['state'], string> = {
  done: 'Done',
  working: 'Working',
  next: 'Next',
};

export default function Home({
  data,
  testMode,
  onNew,
}: {
  data: HomeData;
  testMode: boolean;
  onNew: () => void;
}) {
  const [advanced, toggleAdvanced] = useAdvanced(),
    [open, setOpen] = useState<string[]>(data.running[0] ? [data.running[0].id] : []);
  const toggle = (id: string) =>
    setOpen((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  return (
    <div className="simple-page wide">
      <div className="simple-top">
        <h1>Home</h1>
        <div className="simple-actions">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
          <button className="primary" onClick={onNew}>
            <Plus size={15} />
            New workflow
          </button>
        </div>
      </div>

      {data.needs.length > 0 && (
        <section className="home-needs" aria-labelledby="needs-title">
          <h2 id="needs-title">Needs you · {data.needs.length}</h2>
          <div className="home-needs-grid">
            {data.needs.map((n) => (
              <article key={n.id} className="need-card">
                <header>
                  <span>{n.workflow}</span>
                  <span>Waiting {n.waiting}</span>
                </header>
                <h3>{n.ask}</h3>
                <p>{n.preview}</p>
                <Link href={n.href} className="need-card-action">
                  {n.action}
                </Link>
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
              <RunCard
                key={r.id}
                run={r}
                open={open.includes(r.id)}
                onToggle={() => toggle(r.id)}
                advanced={advanced}
              />
            ))
          ) : (
            <p className="simple-empty">Nothing is running.</p>
          )}
        </section>

        <aside className="home-side">
          <section aria-labelledby="finished-title">
            <h2 id="finished-title">Finished today</h2>
            {data.finished.length ? (
              <ul className="simple-list">
                {data.finished.map((f) => (
                  <li key={f.id}>
                    <div>
                      <b>{f.name}</b>
                      <small className={f.stopped ? 'stopped' : ''}>{f.result}</small>
                      {advanced && (
                        <small className="simple-detail">
                          {f.agents} agents · {duration(f.seconds)} · {f.credits}{' '}
                          {f.credits === 1 ? 'credit' : 'credits'}
                        </small>
                      )}
                    </div>
                    <Link href={f.href} className="simple-button">
                      {f.action}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="simple-empty">Nothing finished yet today.</p>
            )}
          </section>
        </aside>
      </div>

      {testMode && <p className="simple-note">Test mode. Results use sample data.</p>}
    </div>
  );
}

function RunCard({
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
  const done = run.steps.filter((s) => s.state === 'done').length;
  return (
    <article className={'run-card' + (open ? ' open' : '')}>
      <button className="run-card-head" aria-expanded={open} onClick={onToggle}>
        <span className="run-card-title">
          <b>{run.name}</b>
          <small>{run.now}</small>
        </span>
        <span className="home-segments" aria-hidden="true">
          {run.steps.map((s, i) => (
            <i key={i} className={s.state} />
          ))}
        </span>
        <span className="home-progress">
          Step {Math.min(done + 1, run.steps.length)} of {run.steps.length}
        </span>
        <span className="run-card-time">{run.elapsed}</span>
        <ChevronDown size={18} className="run-card-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="run-card-body">
          <ol className="run-feed" aria-label={'What ' + run.name + ' has done'}>
            {run.output.map((o) => (
              <li key={o.id}>
                <time>{o.at}</time>
                <div>
                  <b>{o.who}</b>
                  <p>{o.text}</p>
                </div>
              </li>
            ))}
          </ol>
          {run.draft && (
            <div className="run-draft" aria-live="polite">
              <span>{run.draft.who} is writing</span>
              <p>
                {run.draft.text}
                <i className="run-caret" aria-hidden="true" />
              </p>
            </div>
          )}
          {advanced && (
            <ol className="home-steps">
              {run.steps.map((s) => (
                <li key={s.name} className={s.state}>
                  <span>{s.name}</span>
                  <span>{stateLabel[s.state]}</span>
                  <span>{duration(s.seconds)}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="run-card-foot">
            <Link href={run.href} className="simple-button">
              Open full run
            </Link>
          </div>
        </div>
      )}
    </article>
  );
}
