"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Plus, Search } from "@/components/icons";
import type { WorkflowTile } from "@/lib/views";
import { useAutoRefresh } from "./use-auto-refresh";

/** Workflows index: one tile per top-level agent, grouped by its latest run. */
export function Workflows({ workflows }: { workflows: WorkflowTile[] }) {
  const router = useRouter();
  const [archived, setArchived] = useState(false),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  const live = workflows.some((w) => !w.archived && w.group !== "recent");
  // Keep running workflows current without a manual reload.
  useAutoRefresh(live, 4000);

  async function toggleArchive(w: WorkflowTile) {
    setBusy(w.id);
    setError("");
    try {
      const response = await fetch(`/api/agents/${w.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: w.archived ? "active" : "archived" }),
      });
      if (!response.ok) {
        const value = await response.json().catch(() => ({}));
        throw new Error(value.error ?? "The workflow was not changed.");
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const archivedCount = workflows.filter((w) => w.archived).length;
  const visible = workflows
    .filter((w) => w.archived === archived)
    .filter((w) => [w.name, w.task].join(" ").toLowerCase().includes(search.toLowerCase()));
  const groups = (
    archived
      ? [{ title: "Archived", items: visible }]
      : [
          { title: "Waiting for you", items: visible.filter((w) => w.group === "waiting") },
          { title: "Running", items: visible.filter((w) => w.group === "running") },
          { title: "Recent", items: visible.filter((w) => w.group === "recent") },
        ]
  ).filter((group) => group.items.length);

  return (
    <div className="page">
      <div className="page-top">
        <h1>Workflows</h1>
        <div className="page-actions">
          <Link href="/workflows/new" className="btn primary">
            <Plus size={15} aria-hidden />
            New workflow
          </Link>
        </div>
      </div>
      {workflows.length > 0 && (
        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Show workflows">
            <button aria-pressed={!archived} onClick={() => setArchived(false)}>
              Active
            </button>
            <button aria-pressed={archived} onClick={() => setArchived(true)}>
              Archived{archivedCount > 0 && ` · ${archivedCount}`}
            </button>
          </div>
          <label className="search">
            <Search size={16} aria-hidden />
            <span className="sr-only">Search workflows</span>
            <input
              type="search"
              placeholder="Search workflows"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
      )}
      {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
      {groups.length ? (
        groups.map((group) => (
          <section className="section" key={group.title} style={{ marginTop: 20 }}>
            <h2>
              {group.title} · {group.items.length}
            </h2>
            <div className="tile-grid spaced">
              {group.items.map((w) => (
                <article className="tile" key={w.id}>
                  <Link href={`/workflows/${w.id}`} className="tile-main">
                    <span className={`tile-status ${w.archived ? "" : w.tone}`}>
                      {w.archived ? "Archived" : w.label}
                    </span>
                    <b>{w.name}</b>
                    <p>{w.task || "No task yet."}</p>
                  </Link>
                  <footer className="tile-foot">
                    <span>
                      {w.team ? `Team of ${w.team + 1} agents` : "Single agent"}
                    </span>
                    <button
                      className="icon-btn"
                      aria-label={`${w.archived ? "Restore" : "Archive"} ${w.name}`}
                      title={w.archived ? "Restore" : "Archive"}
                      disabled={busy === w.id}
                      onClick={() => void toggleArchive(w)}
                    >
                      <Archive size={16} />
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        ))
      ) : (
        <p className="empty">
          {archived
            ? "Nothing is archived."
            : search
              ? "No workflows match that search."
              : "No workflows yet."}
        </p>
      )}
    </div>
  );
}
