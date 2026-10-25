import Link from "next/link";
import { LiveRefresh } from "@/components/relay/live-refresh";
import { observabilityEnabled } from "@/lib/env";
import { relativeTime } from "@/lib/format";
import { listAuthEvents, listPromptLogs } from "@/lib/observability";
import { requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

const sourceLabel: Record<string, string> = {
  run: "Run",
  builder: "Builder",
  compose: "Composer",
};

export default async function ObservabilityPage() {
  const workspace = await requireWorkspace();
  const configured = observabilityEnabled();
  const [prompts, auths] = configured
    ? await Promise.all([listPromptLogs(workspace.id, 60), listAuthEvents(30)])
    : [null, null];

  return (
    <div className="page">
      <div className="page-top">
        <h1>Observability</h1>
      </div>
      <LiveRefresh intervalMs={4000} />
      <p className="lede">
        Live prompts, thinking, completions, and Google sign-ins stored in Supabase as each
        turn finishes. Secrets are redacted before they leave the server. This page refreshes
        every few seconds.
      </p>

      {!configured ? (
        <p className="empty">
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code>, then
          run <code>supabase/schema.sql</code> in the SQL editor.
        </p>
      ) : null}

      <section className="section">
        <h2>Google logins{auths && auths.length > 0 ? ` · ${auths.length}` : ""}</h2>
        {auths?.length ? (
          <ul className="list">
            {auths.map((row) => (
              <li key={row.id}>
                <div>
                  <b>
                    {row.event.replace("_", " ")}
                    {row.provider ? ` · ${row.provider}` : ""}
                  </b>
                  <small>
                    {row.email ?? "unknown"} · {relativeTime(row.createdAt)}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">{configured ? "No sign-ins recorded yet." : "Auth log is offline."}</p>
        )}
      </section>

      <section className="section">
        <h2>Prompt traces{prompts && prompts.length > 0 ? ` · ${prompts.length}` : ""}</h2>
        {prompts?.length ? (
          <ul className="prompt-log">
            {prompts.map((row) => {
              const thinking = row.messages.find((message) => message.role === "thinking")?.content;
              const preview =
                row.completion?.slice(0, 180) ||
                row.messages.find((message) => message.role === "user")?.content.slice(0, 180) ||
                "No text";
              const tokens = (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
              return (
                <li key={row.id}>
                  <div>
                    <b>
                      {sourceLabel[row.source] ?? row.source}
                      {row.model ? ` · ${row.model}` : ""}
                    </b>
                    <small>
                      {relativeTime(row.createdAt)}
                      {tokens ? ` · ${tokens.toLocaleString()} tokens` : ""}
                      {thinking ? " · thinking" : ""}
                      {row.runId ? (
                        <>
                          {" · "}
                          <Link href={`/runs/${row.runId}`}>Open run</Link>
                        </>
                      ) : null}
                    </small>
                    {thinking ? <small className="detail">Thinking: {thinking.slice(0, 180)}</small> : null}
                    <small className="detail">{preview}</small>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty">
            {configured
              ? "No live prompts yet. Dispatch a run or draft an agent."
              : "Prompt log is offline."}
          </p>
        )}
      </section>
    </div>
  );
}
