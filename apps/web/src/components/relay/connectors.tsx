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
export interface DocRow {
  id: string;
  title: string;
  dataClass: string;
  added: string;
  characters: number;
}

const classWord: Record<string, string> = {
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  restricted: "Restricted",
};

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
}: {
  connectors: ConnectorCard[];
  keys: KeyRow[];
  query: string;
  hits: DocHit[];
  documents: DocRow[];
  tools: ToolRow[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query),
    [checked, setChecked] = useState<Record<string, "ok" | "failed">>({}),
    [busy, setBusy] = useState<string | null>(null),
    [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [dataClass, setDataClass] = useState("internal"),
    [saving, setSaving] = useState(false),
    [docError, setDocError] = useState<string | null>(null);

  async function addDocument() {
    setSaving(true);
    setDocError(null);
    try {
      const response = await fetch("/api/kb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body: text, dataClass }),
      });
      if (!response.ok) {
        const value = await response.json().catch(() => ({}));
        setDocError(typeof value.error === "string" ? value.error : "Could not save the document.");
        return;
      }
      setTitle("");
      setText("");
      router.refresh();
    } catch {
      setDocError("Could not save the document.");
    } finally {
      setSaving(false);
    }
  }

  async function removeDocument(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/kb/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

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
      </div>

      {connectors.length === 0 && <p className="empty">No connectors yet.</p>}
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
                <p>{kindWord[c.kind]}</p>
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

      <div className="page-split">
      <section>
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

      <section>
        <div className="toolbar">
          <h2>Your documents</h2>
          <span className="detail" style={{ color: "var(--muted)" }}>
            {documents.length} {documents.length === 1 ? "document" : "documents"}
          </span>
        </div>
        <form
          className="search"
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

        {documents.length ? (
          <ul className="list" style={{ marginTop: 12 }}>
            {documents.map((d) => (
              <li key={d.id}>
                <div>
                  <b>{d.title}</b>
                  <small>
                    {classWord[d.dataClass] ?? d.dataClass} · {d.characters.toLocaleString()} characters ·
                    Added {d.added}
                  </small>
                </div>
                <button
                  className="btn small"
                  disabled={busy === d.id}
                  onClick={() => void removeDocument(d.id)}
                >
                  {busy === d.id && <LoaderCircle size={14} className="animate-spin" />}
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No documents yet. Add one and agents can search it.</p>
        )}

        <form
          style={{ marginTop: 16, display: "grid", gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            void addDocument();
          }}
        >
          <label className="field">
            Title
            <input
              value={title}
              maxLength={120}
              placeholder="What is this document?"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            Who may read it
            <select value={dataClass} onChange={(e) => setDataClass(e.target.value)}>
              <option value="public">Public</option>
              <option value="internal">Internal</option>
              <option value="confidential">Confidential</option>
              <option value="restricted">Restricted</option>
            </select>
          </label>
          <label className="field">
            Text
            <textarea
              value={text}
              maxLength={60000}
              rows={6}
              placeholder="Paste the document here."
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {docError && <p className="error-text">{docError}</p>}
          <div>
            <button
              type="submit"
              className="btn primary"
              disabled={saving || title.trim().length < 2 || !text.trim()}
            >
              {saving && <LoaderCircle size={15} className="animate-spin" aria-hidden />}
              Add document
            </button>
          </div>
        </form>
      </section>
      </div>
    </div>
  );
}
