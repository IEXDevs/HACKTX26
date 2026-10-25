import Link from "next/link";
import { FileText, Wrench } from "@/components/icons";
import { clockTime, duration, relativeTime } from "@/lib/format";
import { plainText } from "@/lib/plain-text";

export interface TrailCall {
  id: string;
  runId: string;
  tool: string;
  status: string;
  preview: string | null;
  error: string | null;
  at: string;
  durationMs: number | null;
}

export interface TrailThought {
  runId: string;
  text: string;
  at: string;
}

export interface TrailFile {
  path: string;
  op: string;
  at: string;
}

export function AgentTrail({
  agentName,
  calls,
  thoughts,
  files,
}: {
  agentName: string;
  calls: TrailCall[];
  thoughts: TrailThought[];
  files: TrailFile[];
}) {
  const items = interleave(thoughts, calls);
  return (
    <div className="trail">
      <ol className="log-stream trail-log">
        {items.length === 0 ? (
          <li className="trail-empty">
            Nothing from {agentName} yet.
          </li>
        ) : (
          items.map((item) =>
            item.kind === "thought" ? (
              <li key={`t-${item.at}-${item.text.slice(0, 24)}`} className="log-row log-thought">
                <time dateTime={item.at}>{clockTime(item.at)}</time>
                <span className="log-kind">said</span>
                <span className="log-who">{agentName}</span>
                <span className="log-text">{plainText(item.text)}</span>
              </li>
            ) : (
              <li key={item.id} className={`log-row log-tool${item.status === "failed" ? " failed" : ""}`}>
                <time dateTime={item.at}>{clockTime(item.at)}</time>
                <span className="log-kind">{item.tool}</span>
                <span className="log-who">
                  <Wrench size={11} aria-hidden />
                  {item.status}
                  {item.durationMs != null ? ` · ${duration(item.durationMs)}` : ""}
                </span>
                <span className="log-text">
                  {plainText(item.error || item.preview || "")}
                  {" · "}
                  <Link href={`/runs/${item.runId}`}>run</Link>
                </span>
              </li>
            ),
          )
        )}
      </ol>
      {files.length > 0 ? (
        <aside className="trail-side">
          <div className="trail-card">
            <h3>Files touched</h3>
            <ul>
              {files.map((file) => (
                <li key={`${file.path}-${file.at}`}>
                  <FileText size={12} aria-hidden />
                  <span>
                    <b>{file.path}</b>
                    <small>
                      {file.op} · {relativeTime(file.at)}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function interleave(
  thoughts: TrailThought[],
  calls: TrailCall[],
): Array<{ kind: "thought" } & TrailThought | ({ kind: "call" } & TrailCall)> {
  const rows: Array<{ kind: "thought" } & TrailThought | ({ kind: "call" } & TrailCall)> = [
    ...thoughts.map((item) => ({ kind: "thought" as const, ...item })),
    ...calls.map((item) => ({ kind: "call" as const, ...item })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}
