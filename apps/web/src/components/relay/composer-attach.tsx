"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Plug, Plus, X } from "@/components/icons";
import { attachmentKey, attachmentLabel, type ComposerAttachment } from "@/lib/composer-attachments";

type Repo = { fullName: string; defaultBranch: string; private: boolean };
type ConnectedApp = { slug: string; name: string };

export function ComposerAttach({
  attachments,
  onChange,
}: {
  attachments: ComposerAttachment[];
  onChange: (next: ComposerAttachment[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function openMenu() {
    setOpen((value) => !value);
    if (apps || busy) return;
    setBusy(true);
    setError(null);
    try {
      const catalog = await fetch("/api/connectors");
      const listed = (await catalog.json().catch(() => ({}))) as {
        connectors?: { slug: string; name?: string; connected?: boolean }[];
      };
      const connected = (listed.connectors ?? [])
        .filter((row) => row.connected)
        .map((row) => ({ slug: row.slug, name: row.name || row.slug }));
      setApps(connected);
      if (!connected.some((row) => row.slug === "github")) return;
      const response = await fetch("/api/connectors/github/repos");
      const value = (await response.json().catch(() => ({}))) as { repos?: Repo[]; error?: string };
      if (!response.ok) {
        setError(value.error ?? "Could not list GitHub repositories.");
        setRepos([]);
        return;
      }
      setRepos(value.repos ?? []);
    } catch {
      setError("Could not load connected apps.");
    } finally {
      setBusy(false);
    }
  }

  function toggleApp(app: ConnectedApp) {
    const exists = attachments.some((item) => item.kind === "app" && item.slug === app.slug);
    onChange(
      exists
        ? attachments.filter((item) => !(item.kind === "app" && item.slug === app.slug))
        : [...attachments, { kind: "app", slug: app.slug, name: app.name }],
    );
    setOpen(false);
  }

  async function pickRepo(repo: Repo) {
    const next: ComposerAttachment = { kind: "github", repo: repo.fullName, branch: repo.defaultBranch || "main" };
    onChange([...attachments.filter((item) => item.kind !== "github"), next]);
    setOpen(false);
    await fetch("/api/connectors/github/repo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: next.repo, branch: next.branch }),
    }).catch(() => undefined);
  }

  return (
    <div className="composer-attach" ref={root}>
      <button
        type="button"
        className="composer-plus"
        aria-label="Add from connected apps"
        aria-expanded={open}
        onClick={() => void openMenu()}
      >
        <Plus size={16} />
      </button>
      {open ? (
        <div className="composer-attach-menu" role="menu">
          {busy ? (
            <p className="composer-attach-note">
              <LoaderCircle size={14} className="animate-spin" /> Loading connections…
            </p>
          ) : error ? (
            <p className="composer-attach-note">{error}</p>
          ) : !apps?.length ? (
            <p className="composer-attach-note">Connect an app on Connectors, then attach it here.</p>
          ) : (
            <>
              {(apps ?? [])
                .filter((app) => app.slug !== "github")
                .map((app) => (
                  <button
                    key={app.slug}
                    type="button"
                    role="menuitem"
                    className={
                      "composer-attach-app" +
                      (attachments.some((item) => item.kind === "app" && item.slug === app.slug) ? " on" : "")
                    }
                    onClick={() => toggleApp(app)}
                  >
                    <Plug size={13} /> {app.name}
                  </button>
                ))}
              {apps.some((app) => app.slug === "github") ? (
                <>
                  <p className="composer-attach-label">
                    <Plug size={13} /> GitHub
                  </p>
                  {repos && repos.length === 0 ? (
                    <p className="composer-attach-note">No repositories on this GitHub account.</p>
                  ) : (
                    <div className="composer-attach-list">
                      {(repos ?? []).map((repo) => (
                        <button
                          key={repo.fullName}
                          type="button"
                          role="menuitem"
                          className={attachments.some((item) => item.kind === "github" && item.repo === repo.fullName) ? "on" : undefined}
                          onClick={() => void pickRepo(repo)}
                        >
                          {repo.fullName}
                          {repo.private ? " · private" : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ComposerChips({
  attachments,
  onRemove,
}: {
  attachments: ComposerAttachment[];
  onRemove: (item: ComposerAttachment) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="composer-chips">
      {attachments.map((item) => (
        <span key={attachmentKey(item)} className="composer-chip">
          {attachmentLabel(item)}
          <button type="button" aria-label={`Remove ${attachmentLabel(item)}`} onClick={() => onRemove(item)}>
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}
