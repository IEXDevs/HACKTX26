import { MODEL_CATALOG } from "@agent-os/core";
import { usd } from "@/lib/format";
import { spendSince } from "@/lib/observability";
import {
  getWorkspaceContext,
  listAgents,
  listBudgetPolicies,
  listRuns,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const periodWord: Record<string, string> = { run: "Each run", day: "Each day", month: "Each month" };

export default async function BillingPage() {
  const { workspace, spendTodayUsd } = await getWorkspaceContext();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [policies, agents, runs, cloudMonth] = await Promise.all([
    listBudgetPolicies(workspace.id),
    listAgents(workspace.id),
    listRuns(workspace.id, { limit: 1000 }),
    spendSince(workspace.id, monthStart),
  ]);
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const spendMonth =
    cloudMonth ??
    runs
      .filter((run) => run.mode === "live" && run.startedAt >= monthStart)
      .reduce((sum, run) => sum + run.costUsd, 0);
  const daily = policies.find((p) => p.agentId === null && p.period === "day");
  const used = daily ? Math.min(1, spendTodayUsd / Math.max(daily.limitUsd, 0.01)) : 0;
  const models = MODEL_CATALOG.filter((model) => model.provider === "meta" || model.id.startsWith("muse-"));

  return (
    <div className="page">
      <div className="page-top">
        <h1>Billing</h1>
      </div>

      <div className="page-split">
        <section>
          <h2>This period</h2>
          <dl className="stats">
            <div>
              <dt>Spent today</dt>
              <dd>{usd(spendTodayUsd)}</dd>
            </div>
            <div>
              <dt>Spent this month</dt>
              <dd>{usd(spendMonth)}</dd>
            </div>
            <div>
              <dt>Daily limit</dt>
              <dd>{daily ? usd(daily.limitUsd) : "None"}</dd>
            </div>
          </dl>
          {daily && (
            <div className="shell-spend-track" style={{ height: 10, marginTop: 14 }}>
              <i style={{ width: `${used * 100}%` }} />
            </div>
          )}
        </section>

        <section>
          <h2>Spending limits</h2>
          {policies.length ? (
            <ul className="list">
              {policies.map((p) => (
                <li key={p.id}>
                  <div>
                    <b>
                      {periodWord[p.period] ?? p.period}
                      {p.agentId ? ` · ${agentName.get(p.agentId) ?? "Agent"}` : " · whole workspace"}
                    </b>
                    <small>
                      Up to {usd(p.limitUsd)}. Warns at {Math.round(p.warnAt * 100)}%.{" "}
                      {p.hardStop ? "Stops at the limit." : "Keeps going past the limit."}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No spending limits are set.</p>
          )}
        </section>
      </div>

      <section className="section">
        <h2>Model prices</h2>
        <p>
          Meta Model API rates as published. Orchestrators pin Wonder, Spark 1.3, or Spark 1.1
          depending on the task.
        </p>
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

      <p className="note">
        Costs are estimates from live model usage. Seeded demo runs are not billed. Astronom does
        not collect payments.
      </p>
    </div>
  );
}
