"use client";

import { useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Database,
  Globe,
  KeyRound,
  LoaderCircle,
  Plug,
  Search,
  Terminal,
  type IconProps,
} from "@/components/icons";
import { AdvancedSwitch, useAdvanced } from "./advanced";

export interface ConnectorCard {
  id: string;
  name: string;
  kind: "mcp" | "api" | "cli" | "rag" | "web";
  description: string;
  status: "connected" | "degraded" | "disconnected";
  synced: string | null;
}
export interface KeyRow {
  id: string;
  name: string;
  hint: string;
  connector: string | null;
  used: string | null;
}
export interface DocHit {
  id: string;
  title: string;
  snippet: string;
}
export interface ToolRow {
  name: string;
  label: string;
  risk: string;
}

const kindIcon: Record<ConnectorCard["kind"], ComponentType<IconProps>> = {
  mcp: Plug,
  api: Globe,
  cli: Terminal,
  rag: Database,
  web: Search,
};
const kindWord: Record<ConnectorCard["kind"], string> = {
  mcp: "Tool server",
  api: "Service",
  cli: "Command line",
  rag: "Documents",
  web: "Web search",
};

export function ConnectorsView({
  connectors,
  keys,
  query,
  hits,
  documents,
  tools,
}: {
  connectors: ConnectorCard[];
  keys: KeyRow[];
  query: string;
  hits: DocHit[];
  documents: number;
  tools: ToolRow[];
}) {
  const router = useRouter();
  const [advanced, toggleAdvanced] = useAdvanced(),
    [search, setSearch] = useState(query),
    [checked, setChecked] = useState<Record<string, "ok" | "failed">>({}),
    [busy, setBusy] = useState<string | null>(null);

  async function verify(id: string) {
    setBusy(id);
    try {
      const response = await fetch(`/api/credentials/${id}/verify`, { method: "POST" });
      const value = await response.json().catch(() => ({}));
      setChecked((c) => ({ ...c, [id]: response.ok && value.ok ? "ok" : "failed" }));
    } catch {
      setChecked((c) => ({ ...c, [id]: "failed" }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <div className="page-top">
        <h1>Connectors</h1>
        <div className="page-actions">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
        </div>
      </div>

      <div className="tile-grid">
        {connectors.map((c) => {
          const Icon = kindIcon[c.kind];
          return (
            <article className="tile" key={c.id} style={{ minHeight: 150 }}>
              <div className="tile-main">
                <span className="tile-icon" aria-hidden>
                  <Icon size={18} />
                </span>
                <b>{c.name}</b>
                <p>{advanced ? c.description : kindWord[c.kind]}</p>
              </div>
              <footer className="tile-foot">
                <span className={`conn-state ${c.status}`}>
                  {c.status === "connected" ? (
                    <>
                      <Check size={13} strokeWidth={2.2} />
                      {c.synced ? `Synced ${c.synced}` : "Ready"}
                    </>
                  ) : c.status === "degraded" ? (
                    "Having trouble"
                  ) : (
                    "Not connected"
                  )}
                </span>
              </footer>
            </article>
          );
        })}
      </div>

      <section className="section">
        <h2>Saved keys</h2>
        {keys.length ? (
          <ul className="list">
            {keys.map((k) => (
              <li key={k.id}>
                <span className="tile-icon" style={{ margin: 0 }} aria-hidden>
                  <KeyRound size={16} />
                </span>
                <div>
                  <b>{k.name}</b>
                  <small>
                    {k.connector ? `${k.connector} · ` : ""}
                    {k.used ? `Used ${k.used}` : "Not used yet"}
                    {advanced ? ` · ${k.hint}` : ""}
                  </small>
                </div>
                {checked[k.id] === "ok" ? (
                  <span className="conn-state connected">
                    <Check size={13} strokeWidth={2.2} /> Works
                  </span>
                ) : checked[k.id] === "failed" ? (
                  <span className="conn-state degraded">Check failed</span>
                ) : null}
                <button className="btn small" disabled={busy === k.id} onClick={() => void verify(k.id)}>
                  {busy === k.id && <LoaderCircle size={14} className="animate-spin" />}
                  Check
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No saved keys.</p>
        )}
      </section>

      <section className="section">
        <div className="toolbar">
          <h2>Search your documents</h2>
          <span className="detail" style={{ color: "var(--muted)" }}>
            {documents} documents
          </span>
        </div>
        <form
          className="search"
          style={{ flex: "none", maxWidth: 560 }}
          onSubmit={(e) => {
            e.preventDefault();
            router.push(search.trim() ? `/connectors?q=${encodeURIComponent(search.trim())}` : "/connectors");
          }}
        >
          <Search size={16} />
          <label className="sr-only" htmlFor="doc-search">
            Search documents
          </label>
          <input
            id="doc-search"
            type="search"
            placeholder="What do agents know about…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
        {query && (
          <ul className="list" style={{ marginTop: 12 }}>
            {hits.length ? (
              hits.map((h) => (
                <li key={h.id}>
                  <div>
                    <b>{h.title}</b>
                    <small>{h.snippet}</small>
                  </div>
                </li>
              ))
            ) : (
              <li>
                <div>
                  <small>Nothing matches “{query}”.</small>
                </div>
              </li>
            )}
          </ul>
        )}
      </section>

      {advanced && (
        <section className="section">
          <h2>Tools agents can use</h2>
          <div className="table">
            <table>
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Name</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.name}>
                    <td>{t.label}</td>
                    <td className="mono">{t.name}</td>
                    <td>{t.risk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
