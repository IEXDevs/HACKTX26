"use client";

import { useRouter } from "next/navigation";
import type { UsageRange, UsageView } from "@/lib/views";
import { LiveRefresh } from "./live-refresh";
import { UsageChart } from "./usage-chart";

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

      <dl className="stats">
        <div>
          <dt>Runs</dt>
          <dd>{data.runs}</dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd>{spend}</dd>
        </div>
      </dl>
    </div>
  );
}
