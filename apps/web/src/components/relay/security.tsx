"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "@/components/icons";
import { CATEGORY_LABELS, probeCountForLimit } from "@/lib/loop/redteam-limits";

export interface SecurityAgent {
  id: string;
  name: string;
  role: string;
  parent: boolean;
}

export interface LiveTest {
  agentId: string;
  agentName: string;
  probesDone: number;
  probesTotal: number;
  spentUsd: number;
  maxUsd: number;
  current: string | null;
}

export interface TestProbe {
  category: string;
  title: string;
  held: boolean;
  note: string;
  runId: string;
  findingId: string | null;
}

export interface TestReport {
  id: string;
  agentId: string;
  agent: string;
  when: string;
  held: number;
  open: number;
  probes: TestProbe[];
}

export function SecurityView({
  agents,
  live,
  reports,
  defaults,
}: {
  agents: SecurityAgent[];
  live: LiveTest[];
  reports: TestReport[];
  defaults: { agentId: string; limitUsd: number; probeCost: number };
}) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(defaults.agentId || agents[0]?.id || ""),
    [limit, setLimit] = useState(String(defaults.limitUsd)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  const limitUsd = Number(limit);
  const probes = useMemo(() => probeCountForLimit(limitUsd), [limitUsd]);

  useEffect(() => {
    if (!live.length) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [live.length, router]);

  async function go() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/security/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, limitUsd }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error ?? "The test did not start.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const testing = live.length > 0 || busy;
  const selected = agents.find((agent) => agent.id === agentId);

  return (
    <div className="page">
      <div className="page-top">
        <h1>Security</h1>
      </div>

      <section className="sec-pick" aria-labelledby="sec-pick-label">
        <h2 id="sec-pick-label">Pick an agent to test</h2>
        <p className="sec-hint" style={{ marginBottom: 12 }}>
          Choose the agent these tests will run against.
        </p>
        {agents.length ? (
          <div className="sec-agents" role="radiogroup" aria-labelledby="sec-pick-label">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                role="radio"
                className="sec-agent"
                aria-checked={agent.id === agentId}
                disabled={testing}
                onClick={() => setAgentId(agent.id)}
              >
                <b>{agent.name}</b>
                <small>
                  {agent.role === "orchestrator" ? "Lead agent" : agent.parent ? "On a team" : "Works alone"}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty">No published agents to test yet.</p>
        )}
      </section>

      <form
        className="sec-command"
        onSubmit={(event) => {
          event.preventDefault();
          void go();
        }}
      >
        <p className="sec-chosen">
          {selected ? (
            <>
              Testing <b>{selected.name}</b>
            </>
          ) : (
            "Choose an agent above."
          )}
        </p>
        <label className="field">
          Limit
          <input
            type="number"
            min={defaults.probeCost}
            max={10}
            step={defaults.probeCost}
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            disabled={testing}
            aria-describedby="sec-limit-hint"
          />
        </label>
        <button className="btn primary" type="submit" disabled={testing || !agentId || probes < 1}>
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : null}
          Run tests
        </button>
        <p id="sec-limit-hint" className="sec-hint">
          {probes < 1
            ? `Need at least $${defaults.probeCost.toFixed(2)} for one probe.`
            : `${probes} ${probes === 1 ? "probe" : "probes"} · $${defaults.probeCost.toFixed(2)} each`}
        </p>
      </form>

      {error && <p className="error-text">{error}</p>}

      {live.map((check) => {
        const pct = Math.max(4, Math.round((check.probesDone / Math.max(check.probesTotal, 1)) * 100));
        const current =
          check.current && check.current in CATEGORY_LABELS
            ? CATEGORY_LABELS[check.current as keyof typeof CATEGORY_LABELS]
            : check.current;
        return (
          <section className="home-running" key={check.agentId} style={{ marginTop: 24 }}>
            <h2>Testing {check.agentName}</h2>
            <article className="run-bar">
              <div className="run-bar-track" aria-label={`${check.agentName}, ${check.probesDone} of ${check.probesTotal} probes`}>
                <span className="run-bar-label">
                  <span className="run-bar-title">
                    <b>{check.agentName}</b>
                    <small>
                      {check.probesDone} of {check.probesTotal} probes
                      {current ? ` · ${current}` : ""}
                    </small>
                  </span>
                  <span className="run-bar-meta">
                    ${check.spentUsd.toFixed(2)} of ${check.maxUsd.toFixed(2)}
                  </span>
                </span>
                <span className="run-bar-fill" style={{ width: `${pct}%` }} aria-hidden="true">
                  <span className="run-bar-label" style={{ width: `${10000 / pct}%` }}>
                    <span className="run-bar-title">
                      <b>{check.agentName}</b>
                      <small>
                        {check.probesDone} of {check.probesTotal} probes
                      </small>
                    </span>
                    <span className="run-bar-meta">
                      ${check.spentUsd.toFixed(2)} of ${check.maxUsd.toFixed(2)}
                    </span>
                  </span>
                </span>
              </div>
            </article>
          </section>
        );
      })}

      <section className="section">
        <h2>Reports</h2>
        {reports.length ? (
          reports.map((report) => (
            <article className="home-panel sec-report" key={report.id}>
              <div className="section-head">
                <h2>
                  {report.agent}
                  {report.open ? ` · ${report.open} not fixed` : ""}
                  {report.held ? ` · ${report.held} held` : ""}
                </h2>
                <span className="muted">{report.when}</span>
              </div>
              {report.probes.length ? (
                <ul className="checklist">
                  {report.probes.map((probe) => (
                    <li key={`${report.id}-${probe.category}-${probe.runId}`}>
                      <label>
                        <b>{probe.title}</b>
                        <small className={probe.held ? "" : "stopped"}>{probe.note}</small>
                      </label>
                      <Link href={`/runs/${probe.runId}`} className="check-link">
                        Open
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">No probe detail on this report.</p>
              )}
            </article>
          ))
        ) : (
          <p className="empty">No tests yet. Pick an agent, set a limit, and hit Go.</p>
        )}
      </section>
    </div>
  );
}
