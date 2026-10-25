"use client";

import { useEffect, useState } from "react";
import { BookOpen, LoaderCircle, Pencil, Save } from "@/components/icons";
import { RichText } from "./rich-text";

export function WorkspaceContextPanel({
  initial,
}: {
  initial: { content: string; stub: boolean };
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(initial.content);
  const [stub, setStub] = useState(initial.stub);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setContent(initial.content);
    setStub(initial.stub);
  }, [initial.content, initial.stub]);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Could not save CONTEXT.md.");
      setContent(value.content);
      setStub(Boolean(value.stub));
      setSaved(true);
      setEditing(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="wf-context" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <BookOpen size={15} aria-hidden />
        CONTEXT.md
        <small>{stub ? "Empty — click to write" : "Click to edit"}</small>
      </summary>
      {editing ? (
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setSaved(false);
          }}
          spellCheck={false}
          rows={14}
          aria-label="Edit CONTEXT.md"
          autoFocus
        />
      ) : (
        <button
          type="button"
          className="wf-context-preview"
          onClick={() => setEditing(true)}
          aria-label="Edit CONTEXT.md"
        >
          <RichText text={content || "_Nothing in CONTEXT.md yet. Click to write it._"} />
        </button>
      )}
      <div className="wf-context-actions">
        <div className="btn-group">
          {editing ? (
            <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
              {busy ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Save size={14} aria-hidden />}
              Save
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Pencil size={14} aria-hidden />
              Edit file
            </button>
          )}
          {editing ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setContent(initial.content);
                setEditing(false);
                setError("");
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
        {saved ? <span className="wf-context-ok">Saved</span> : null}
        {error ? <span className="error-text">{error}</span> : null}
      </div>
    </details>
  );
}
