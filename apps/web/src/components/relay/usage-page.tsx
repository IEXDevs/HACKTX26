"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { UsageRange, UsageView } from "@/lib/views";
import { AdvancedSwitch, useAdvanced } from "./advanced";
import { UsageChart, compact } from "./usage-chart";

export function UsagePage({
  data,
  range,
  spend,
  avg,
}: {
  data: UsageView;
  range: UsageRange;
  spend: string;
  avg: string;
}) {
  const router = useRouter();
  const [advanced, toggleAdvanced] = useAdvanced();
  return (
    <div className="page">
      <div className="page-top">
        <h1>Usage</h1>
        <div className="page-actions">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
          <select
            className="select"
            aria-label="Time range"
            value={range}
            onChange={(e) => router.push(`/usage?range=${e.target.value}`)}
          >
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>

      <UsageChart charts={data} />

      <dl className="stats">
        <div>
          <dt>Runs</dt>
          <dd>{data.runs}</dd>
        </div>
        <div>
          <dt>Problems</dt>
          <dd className={data.problems.length ? "stopped" : ""}>{data.problems.length}</dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd>{spend}</dd>
        </div>
        {advanced && (
          <div>
            <dt>Average run</dt>
            <dd>{avg}</dd>
          </div>
        )}
      </dl>

      <section className="section">
        <h2>Problems{data.problems.length > 0 && ` · ${data.problems.length}`}</h2>
        {data.problems.length ? (
          <ul className="list">
            {data.problems.map((p) => (
              <li key={p.id}>
                <div>
                  <b>{p.name} did not finish</b>
                  <small>{p.when}</small>
                  {advanced && <small className="detail">{p.result}</small>}
                </div>
                <Link href={`/runs/${p.id}`} className="btn small">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No problems.</p>
        )}
      </section>

      {advanced && (
        <section className="section">
          <h2>Tokens by agent</h2>
          <div className="table">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {[...data.byAgent]
                  .sort((a, b) => b.tokens - a.tokens)
                  .map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/agents/${row.id}`}>{row.name}</Link>
                      </td>
                      <td>{compact(row.tokens)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
