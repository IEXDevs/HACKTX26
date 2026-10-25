"use client";

import { useState } from "react";
import Link from "next/link";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

export function BillingSpend({ days, agents }: {
  days: Array<{ date: string; label: string; amount: number }>;
  agents: Array<{ id: string; name: string; amount: number }>;
}) {
  const [range, setRange] = useState(14);
  const [active, setActive] = useState<string | null>(null);
  const selected = days.slice(-range);
  const total = selected.reduce((sum, day) => sum + day.amount, 0);
  const peak = Math.max(0.01, ...selected.map((day) => day.amount));
  const highlighted = selected.find((day) => day.date === active);
  const agentTotal = agents.reduce((sum, agent) => sum + agent.amount, 0);
  const x = (index: number) => 10 + index / Math.max(1, selected.length - 1) * 580;
  const y = (amount: number) => 168 - amount / peak * 150;
  // Gaussian kernel regression shows a smooth trend independently of the daily observations.
  const trend = Array.from({ length: 161 }, (_, index) => {
    const position = index / 160 * Math.max(0, selected.length - 1);
    let weighted = 0;
    let weights = 0;
    selected.forEach((day, dayIndex) => {
      const weight = Math.exp(-0.5 * ((dayIndex - position) / 1.25) ** 2);
      weighted += day.amount * weight;
      weights += weight;
    });
    return `${index ? "L" : "M"}${x(position)},${y(weights ? weighted / weights : 0)}`;
  }).join(" ");
  return <div className="bill-charts">
    <section className="bill-panel">
      <div className="bill-panel-head"><h2>Daily spending</h2><select aria-label="Spending time range" value={range} onChange={(event) => { setRange(Number(event.target.value)); setActive(null); }}><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option></select></div>
      <div className="bill-chart-value"><b>{money(highlighted?.amount ?? total)}</b><span>{highlighted?.label ?? `Total over ${range} days`}</span></div>
      <svg className="bill-trend" viewBox="0 0 600 180" role="group" aria-label="Daily spending: smooth trend with actual daily amounts">
        {[0, 0.5, 1].map((fraction) => <line key={fraction} x1="10" x2="590" y1={y(peak * fraction)} y2={y(peak * fraction)} className="bill-trend-grid" />)}
        <path d={trend} className="bill-trend-line" />
        {selected.map((day, index) => <g key={day.date} tabIndex={0} role="button" aria-label={`${day.label}: ${money(day.amount)}`} aria-pressed={active === day.date} onMouseEnter={() => setActive(day.date)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(day.date)} onBlur={() => setActive(null)} onClick={() => setActive(day.date)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(day.date); } }}>
          <title>{day.label}: {money(day.amount)}</title>
          <circle cx={x(index)} cy={y(day.amount)} r="9" fill="transparent" />
          <circle cx={x(index)} cy={y(day.amount)} r={active === day.date ? 5 : 3.5} className="bill-trend-point" />
        </g>)}
      </svg>
      <div className="bill-chart-axis"><span>{selected[0]?.label}</span><span>{selected[Math.floor(selected.length / 2)]?.label}</span><span>{selected.at(-1)?.label}</span></div>
      <p className="bill-trend-key"><span>● Daily spend</span><span>— Smoothed trend</span></p>
      {total === 0 && <p className="bill-caption">No spending in this period.</p>}
    </section>
    <section className="bill-panel"><div className="bill-panel-head"><h2>Cost by agent</h2><span className="bill-caption">This month</span></div>
      <div className="bill-cost-list">{agents.length ? agents.map((agent) => <Link href={agent.id === "red-team-group" ? "/agents" : `/agents/${agent.id}`} key={agent.id} className="bill-cost-row"><span>{agent.name}</span><b>{money(agent.amount)}</b><div><i style={{ width: `${agentTotal ? agent.amount / agentTotal * 100 : 0}%` }} /></div></Link>) : <p className="bill-empty">No agent spending this month.</p>}</div>
    </section>
  </div>;
}
