"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, Pause, Play, ScrollText, ShieldCheck, Terminal } from "@/components/icons";
import { TemplateProposals, type ProposalView } from "@/components/agents/template-proposals";
import { plainText } from "@/lib/plain-text";
import type { RunTile } from "@/lib/views";
import { RichText } from "./rich-text";
import { StartRun } from "./start-run";

export interface AgentDetailView {
  id: string;
  name: string;
  summary: string;
  instructions: string;
  defaultGoal: string;
  status: string;
  canSpawnSubagents: boolean;
  proposeTemplates: boolean;
  parent: { id: string; name: string } | null;
  team: Array<{ id: string; name: string; summary: string; role: string; status: string }>;
  proposals: ProposalView[];
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
  const [tab, setTab] = useState<"profile" | "proposals">("profile"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pendingProposals = agent.proposals.filter((proposal) => proposal.status === "pending").length;

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
        <Link href={agent.parent ? `/agents/${agent.parent.id}` : "/agents/library"} className="glass-pill">
          <ArrowLeft size={16} aria-hidden />
          {agent.parent ? agent.parent.name : "Agents"}
        </Link>
        <div className="composer-tabs">
          <button
            type="button"
            className={"glass-pill" + (tab === "profile" ? " on" : "")}
            onClick={() => setTab("profile")}
          >
            Profile
          </button>
          <button
            type="button"
            className={"glass-pill" + (tab === "proposals" ? " on" : "")}
            onClick={() => setTab("proposals")}
          >
            Templates{pendingProposals > 0 ? ` · ${pendingProposals}` : ""}
          </button>
        </div>
        <div className="composer-bar-end">
          <Link href={`/agents/${agent.id}/trail`} className="glass-pill">
            <ScrollText size={15} aria-hidden />
            Trail
          </Link>
          <Link href={`/agents/${agent.id}/console`} className="glass-pill">
            <Terminal size={15} aria-hidden />
            Files
          </Link>
        </div>
      </div>

      <div className="agent-head">
        <span className="composer-orb" aria-hidden />
        <div className="agent-copy">
          <h1 className="composer-title">{agent.name}</h1>
          <p className="composer-summary">
            {agent.status !== "active" ? `${statusWord[agent.status]}. ` : ""}
            Dynamic subagents {agent.canSpawnSubagents ? "on" : "off"}. Template proposals{" "}
            {agent.proposeTemplates ? "on" : "off"}.
            {agent.summary ? ` ${plainText(agent.summary)}` : ""}
          </p>
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
      </div>
      {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}

      {tab === "proposals" ? (
        <TemplateProposals proposals={agent.proposals} />
      ) : (
      <>
      <dl className="spec-strip">
        <div>
          <dt>Model</dt>
          <dd>{agent.advanced.model}</dd>
        </div>
        <div>
          <dt>Hardware</dt>
          <dd>{agent.advanced.hardware}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>{agent.advanced.budget}</dd>
        </div>
        <div>
          <dt>Class</dt>
          <dd>
            {agent.advanced.dataClass} · {agent.advanced.complexity}
          </dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{agent.advanced.tools.length ? agent.advanced.tools.join(" · ") : "None"}</dd>
        </div>
      </dl>

      <div className="page-split">
      <section>
        <h2>Instructions</h2>
        <div className="card">
          <RichText text={agent.instructions} />
        </div>
      </section>

      <section>
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
      </div>

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
                  <p>
                    {member.summary || "No summary yet."}
                  </p>
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}
      </>
      )}
    </div>
  );
}
