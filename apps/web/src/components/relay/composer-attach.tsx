"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Plug, Plus, X } from "@/components/icons";
import type { ComposerAttachment } from "@/lib/composer-attachments";

type Repo = { fullName: string; defaultBranch: string; private: boolean };

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
  const [github, setGithub] = useState(false);
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
    if (repos || busy) return;
    setBusy(true);
    setError(null);
    try {
      const catalog = await fetch("/api/connectors");
      const listed = (await catalog.json().catch(() => ({}))) as {
        connectors?: { slug: string; connected?: boolean }[];
      };
      const connected = Boolean(listed.connectors?.some((row) => row.slug === "github" && row.connected));
      setGithub(connected);
      if (!connected) return;
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
          ) : !github ? (
            <p className="composer-attach-note">Connect GitHub on Connectors, then pick a repo here.</p>
          ) : repos && repos.length === 0 ? (
            <p className="composer-attach-note">No repositories on this GitHub account.</p>
          ) : (
            <>
              <p className="composer-attach-label">
                <Plug size={13} /> GitHub
              </p>
              <div className="composer-attach-list">
                {(repos ?? []).map((repo) => (
                  <button
                    key={repo.fullName}
                    type="button"
                    role="menuitem"
                    className={attachments.some((item) => item.repo === repo.fullName) ? "on" : undefined}
                    onClick={() => void pickRepo(repo)}
                  >
                    {repo.fullName}
                    {repo.private ? " · private" : ""}
                  </button>
                ))}
              </div>
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
        <span key={`${item.kind}:${item.repo}`} className="composer-chip">
          {item.repo}
          <button type="button" aria-label={`Remove ${item.repo}`} onClick={() => onRemove(item)}>
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}
