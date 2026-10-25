export const dynamic = "force-static";

export default function PrivacyPage() {
  return (
    <div className="page">
      <div className="page-top">
        <h1>Privacy</h1>
      </div>
      <p className="lede">
        Astronom is an agent operations workbench. This page is the record of what a
        workspace stores, where it lives, and who else sees it. Last updated 25 Oct 2026.
      </p>

      <div className="legal">
        <article>
          <h2>What this workspace stores</h2>
          <ul>
            <li>
              <b>Account.</b> Google email, name, and avatar when you sign in.
            </li>
            <li>
              <b>Workspace.</b> Agents, prompts, grants, connectors, evaluations, and
              operator actions.
            </li>
            <li>
              <b>Runs.</b> Goals, tool calls, thinking, completions, files touched, and
              spend. Each run is an append-only event log on the server.
            </li>
            <li>
              <b>Usage.</b> Live model calls: tokens, cost, model, agent, and source
              (run, builder, or composer).
            </li>
            <li>
              <b>Prompt traces.</b> Messages, thinking, and completions. Secrets are
              redacted and long text is clipped before it is stored.
            </li>
            <li>
              <b>Auth.</b> Sign-in and sign-out events, including provider and time.
            </li>
          </ul>
        </article>

        <article>
          <h2>Where it lives</h2>
          <ul>
            <li>
              <b>This server.</b> Agents, runs, and traces sit in the local SQLite
              database under the web app. Sandbox files live on disk per agent.
            </li>
            <li>
              <b>Supabase.</b> When the project URL and service role key are set, live
              usage, prompt traces, auth events, and activity sync to your Supabase
              project. Writes are best-effort: a downed ledger never fails a run.
            </li>
            <li>
              <b>This browser.</b> Theme (light or dark) is saved in local storage on
              this device only.
            </li>
          </ul>
        </article>

        <article>
          <h2>What leaves the server</h2>
          <ul>
            <li>
              Prompts, thinking, and tool context go to the configured model provider
              so a run can complete. That is required for live inference.
            </li>
            <li>
              Telemetry rows go to your Supabase project. Row-level security keeps
              those tables off the browser client; only the Next.js server writes them.
            </li>
            <li>
              We do not sell workspace data. We do not send traces to advertisers.
            </li>
          </ul>
        </article>

        <article>
          <h2>Live logging</h2>
          <p>
            Usage, Observability, run traces, and the workflow map read the same live
            ledgers. Model turns write tokens and prompt traces as they finish. Thinking
            is stored on the run log immediately and synced with the prompt trace for
            that turn. The map refreshes agent status, spend, tokens, and tasks every
            few seconds. Dashboards refresh while you have them open.
          </p>
        </article>

        <article>
          <h2>Retention</h2>
          <p>
            Data stays until you delete the local database, the agent sandbox, or the
            Supabase project. There is no separate third-party archive.
          </p>
        </article>

        <article>
          <h2>Your controls</h2>
          <p>
            Open Usage for token spend, Observability for prompt traces and sign-ins,
            and a run’s trace for thinking and tool calls. Sign out from the sidebar.
            Appearance lives in Settings and does not leave this browser.
          </p>
        </article>
      </div>
    </div>
  );
}
