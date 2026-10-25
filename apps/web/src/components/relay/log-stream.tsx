"use client";

import Link from "next/link";
import { clockTime } from "@/lib/format";
import { plainText } from "@/lib/plain-text";
import type { HistoryItem } from "@/lib/views";

const KIND: Record<HistoryItem["kind"], string> = {
  thought: "said",
  thinking: "think",
  tool: "tool",
  handoff: "hand",
  spawn: "spawn",
};

export function LogStream({
  rows,
  empty = "Nothing yet.",
  agentHref,
  limit,
}: {
  rows: HistoryItem[];
  empty?: string;
  agentHref?: (agentId: string) => string;
  limit?: number;
}) {
  const visible = limit ? rows.slice(-limit) : rows;
  if (visible.length === 0) return <p className="log-empty">{empty}</p>;
  return (
    <ol className="log-stream">
      {visible.map((row) => {
        const kind = row.kind === "tool" ? row.tool ?? "tool" : KIND[row.kind];
        const body =
          row.kind === "spawn" ? `Stood up ${plainText(row.text)}` : plainText(row.text);
        const who =
          agentHref && row.agentId ? (
            <Link href={agentHref(row.agentId)} className="log-who-link">
              {row.who}
            </Link>
          ) : (
            row.who
          );
        return (
          <li
            key={row.id}
            className={`log-row log-${row.kind}${row.status === "failed" ? " failed" : ""}`}
          >
            <time dateTime={row.ts}>{row.at || clockTime(row.ts)}</time>
            <span className="log-kind">{kind}</span>
            <span className="log-who">{who}</span>
            <span className="log-text">{body}</span>
          </li>
        );
      })}
    </ol>
  );
}
