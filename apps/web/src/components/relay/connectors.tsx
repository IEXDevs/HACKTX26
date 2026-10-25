"use client";

import { useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Globe,
  KeyRound,
  LoaderCircle,
  Plug,
  Search,
  type IconProps,
} from "@/components/icons";

export interface ConnectorView {
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  category: string | null;
  popular: boolean;
  builtin: boolean;
  status: "connected" | "pending" | "disconnected" | "error";
  connected: boolean;
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

const statusWord: Record<ConnectorView["status"], string> = {
  connected: "Connected",
  pending: "Waiting on you",
  disconnected: "Not connected",
  error: "Needs attention",
};

function KindIcon({ slug, logoUrl }: { slug: string; logoUrl: string | null }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt="" width={18} height={18} className="conn-logo" />
    );
  }
  const Icon: ComponentType<IconProps> = slug === "serpapi" ? Search : slug === "github" ? Plug : Globe;
  return (
    <span className="tile-icon" aria-hidden>
      <Icon size={18} />
    </span>
  );
}

function initialMessage(composio: boolean, linked?: string): string | null {
  if (linked === "1") return "App linked. Agents on your next run can use it.";
  if (linked === "0") return "Could not finish linking. Try Connect again.";
  if (!composio) return "Set COMPOSIO_API_KEY in .env.local to link apps. Search still works over the popular catalog.";
  return null;
}

export function ConnectorsView({
  initial,
  query,
  composio,
  serpapi,
  linked,
  keys,
  docQuery,
  hits,
  documents,
}: {
  initial: ConnectorView[];
  query: string;
  composio: boolean;
  serpapi: boolean;
  linked?: string;
  keys: KeyRow[];
  docQuery: string;
  hits: DocHit[];
  documents: DocRow[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const [docSearch, setDocSearch] = useState(docQuery);
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(initialMessage(composio, linked));
  const [checked, setChecked] = useState<Record<string, "ok" | "failed">>({});
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [dataClass, setDataClass] = useState("internal");
  const [saving, setSaving] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  const connected = useMemo(() => rows.filter((row) => row.connected), [rows]);
  const popular = useMemo(
    () => rows.filter((row) => row.popular && !row.connected),
    [rows],
  );
  const rest = useMemo(
    () => rows.filter((row) => !row.popular && !row.connected),
    [rows],
  );

  function pushQuery(nextApp: string, nextDoc: string) {
    const params = new URLSearchParams();
    if (nextApp) params.set("q", nextApp);
    if (nextDoc) params.set("doc", nextDoc);
    const qs = params.toString();
    router.push(qs ? `/connectors?${qs}` : "/connectors");
  }

  async function refresh(nextQuery = search) {
    const url = nextQuery.trim()
      ? `/api/connectors?q=${encodeURIComponent(nextQuery.trim())}`
      : "/api/connectors";
    const response = await fetch(url);
    const value = (await response.json().catch(() => ({}))) as { connectors?: ConnectorView[] };
    if (Array.isArray(value.connectors)) setRows(value.connectors);
  }

  async function connect(slug: string, builtin: boolean) {
    if (builtin) {
      setMessage(
        serpapi
          ? "Web search is already on for agents in this workspace."
          : "Set SERPAPI_API_KEY in .env.local to enable web search for agents.",
      );
      return;
    }
    setBusy(slug);
    setMessage(null);
    try {
      const response = await fetch(`/api/connectors/${encodeURIComponent(slug)}/connect`, {
        method: "POST",
      });
      const value = (await response.json().catch(() => ({}))) as { redirectUrl?: string; error?: string };
      if (!response.ok || !value.redirectUrl) {
        setMessage(value.error ?? "Could not start the connect flow.");
        return;
      }
      window.location.assign(value.redirectUrl);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(slug: string) {
    setBusy(slug);
    setMessage(null);
    try {
      const response = await fetch(`/api/connectors/${encodeURIComponent(slug)}/disconnect`, {
        method: "POST",
      });
      const value = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setMessage(value.error ?? "Could not disconnect.");
        return;
      }
      await refresh();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

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

  function Card({ connector }: { connector: ConnectorView }) {
    const actionLabel = connector.builtin
      ? connector.connected
        ? "Ready"
        : "Needs key"
      : connector.connected
        ? "Disconnect"
        : "Connect";
    return (
      <article className="tile" key={connector.slug} style={{ minHeight: 150 }}>
        <div className="tile-main">
          <KindIcon slug={connector.slug} logoUrl={connector.logoUrl} />
          <b>{connector.name}</b>
          <p>{connector.description || connector.category || connector.slug}</p>
        </div>
        <footer className="tile-foot">
          <span className={`conn-state ${connector.status === "connected" ? "connected" : connector.status === "error" ? "degraded" : ""}`}>
            {connector.status === "connected" ? <Check size={13} strokeWidth={2.2} /> : null}
            {statusWord[connector.status]}
          </span>
          <button
            className="btn small"
            disabled={busy === connector.slug || (connector.builtin && connector.connected)}
            onClick={() =>
              void (connector.connected && !connector.builtin
                ? disconnect(connector.slug)
                : connect(connector.slug, connector.builtin))
            }
          >
            {busy === connector.slug && <LoaderCircle size={14} className="animate-spin" />}
            {actionLabel}
          </button>
        </footer>
      </article>
    );
  }

  return (
    <div className="page">
      <div className="page-top">
        <h1>Connectors</h1>
      </div>

      <form
        className="search conn-search"
        onSubmit={(event) => {
          event.preventDefault();
          const next = search.trim();
          pushQuery(next, docSearch.trim());
          void refresh(next);
        }}
      >
        <Search size={16} />
        <label className="sr-only" htmlFor="connector-search">
          Search apps
        </label>
        <input
          id="connector-search"
          type="search"
          placeholder="Search GitHub, Gmail, Slack, Notion…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </form>

      {message ? <p className="detail conn-note">{message}</p> : null}

      {connected.length > 0 ? (
        <section>
          <h2>Linked</h2>
          <div className="tile-grid spaced">
            {connected.map((connector) => (
              <Card key={connector.slug} connector={connector} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2>{query ? "Matches" : "Popular"}</h2>
        {popular.length || rest.length ? (
          <div className="tile-grid spaced">
            {(query ? [...popular, ...rest] : popular).map((connector) => (
              <Card key={connector.slug} connector={connector} />
            ))}
          </div>
        ) : (
          <p className="empty">Nothing matches “{query}”.</p>
        )}
      </section>

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
            pushQuery(search.trim(), docSearch.trim());
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
            value={docSearch}
            onChange={(e) => setDocSearch(e.target.value)}
          />
        </form>
        {docQuery && (
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
                  <small>Nothing matches “{docQuery}”.</small>
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
          <p className="empty" style={{ marginTop: 12 }}>
            No documents yet. Add one and agents can search it.
          </p>
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
