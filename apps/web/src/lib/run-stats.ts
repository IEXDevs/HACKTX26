/** Seven-day run KPIs for the Runs index. Pure: no database. */

export interface RunStatRow {
  status: string;
  costUsd: number;
  startedAt: Date | number;
}

export interface RunKpis {
  successRate: number;
  finished: number;
  failed: number;
  waiting: number;
  spendToday: number;
  series: {
    success: number[];
    failed: number[];
    waiting: number[];
    spend: number[];
  };
}

const FAILED = new Set(["failed", "halted", "cancelled"]);

export function startOfLocalDay(ms: number): number {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** Oldest → today, `days` local midnights. */
export function dayStarts(now: number, days = 7): number[] {
  const today = startOfLocalDay(now);
  const starts: number[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    starts.push(day.getTime());
  }
  return starts;
}

export function summarizeRuns(rows: readonly RunStatRow[], now = Date.now()): RunKpis {
  const starts = dayStarts(now);
  const buckets = starts.map(() => ({
    terminal: 0,
    succeeded: 0,
    failed: 0,
    waiting: 0,
    spend: 0,
  }));
  let waiting = 0;

  for (const row of rows) {
    const started = typeof row.startedAt === "number" ? row.startedAt : row.startedAt.getTime();
    if (row.status === "awaiting_approval") waiting += 1;
    const index = starts.indexOf(startOfLocalDay(started));
    if (index < 0) continue;
    const bucket = buckets[index]!;
    bucket.spend += row.costUsd;
    if (row.status === "awaiting_approval") bucket.waiting += 1;
    if (row.status === "succeeded") {
      bucket.terminal += 1;
      bucket.succeeded += 1;
    } else if (FAILED.has(row.status)) {
      bucket.terminal += 1;
      bucket.failed += 1;
    }
  }

  const finished = buckets.reduce((sum, bucket) => sum + bucket.terminal, 0);
  const succeeded = buckets.reduce((sum, bucket) => sum + bucket.succeeded, 0);
  const failed = buckets.reduce((sum, bucket) => sum + bucket.failed, 0);

  return {
    successRate: finished ? succeeded / finished : 0,
    finished,
    failed,
    waiting,
    spendToday: buckets.at(-1)?.spend ?? 0,
    series: {
      success: buckets.map((bucket) => (bucket.terminal ? bucket.succeeded / bucket.terminal : 0)),
      failed: buckets.map((bucket) => bucket.failed),
      waiting: buckets.map((bucket) => bucket.waiting),
      spend: buckets.map((bucket) => bucket.spend),
    },
  };
}

export function sparkPoints(values: number[], width: number, height: number): string {
  if (!values.length) return "";
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const last = values.length - 1;
  return values
    .map((value, index) => {
      const x = last === 0 ? width / 2 : (index / last) * width;
      const y = height - 1.5 - ((value - min) / span) * (height - 3);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
