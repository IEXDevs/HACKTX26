"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { StoredItems, type KeyRow, type DocRow } from "./stored-items";
import {
  Check,
  Globe,
  LoaderCircle,
  Plug,
  Search,
  Settings,
  X,
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
  repo?: string | null;
  branch?: string | null;
}
const statusWord: Record<ConnectorView["status"], string> = {
  connected: "Connected",
  pending: "Waiting on you",
  disconnected: "Not connected",
  error: "Needs attention",
};

function KindIcon({ slug, logoUrl }: { slug: string; logoUrl: string | null }) {
  if (logoUrl) {
    return (
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
  if (!composio) return "App linking is off until a Composio API key is configured. Search still works over the popular catalog.";
  return null;
}

export function ConnectorsView({
  initial,
  query,
  composio,
  serpapi,
  linked,
  keys,
  documents,
}: {
  initial: ConnectorView[];
  query: string;
  composio: boolean;
  serpapi: boolean;
  linked?: string;
  keys: KeyRow[];
  documents: DocRow[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(initialMessage(composio, linked));
  const connected = useMemo(() => rows.filter((row) => row.connected), [rows]);
  const popular = useMemo(
    () => rows.filter((row) => row.popular && !row.connected),
    [rows],
  );
  const rest = useMemo(
    () => rows.filter((row) => !row.popular && !row.connected),
    [rows],
  );

  function pushQuery(nextApp: string) {
    const params = new URLSearchParams();
    if (nextApp) params.set("q", nextApp);
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

  function card(connector: ConnectorView) {
    return (
      <ConnectorCard
        key={connector.slug}
        connector={connector}
        composio={composio}
        busy={busy}
        onConnect={connect}
        onDisconnect={disconnect}
        onSaved={() => {
          void refresh();
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="page conn-page">
      <div className="page-top">
        <h1>Connectors</h1>
      </div>

      <form
        className="search conn-search"
        onSubmit={(event) => {
          event.preventDefault();
          const next = search.trim();
          pushQuery(next);
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
        <section className="section">
          <h2>Linked</h2>
          <div className="tile-grid spaced">
            {connected.map((connector) => card(connector))}
          </div>
        </section>
      ) : null}

      <section className="section">
        <h2>{query ? "Matches" : "Popular"}</h2>
        {popular.length || rest.length ? (
          <div className="tile-grid spaced">
            {(query ? [...popular, ...rest] : popular).map((connector) => card(connector))}
          </div>
        ) : (
          <p className="empty">Nothing matches “{query}”.</p>
        )}
      </section>

      <StoredItems keys={keys} documents={documents} />
    </div>
  );
}

function ConnectorCard({
  connector,
  composio,
  busy,
  onConnect,
  onDisconnect,
  onSaved,
}: {
  connector: ConnectorView;
  composio: boolean;
  busy: string | null;
  onConnect: (slug: string, builtin: boolean) => Promise<void>;
  onDisconnect: (slug: string) => Promise<void>;
  onSaved: () => void;
}) {
  const [panel, setPanel] = useState(false);
  const needsComposio = !connector.builtin && !composio;
  const actionLabel = connector.builtin
    ? connector.connected
      ? "Ready"
      : "Needs key"
    : connector.connected
      ? "Disconnect"
      : needsComposio
        ? "Needs key"
        : "Connect";
  function act() {
    void (connector.connected && !connector.builtin
      ? onDisconnect(connector.slug)
      : onConnect(connector.slug, connector.builtin));
  }
  return (
    <article className="tile" style={{ minHeight: 150 }}>
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
        <span className="tile-actions">
          {connector.connected ? (
            <button
              type="button"
              className="icon-btn conn-cog"
              aria-label={`${connector.name} settings`}
              onClick={() => setPanel(true)}
            >
              <Settings size={16} />
            </button>
          ) : null}
          <button
            className="btn small"
            disabled={busy === connector.slug || (connector.builtin && connector.connected) || needsComposio}
            onClick={act}
          >
            {busy === connector.slug && <LoaderCircle size={14} className="animate-spin" />}
            {actionLabel}
          </button>
        </span>
      </footer>
      {panel ? (
        <ConnectorPanel
          connector={connector}
          busy={busy === connector.slug}
          actionLabel={actionLabel}
          disabled={(connector.builtin && connector.connected) || needsComposio}
          onClose={() => setPanel(false)}
          onAct={act}
          onSaved={onSaved}
        />
      ) : null}
    </article>
  );
}

function ConnectorPanel({
  connector,
  busy,
  actionLabel,
  disabled,
  onClose,
  onAct,
  onSaved,
}: {
  connector: ConnectorView;
  busy: boolean;
  actionLabel: string;
  disabled: boolean;
  onClose: () => void;
  onAct: () => void;
  onSaved: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop conn-modal-backdrop"
      style={{ backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
      onClick={onClose}
    >
      <div
        className="dialog conn-settings"
        role="dialog"
        aria-modal="true"
        aria-label={`${connector.name} settings`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="toolbar">
          <h2>{connector.name}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className={`conn-state ${connector.status === "connected" ? "connected" : connector.status === "error" ? "degraded" : ""}`}>
          {connector.status === "connected" ? <Check size={13} strokeWidth={2.2} /> : null}
          {statusWord[connector.status]}
        </p>
        {connector.slug === "github" ? (
          <GitHubSettings
            currentRepo={connector.repo ?? ""}
            currentBranch={connector.branch ?? "main"}
            onSaved={onSaved}
          />
        ) : (
          <p className="conn-settings-copy">
            {connector.description || connector.category || connector.slug} Agents can use this connection from + on a prompt.
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={disabled || busy} onClick={onAct}>
            {busy && <LoaderCircle size={14} className="animate-spin" />}
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function GitHubSettings({
  currentRepo,
  currentBranch,
  onSaved,
}: {
  currentRepo: string;
  currentBranch: string;
  onSaved: () => void;
}) {
  const [repo, setRepo] = useState(currentRepo);
  const [branch, setBranch] = useState(currentBranch || "main");
  const [repos, setRepos] = useState<
    { fullName: string; defaultBranch: string; private: boolean }[] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setRepo(currentRepo);
    setBranch(currentBranch || "main");
  }, [currentRepo, currentBranch]);

  async function loadRepos() {
    setLoading(true);
    setNote(null);
    try {
      const response = await fetch("/api/connectors/github/repos");
      const value = (await response.json().catch(() => ({}))) as {
        repos?: { fullName: string; defaultBranch: string; private: boolean }[];
        error?: string;
      };
      if (!response.ok) {
        setNote(value.error ?? "Could not list GitHub repositories.");
        setRepos([]);
        return;
      }
      setRepos(value.repos ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRepos();
    // Load once when the GitHub settings modal opens.
     
  }, []);

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      const response = await fetch("/api/connectors/github/repo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, branch }),
      });
      const value = (await response.json().catch(() => ({}))) as {
        error?: string;
        repo?: string;
        branch?: string;
        sync?: { files: number; error?: string };
      };
      if (!response.ok) {
        setNote(value.error ?? "Could not save the repository.");
        return;
      }
      const synced = value.sync?.files ?? 0;
      setNote(
        value.sync?.error
          ? `Saved ${value.repo}. Checkout failed: ${value.sync.error}`
          : `Working repo is ${value.repo}@${value.branch}. ${synced} files ready under repo/ in Files.`,
      );
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="conn-settings-body">
      <p className="conn-settings-copy">
        Agents see this repository under <code>repo/</code> in Files. Edits there commit back to GitHub after approval.
      </p>
      {repos && repos.length > 0 ? (
        <label className="field">
          Repositories
          <select
            value={repo}
            onChange={(event) => {
              const next = event.target.value;
              setRepo(next);
              const match = repos.find((item) => item.fullName === next);
              if (match) setBranch(match.defaultBranch || "main");
            }}
          >
            <option value="">Select a repository</option>
            {repos.map((item) => (
              <option key={item.fullName} value={item.fullName}>
                {item.fullName}
                {item.private ? " (private)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : loading ? (
        <p className="conn-settings-copy">Loading repositories…</p>
      ) : repos?.length === 0 ? (
        <p className="conn-settings-copy">No repositories came back for this GitHub account.</p>
      ) : null}
      <div className="conn-settings-row">
        <label className="field">
          Repository
          <input value={repo} placeholder="owner/name" onChange={(event) => setRepo(event.target.value)} />
        </label>
        <label className="field">
          Branch
          <input value={branch} placeholder="main" onChange={(event) => setBranch(event.target.value)} />
        </label>
      </div>
      <div className="conn-settings-actions">
        <button className="btn small" type="button" disabled={loading || saving} onClick={() => void loadRepos()}>
          {loading && <LoaderCircle size={14} className="animate-spin" />}
          Load from GitHub
        </button>
        <button
          className="btn small primary"
          type="button"
          disabled={saving || loading || repo.trim().length < 3}
          onClick={() => void save()}
        >
          {saving && <LoaderCircle size={14} className="animate-spin" />}
          Use this repo
        </button>
      </div>
      {note ? <p className="conn-settings-copy">{note}</p> : null}
      {currentRepo ? (
        <p className="conn-settings-copy">
          Current: <code>{currentRepo}</code> @ <code>{currentBranch || "main"}</code>
        </p>
      ) : (
        <p className="conn-settings-copy">No working repository yet.</p>
      )}
    </div>
  );
}
