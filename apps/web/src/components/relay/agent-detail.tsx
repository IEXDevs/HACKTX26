"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, Pause, Play, ShieldCheck, Terminal } from "@/components/icons";
import type { RunTile } from "@/lib/views";
import { AdvancedSwitch, useAdvanced } from "./advanced";
import { StartRun } from "./start-run";

export interface AgentDetailView {
  id: string;
  name: string;
  summary: string;
  instructions: string;
  defaultGoal: string;
  status: string;
  parent: { id: string; name: string } | null;
  team: Array<{ id: string; name: string; summary: string; role: string; status: string }>;
  runs: RunTile[];
  advanced: {
    model: string;
    hardware: string;
    dataClass: string;
    complexity: string;
    budget: string;
    tools: string[];
    grants: Array<{ resource: string; scopes: string }>;
    prompt: Array<{ name: string; level: string; locked: boolean }>;
  };
}

const statusWord: Record<string, string> = {
  active: "Ready",
  paused: "Paused",
  draft: "Draft",
  archived: "Archived",
};

export function AgentDetail({ agent }: { agent: AgentDetailView }) {
  const router = useRouter();
  const [advanced, toggleAdvanced] = useAdvanced(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  async function setStatus(status: "active" | "paused") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const value = await response.json().catch(() => ({}));
        throw new Error(
          value.issues?.map((issue: { message: string }) => issue.message).join(" ") ||
            value.error ||
            "The change was not saved.",
        );
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="composer">
      <div className="composer-bar">
        <Link href={agent.parent ? `/agents/${agent.parent.id}` : "/agents"} className="glass-pill">
          <ArrowLeft size={16} aria-hidden />
          {agent.parent ? agent.parent.name : "Agents"}
        </Link>
        <div className="composer-bar-end">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
          <Link href={`/agents/${agent.id}/console`} className="glass-pill">
            <Terminal size={15} aria-hidden />
            Files
          </Link>
        </div>
      </div>

      <div className="composer-hero" style={{ marginBottom: 20 }}>
        <span className="composer-orb" aria-hidden />
        <h1 className="composer-title">{agent.name}</h1>
        {agent.summary && <p className="composer-summary">{agent.summary}</p>}
        <div className="agent-actions">
          {agent.status !== "active" && <span className="tag warn">{statusWord[agent.status]}</span>}
        </div>
        <div className="agent-actions">
          {agent.status === "active" ? (
            <>
              {!agent.parent && (
                <StartRun
                  agents={[{ id: agent.id, name: agent.name, status: agent.status, defaultGoal: agent.defaultGoal }]}
                  initialAgentId={agent.id}
                  label="Start run"
                />
              )}
              <button className="btn" disabled={busy} onClick={() => void setStatus("paused")}>
                <Pause size={15} aria-hidden />
                Pause
              </button>
            </>
          ) : (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void setStatus("active")}
            >
              <Play size={15} aria-hidden />
              {agent.status === "draft" ? "Publish" : "Resume"}
            </button>
          )}
        </div>
        {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
      </div>

      <section className="section">
        <h2>Instructions</h2>
        <div className="card">
          <p>{agent.instructions}</p>
        </div>
      </section>

      {agent.team.length > 0 && (
        <section className="section">
          <h2>Team · {agent.team.length}</h2>
          <div className="tile-grid">
            {agent.team.map((member) => (
              <article className="tile" key={member.id} style={{ minHeight: 140 }}>
                <Link href={`/agents/${member.id}`} className="tile-main">
                  <span className="tile-icon" aria-hidden>
                    {member.role === "security" ? <ShieldCheck size={18} /> : <Bot size={18} />}
                  </span>
                  <b>{member.name}</b>
                  <p>{member.summary || "No summary yet."}</p>
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>Recent runs</h2>
        {agent.runs.length ? (
          <ul className="list">
            {agent.runs.map((run) => (
              <li key={run.id}>
                <div>
                  <b>{run.goal}</b>
                  <small className={run.tone === "stopped" ? "stopped" : ""}>
                    {run.label} · {run.when}
                  </small>
                  {advanced && <small className="detail">{run.detail}</small>}
                </div>
                <Link href={`/runs/${run.id}`} className="btn small">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">This agent has not run yet.</p>
        )}
      </section>

      {advanced && (
        <section className="section">
          <h2>Configuration</h2>
          <div className="card">
            <dl className="kv">
              <dt>Model today</dt>
              <dd>{agent.advanced.model}</dd>
              <dt>Hardware</dt>
              <dd>{agent.advanced.hardware}</dd>
              <dt>Task weight</dt>
              <dd>{agent.advanced.complexity}</dd>
              <dt>Data class</dt>
              <dd>{agent.advanced.dataClass}</dd>
              <dt>Budget per run</dt>
              <dd>{agent.advanced.budget}</dd>
              <dt>Tools</dt>
              <dd>{agent.advanced.tools.join(", ") || "None"}</dd>
              <dt>Standing permissions</dt>
              <dd>
                {agent.advanced.grants.length
                  ? agent.advanced.grants.map((g) => `${g.resource} (${g.scopes})`).join(", ")
                  : "None. Every action asks first."}
              </dd>
              <dt>Inherited rules</dt>
              <dd>
                {agent.advanced.prompt.length
                  ? agent.advanced.prompt
                      .map((p) => `${p.name} (${p.level}${p.locked ? ", locked" : ""})`)
                      .join(", ")
                  : "None"}
              </dd>
            </dl>
          </div>
        </section>
      )}
    </div>
  );
}
