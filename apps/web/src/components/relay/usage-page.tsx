"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { UsageRange, UsageView } from "@/lib/views";
import { LiveRefresh } from "./live-refresh";
import { UsageChart, compact } from "./usage-chart";

export function UsagePage({
  data,
  range,
  spend,
}: {
  data: UsageView;
  range: UsageRange;
  spend: string;
  avg: string;
}) {
  const router = useRouter();
  return (
    <div className="page">
      <LiveRefresh intervalMs={4000} />
      <div className="page-top">
        <h1>Usage</h1>
        <div className="page-actions">
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
      <p className="note">
        {data.ledger === "supabase"
          ? "Live model calls synced to Supabase as each turn finishes, including builder drafts. This page refreshes every few seconds."
          : "Live model calls only. This page refreshes every few seconds."}
      </p>

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
      </dl>

      <div className="page-split">
        <section>
          <h2>Problems{data.problems.length > 0 && ` · ${data.problems.length}`}</h2>
          {data.problems.length ? (
            <ul className="list">
              {data.problems.map((p) => (
                <li key={p.id}>
                  <div>
                    <b>{p.name} did not finish</b>
                    <small>{p.when}</small>
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

        <section>
          <h2>Tokens by agent</h2>
          {data.byAgent.length ? (
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
          ) : (
            <p className="empty">No token usage yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
