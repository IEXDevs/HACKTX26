"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Plus, Search, ShieldCheck } from "@/components/icons";
import { AdvancedSwitch, useAdvanced } from "./advanced";
import { StartRun } from "./start-run";

export interface AgentTile {
  id: string;
  name: string;
  summary: string;
  status: string;
  defaultGoal: string;
  role: string;
  team: number;
  runs: number;
  model: string;
  spend: string;
}

const statusWord: Record<string, string> = {
  active: "Ready",
  paused: "Paused",
  draft: "Draft",
  archived: "Archived",
};

export function AgentsGrid({ agents }: { agents: AgentTile[] }) {
  const router = useRouter();
  const [advanced, toggleAdvanced] = useAdvanced(),
    [search, setSearch] = useState("");
  const visible = agents.filter((a) =>
    [a.name, a.summary].join(" ").toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="page">
      <div className="page-top">
        <h1>Agents</h1>
        <div className="page-actions">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
          <button className="btn primary" onClick={() => router.push("/agents/new")}>
            <Plus size={15} aria-hidden />
            New agent
          </button>
        </div>
      </div>
      <div className="toolbar">
        <label className="search">
          <Search size={16} aria-hidden />
          <span className="sr-only">Search agents</span>
          <input
            type="search"
            placeholder="Search agents"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {visible.length ? (
        <div className="tile-grid">
          {visible.map((a) => (
            <article className="tile" key={a.id}>
              <Link href={`/agents/${a.id}`} className="tile-main">
                <span className="tile-icon" aria-hidden>
                  {a.role === "security" ? <ShieldCheck size={18} /> : <Bot size={18} />}
                </span>
                <b>
                  {a.name}
                  {a.status !== "active" && (
                    <em className={"tag" + (a.status === "paused" ? " warn" : "")}>
                      {statusWord[a.status] ?? a.status}
                    </em>
                  )}
                </b>
                <p>{a.summary || "No summary yet."}</p>
              </Link>
              <footer className="tile-foot">
                <span>
                  {advanced
                    ? `${a.model} · ${a.spend}`
                    : a.team
                      ? `Team of ${a.team + 1} agents`
                      : "Works alone"}
                  {advanced ? null : a.runs ? ` · ${a.runs} runs` : ""}
                </span>
                {a.status === "active" && (
                  <StartRun
                    agents={[{ id: a.id, name: a.name, status: a.status, defaultGoal: a.defaultGoal }]}
                    initialAgentId={a.id}
                    label="Run"
                    className="btn small"
                  />
                )}
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty">No agents match that search.</p>
      )}
    </div>
  );
}
