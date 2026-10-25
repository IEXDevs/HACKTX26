import Link from "next/link";
import { FileText, FolderOpen, Terminal, Wrench } from "@/components/icons";
import { duration, relativeTime } from "@/lib/format";

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
  agentId,
  agentName,
  model,
  calls,
  thoughts,
  files,
}: {
  agentId: string;
  agentName: string;
  model: string;
  calls: TrailCall[];
  thoughts: TrailThought[];
  files: TrailFile[];
}) {
  return (
    <div className="trail">
      <div className="trail-main">
        <ol className="trail-log">
          {thoughts.length === 0 && calls.length === 0 ? (
            <li className="trail-empty">No trail yet. Dispatch {agentName} and the log will land here.</li>
          ) : null}
          {interleave(thoughts, calls).map((item) =>
            item.kind === "thought" ? (
              <li key={`t-${item.at}-${item.text.slice(0, 24)}`} className="trail-thought">
                <span className="trail-when">{relativeTime(item.at)}</span>
                <p>{item.text}</p>
              </li>
            ) : (
              <li key={item.id} className={`trail-call ${item.status}`}>
                <span className="trail-when">{relativeTime(item.at)}</span>
                <div>
                  <b>
                    <Wrench size={12} aria-hidden /> {item.tool}
                  </b>
                  <small>
                    {item.status}
                    {item.durationMs != null ? ` · ${duration(item.durationMs)}` : ""}
                    {" · "}
                    <Link href={`/runs/${item.runId}`}>run</Link>
                  </small>
                  {item.error ? <p className="trail-error">{item.error}</p> : null}
                  {item.preview ? <pre>{item.preview}</pre> : null}
                </div>
              </li>
            ),
          )}
        </ol>
      </div>
      <aside className="trail-side">
        <div className="trail-card">
          <h3>Model</h3>
          <p className="mono">{model}</p>
        </div>
        <div className="trail-card">
          <h3>Files touched</h3>
          {files.length === 0 ? (
            <p className="trail-empty">None in recent runs.</p>
          ) : (
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
          )}
        </div>
        <Link href={`/agents/${agentId}/console`} className="btn">
          <FolderOpen size={14} aria-hidden /> Open filesystem
        </Link>
        <Link href={`/agents/${agentId}`} className="link-btn">
          <Terminal size={14} aria-hidden /> Agent profile
        </Link>
      </aside>
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
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}
