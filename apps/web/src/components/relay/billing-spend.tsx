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
  return <div className="bill-charts">
    <section className="bill-panel">
      <div className="bill-panel-head"><h2>Daily spending</h2><select aria-label="Spending time range" value={range} onChange={(event) => { setRange(Number(event.target.value)); setActive(null); }}><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option></select></div>
      <div className="bill-chart-value"><b>{money(highlighted?.amount ?? total)}</b><span>{highlighted?.label ?? `Total over ${range} days`}</span></div>
      <div className="bill-columns" aria-label="Daily spending in USD">
        {selected.map((day) => <button key={day.date} type="button" aria-label={`${day.label}: ${money(day.amount)}`} aria-pressed={active === day.date} onMouseEnter={() => setActive(day.date)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(day.date)} onBlur={() => setActive(null)} onClick={() => setActive(day.date)}><span style={{ height: `${Math.max(day.amount > 0 ? 2 : 0, day.amount / peak * 100)}%` }} /></button>)}
      </div>
      <div className="bill-chart-axis"><span>{selected[0]?.label}</span><span>{selected[Math.floor(selected.length / 2)]?.label}</span><span>{selected.at(-1)?.label}</span></div>
      {total === 0 && <p className="bill-caption">No spending in this period.</p>}
    </section>
    <section className="bill-panel"><div className="bill-panel-head"><h2>Cost by agent</h2><span className="bill-caption">This month</span></div>
      <div className="bill-cost-list">{agents.length ? agents.map((agent) => <Link href={agent.id === "red-team-group" ? "/agents" : `/agents/${agent.id}`} key={agent.id} className="bill-cost-row"><span>{agent.name}</span><b>{money(agent.amount)}</b><div><i style={{ width: `${agentTotal ? agent.amount / agentTotal * 100 : 0}%` }} /></div></Link>) : <p className="bill-empty">No agent spending this month.</p>}</div>
    </section>
  </div>;
}
