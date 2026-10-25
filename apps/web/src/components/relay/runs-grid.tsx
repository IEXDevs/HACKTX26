"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "@/components/icons";
import { pct, usd } from "@/lib/format";
import { sparkPoints, type RunKpis } from "@/lib/run-stats";
import type { RunTile } from "@/lib/views";
import { StartRun, type RunnableAgent } from "./start-run";
import { useAutoRefresh } from "./use-auto-refresh";

const groupRank: Record<RunTile["group"], number> = { waiting: 0, running: 1, recent: 2 };

export function RunsGrid({
  runs,
  agents,
  kpis,
}: {
  runs: RunTile[];
  agents: RunnableAgent[];
  kpis: RunKpis;
}) {
  const [search, setSearch] = useState("");
  const live = runs.some((run) => run.group !== "recent");
  useAutoRefresh(live, 4000);

  const visible = runs
    .filter((run) => [run.name, run.goal].join(" ").toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => groupRank[a.group] - groupRank[b.group] || b.startedMs - a.startedMs);

  return (
    <div className="page">
      <div className="page-top">
        <h1>Runs</h1>
        <div className="page-actions">
          <StartRun agents={agents} />
        </div>
      </div>

      <dl className="stats kpis" aria-label="Run totals for the last 7 days">
        <Kpi
          label="Success rate"
          value={kpis.finished ? pct(kpis.successRate) : "—"}
          hint={kpis.finished ? `${kpis.finished} finished in 7 days` : "No finished runs in 7 days"}
          series={kpis.series.success}
          tone="ok"
        />
        <Kpi
          label="Failed"
          value={String(kpis.failed)}
          hint="Stopped, halted, or cancelled in 7 days"
          series={kpis.series.failed}
          tone={kpis.failed ? "bad" : ""}
        />
        <Kpi
          label="Waiting for you"
          value={String(kpis.waiting)}
          hint="Need a decision now"
          series={kpis.series.waiting}
          tone={kpis.waiting ? "warn" : ""}
        />
        <Kpi
          label="Spend today"
          value={usd(kpis.spendToday)}
          hint="Last 7 days in the graph"
          series={kpis.series.spend}
          tone="ok"
        />
      </dl>

      {runs.length > 0 && (
        <div className="toolbar" style={{ marginTop: 20 }}>
          <label className="search">
            <Search size={16} aria-hidden />
            <span className="sr-only">Search runs</span>
            <input
              type="search"
              placeholder="Search runs"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
      )}

      {visible.length ? (
        <div className="run-list">
          <div className="run-list-head" aria-hidden="true">
            <span>Status</span>
            <span className="col-agent">Agent</span>
            <span>Goal</span>
            <span className="num col-duration">Duration</span>
            <span className="num">Spend</span>
          </div>
          {visible.map((run) => (
            <Link key={run.id} href={`/runs/${run.id}`} className="run-row">
              <span className={`tile-status ${run.tone}`}>{run.label}</span>
              <span className="run-agent col-agent">{run.name}</span>
              <span className="run-goal">{run.goal}</span>
              <span className="num col-duration">{run.duration}</span>
              <span className="num">{run.spend}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="empty">
          {search ? "No runs match that search." : "No runs yet. Start one with New run."}
        </p>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  series,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  series: number[];
  tone: "ok" | "warn" | "bad" | "";
}) {
  const width = 88;
  const height = 28;
  const line = sparkPoints(series, width, height);
  const area = line ? `M${line.replace(/ /g, " L")} L${width},${height} L0,${height} Z` : "";
  return (
    <div>
      <dt>{label}</dt>
      <div className="kpi-row">
        <dd>{value}</dd>
        <svg
          className={`spark ${tone}`}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
        >
          {area && <path className="spark-fill" d={area} />}
          {line && (
            <polyline
              className="spark-line"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={line}
            />
          )}
        </svg>
      </div>
      <small>{hint}</small>
    </div>
  );
}
