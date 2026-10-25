import Link from "next/link";
import { MODEL_CATALOG } from "@agent-os/core";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { runs } from "@/lib/db/schema";
import { spendSince } from "@/lib/observability";
import { getWorkspaceContext, listAgents, listBudgetPolicies } from "@/lib/queries";
import { BillingSpend } from "@/components/relay/billing-spend";

export const dynamic = "force-dynamic";
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const dateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

export default async function BillingPage() {
  const { workspace, spendTodayUsd } = await getWorkspaceContext();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  // Only live runs are billed; seeded demo runs are not.
  const [policies, agents, history, cloudMonth] = await Promise.all([
    listBudgetPolicies(workspace.id),
    listAgents(workspace.id),
    getDb()
      .select()
      .from(runs)
      .where(and(eq(runs.workspaceId, workspace.id), eq(runs.mode, "live")))
      .orderBy(desc(runs.startedAt)),
    spendSince(workspace.id, monthStart),
  ]);
  const today = dateKey(new Date());
  const month = today.slice(0, 7);
  const monthRuns = history.filter((run) => dateKey(run.startedAt).startsWith(month));
  const sum = (items: typeof history) => items.reduce((total, run) => total + run.costUsd, 0);
  // Match the sidebar: cloud usage when it is configured, local live runs otherwise.
  const todaySpent = spendTodayUsd;
  const monthSpent = cloudMonth ?? sum(monthRuns);
  const models = MODEL_CATALOG.filter((model) => model.provider === "meta" || model.id.startsWith("muse-"));
  const daily = policies.find((policy) => policy.agentId === null && policy.period === "day");
  const names = new Map(agents.map((agent) => [agent.id, agent.name]));
  const days = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - 29 + index);
    const key = dateKey(day);
    return { date: key, label: day.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }), amount: sum(history.filter((run) => dateKey(run.startedAt) === key)) };
  });
  const totals = new Map<string, Array<{ id: string; goal: string; date: string; amount: number }>>();
  for (const run of monthRuns) {
    const name = names.get(run.agentId) ?? "";
    const id = /red[\s_-]*teams?\b/i.test(name) ? "red-team-group" : run.agentId;
    const entries = totals.get(id) ?? [];
    entries.push({ id: run.id, goal: run.goal, date: dateKey(run.startedAt), amount: run.costUsd });
    totals.set(id, entries);
  }
  const costs = [...totals].map(([id, entries]) => ({
    id,
    name: id === "red-team-group" ? "Red Team" : names.get(id) ?? "Archived agent",
    amount: entries.reduce((total, entry) => total + entry.amount, 0),
    runs: entries,
  })).sort((a, b) => b.amount - a.amount);

  return (
    <div className="page billing-page">
      <div className="page-top"><h1>Billing</h1><Link href="/usage" className="btn">View usage</Link></div>
      <section className="bill-summary" aria-label="Spending overview">
        <div className="bill-summary-main"><span className="bill-label">Spent this month</span><strong>{money(monthSpent)}</strong><span className="bill-caption">{monthRuns.length} runs · {new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span></div>
        <div className="bill-today"><div><span className="bill-label">Today's spending</span><b>{money(todaySpent)} <small>{daily ? `of ${money(daily.limitUsd)}` : "No daily limit"}</small></b></div>{daily && <><progress max={Math.max(daily.limitUsd, 0.01)} value={todaySpent} aria-label="Daily budget used" /><span className="bill-caption">{todaySpent > daily.limitUsd ? `${money(todaySpent - daily.limitUsd)} over budget` : `${money(daily.limitUsd - todaySpent)} remaining today`}</span></>}</div>
      </section>
      <BillingSpend days={days} agents={costs} />
      <section className="bill-section">
        <div className="bill-section-title"><h2>Spending limits</h2><span>Spent and remaining in each period</span></div>
        <div className="bill-table-wrap"><table className="bill-table"><thead><tr><th scope="col">Scope</th><th scope="col">Period</th><th scope="col">Spent</th><th scope="col">Limit</th><th scope="col">Remaining</th><th scope="col">Budget used</th></tr></thead><tbody>
          {policies.map((policy) => {
            const scoped = history.filter((run) => !policy.agentId || run.agentId === policy.agentId);
            const latest = scoped[0];
            const spent = policy.period === "run" ? latest?.costUsd ?? 0 : sum(scoped.filter((run) => policy.period === "day" ? dateKey(run.startedAt) === today : dateKey(run.startedAt).startsWith(month)));
            const ratio = spent / Math.max(policy.limitUsd, 0.01);
            return <tr key={policy.id}>
              <td>{policy.agentId ? <Link href={`/agents/${policy.agentId}`}>{names.get(policy.agentId) ?? "Agent"}</Link> : <b>Workspace</b>}<small>{policy.hardStop ? "Stops at limit" : "Continues past limit"} · Warns at {Math.round(policy.warnAt * 100)}%</small></td>
              <td>{policy.period === "run" ? <>{latest ? <Link href={`/runs/${latest.id}`}>Latest run ↗</Link> : "Per run"}<small>{latest ? dateKey(latest.startedAt) : "No runs yet"}</small></> : policy.period === "day" ? "Today" : "This month"}</td>
              <td>{money(spent)}</td><td>{money(policy.limitUsd)}</td><td className={ratio >= 1 ? "bill-over" : ""}>{ratio > 1 ? `${money(spent - policy.limitUsd)} over` : money(policy.limitUsd - spent)}</td>
              <td><div className={`bill-budget-progress${ratio >= policy.warnAt ? " warning" : ""}`}><progress max={Math.max(policy.limitUsd, 0.01)} value={spent} aria-label={`${policy.agentId ? names.get(policy.agentId) : "Workspace"} budget used`} /><span>{Math.round(ratio * 100)}%</span></div></td>
            </tr>;
          })}
        </tbody></table>{policies.length === 0 && <p className="bill-empty">No spending limits set.</p>}</div>
      </section>
      <section className="bill-section">
        <div className="bill-section-title"><h2>Model prices</h2><span>Meta Model API rates as published</span></div>
        <ul className="list">
          {models.map((model) => (
            <li key={model.id}>
              <div>
                <b>{model.label}</b>
                <small>
                  {model.id} · ${model.inputPerMTok} / ${model.outputPerMTok} per 1M tokens
                  {model.cachedInputPerMTok != null ? ` · cached in $${model.cachedInputPerMTok}` : ""}
                </small>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <p className="bill-caption bill-disclaimer">Estimated costs from live model usage, in USD. Seeded demo runs are not billed. No payments are collected.</p>
    </div>
  );
}
