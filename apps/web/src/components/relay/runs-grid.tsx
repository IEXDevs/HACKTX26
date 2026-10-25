"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "@/components/icons";
import type { RunTile } from "@/lib/views";
import { AdvancedSwitch, useAdvanced } from "./advanced";
import { StartRun, type RunnableAgent } from "./start-run";

export function RunsGrid({ runs, agents }: { runs: RunTile[]; agents: RunnableAgent[] }) {
  const router = useRouter();
  const [advanced, toggleAdvanced] = useAdvanced(),
    [search, setSearch] = useState("");
  const live = runs.some((run) => run.group !== "recent");
  // Keep live runs current without a manual reload.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [live, router]);

  const visible = runs.filter((run) =>
    [run.name, run.goal].join(" ").toLowerCase().includes(search.toLowerCase()),
  );
  const groups = [
    { title: "Waiting for you", items: visible.filter((r) => r.group === "waiting") },
    { title: "Running", items: visible.filter((r) => r.group === "running") },
    { title: "Recent", items: visible.filter((r) => r.group === "recent") },
  ].filter((group) => group.items.length);

  return (
    <div className="page">
      <div className="page-top">
        <h1>Runs</h1>
        <div className="page-actions">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
          <StartRun agents={agents} />
        </div>
      </div>
      {runs.length > 0 && (
        <div className="toolbar">
          <label className="search">
            <Search size={16} aria-hidden />
            <span className="sr-only">Search runs</span>
            <input
              type="search"
              placeholder="Search runs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
      )}
      {groups.length ? (
        groups.map((group) => (
          <section className="section" key={group.title} style={{ marginTop: 20 }}>
            <h2>
              {group.title} · {group.items.length}
            </h2>
            <div className="tile-grid">
              {group.items.map((run) => (
                <article className="tile" key={run.id}>
                  <Link href={`/runs/${run.id}`} className="tile-main">
                    <span className={`tile-status ${run.tone}`}>{run.label}</span>
                    <b>{run.name}</b>
                    <p>{run.goal}</p>
                  </Link>
                  <footer className="tile-foot">
                    <span>{advanced ? run.detail : `Started ${run.when}`}</span>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        ))
      ) : (
        <p className="empty">
          {search ? "No runs match that search." : "No runs yet. Start one with New run."}
        </p>
      )}
    </div>
  );
}
