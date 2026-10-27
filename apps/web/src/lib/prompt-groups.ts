import type { CloudPromptRow } from "./observability";

/** Latest run first; turns inside each run follow their original timeline. */
export function groupPromptLogs(rows: CloudPromptRow[]) {
  const groups = new Map<string, { id: string; runId: string | null; source: string; rows: CloudPromptRow[]; latestAt: Date; tokens: number }>();
  for (const row of rows) {
    const id = row.runId ? `run:${row.runId}` : `source:${row.source}`;
    let group = groups.get(id);
    if (!group) { group = { id, runId: row.runId, source: row.source, rows: [], latestAt: row.createdAt, tokens: 0 }; groups.set(id, group); }
    group.rows.push(row); group.tokens += (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
    if (row.createdAt > group.latestAt) group.latestAt = row.createdAt;
  }
  return [...groups.values()].sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime()).map((group) => ({ ...group,
    rows: group.rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.step ?? 0) - (b.step ?? 0)),
  }));
}
