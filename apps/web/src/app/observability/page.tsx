import Link from "next/link";
import { LiveRefresh } from "@/components/relay/live-refresh";
import { observabilityEnabled } from "@/lib/env";
import { clockTime, relativeTime } from "@/lib/format";
import { listPromptLogs } from "@/lib/observability";
import { listAgents, requireWorkspace } from "@/lib/queries";
import { plainText } from "@/lib/plain-text";

export const dynamic = "force-dynamic";

const sourceLabel: Record<string, string> = {
  run: "run",
  builder: "builder",
  compose: "compose",
};

export default async function ObservabilityPage() {
  const workspace = await requireWorkspace();
  const configured = observabilityEnabled();
  const [prompts, agents] = await Promise.all([
    configured ? listPromptLogs(workspace.id, 80) : Promise.resolve(null),
    listAgents(workspace.id),
  ]);
  const names = new Map(agents.map((agent) => [agent.id, agent.name]));

  return (
    <div className="page">
      <div className="page-top">
        <h1>Observability</h1>
      </div>
      <LiveRefresh intervalMs={4000} />

      {!configured ? (
        <p className="empty">
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code>, then
          run <code>supabase/schema.sql</code> in the SQL editor.
        </p>
      ) : null}

      <section className="section">
        <h2>Prompt traces{prompts && prompts.length > 0 ? ` · ${prompts.length}` : ""}</h2>
        {prompts?.length ? (
          <ol className="log-stream">
            {prompts.map((row) => {
              const thinking = row.messages.find((message) => message.role === "thinking")?.content;
              const preview = plainText(
                row.completion ||
                  row.messages.find((message) => message.role === "user")?.content ||
                  thinking ||
                  "No text",
              ).slice(0, 160);
              const tokens = (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
              const who = row.agentId ? names.get(row.agentId) : null;
              return (
                <li key={row.id} className="log-row log-thought">
                  <time dateTime={row.createdAt.toISOString()}>
                    {clockTime(row.createdAt)}
                  </time>
                  <span className="log-kind">{sourceLabel[row.source] ?? row.source}</span>
                  <span className="log-who">
                    {who && row.agentId ? (
                      <Link href={`/agents/${row.agentId}/trail`} className="log-who-link">
                        {who}
                      </Link>
                    ) : (
                      row.model ?? "model"
                    )}
                  </span>
                  <span className="log-text">
                    {preview}
                    <small>
                      {relativeTime(row.createdAt)}
                      {row.model ? ` · ${row.model}` : ""}
                      {tokens ? ` · ${tokens.toLocaleString()} tok` : ""}
                      {thinking ? " · thinking" : ""}
                      {row.runId ? (
                        <>
                          {" · "}
                          <Link href={`/runs/${row.runId}`}>run</Link>
                        </>
                      ) : null}
                    </small>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="empty">
            {configured
              ? "No live prompts yet."
              : "Prompt log is offline."}
          </p>
        )}
      </section>
    </div>
  );
}
