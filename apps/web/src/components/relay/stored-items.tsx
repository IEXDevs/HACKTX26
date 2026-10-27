"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, Trash2 } from "@/components/icons";

export interface KeyRow { id: string; name: string }
export interface DocRow { id: string; title: string }

function StoredTable({ label, headings, entry, children, empty, onAdd, busy, canAdd }: {
  label: string;
  headings: [string, string];
  entry: [ReactNode, ReactNode];
  children: ReactNode;
  empty: boolean;
  onAdd: () => Promise<void>;
  busy: boolean;
  canAdd: boolean;
}) {
  return <form onSubmit={(event) => { event.preventDefault(); void onAdd(); }} className="stored-table-wrap">
    <table className="stored-table" aria-label={label}>
      <colgroup><col className="stored-name-col" /><col /><col className="stored-action-col" /></colgroup>
      <thead><tr><th scope="col">{headings[0]}</th><th scope="col">{headings[1]}</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>
        <tr className="stored-entry"><td>{entry[0]}</td><td>{entry[1]}</td><td>
          <button type="submit" className="icon-btn stored-action" aria-label={`Add ${label === "Saved keys" ? "key" : "document"}`} disabled={busy || !canAdd}>
            {busy ? <LoaderCircle size={17} className="animate-spin" /> : <Plus size={19} />}
          </button>
        </td></tr>
        {children}
        {empty && <tr><td colSpan={3} className="stored-empty">No {label === "Saved keys" ? "saved keys" : "documents"} yet.</td></tr>}
      </tbody>
    </table>
  </form>;
}

function HiddenValue({ label }: { label: string }) {
  // The DOM contains a constant placeholder. Blurring the real value would expose it.
  return <span className="stored-hidden"><span aria-hidden="true">••••••••••••••••</span><span className="sr-only">{label}</span></span>;
}

async function change(url: string, method: "POST" | "DELETE", body?: object): Promise<{ id?: string }> {
  const response = await fetch(url, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : "Could not save this change.");
  return value;
}

export function StoredItems({ keys, documents }: { keys: KeyRow[]; documents: DocRow[] }) {
  const router = useRouter();
  const [savedKeys, setSavedKeys] = useState(keys);
  const [savedDocs, setSavedDocs] = useState(documents);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [keyError, setKeyError] = useState("");
  const [docError, setDocError] = useState("");
  useEffect(() => setSavedKeys(keys), [keys]);
  useEffect(() => setSavedDocs(documents), [documents]);

  async function addKey() {
    if (busy || savedKeys.length) return;
    setBusy("key"); setKeyError("");
    try {
      const result = await change("/api/credentials", "POST", { purpose: "muse", key: key.trim() });
      if (result.id) setSavedKeys([{ id: result.id, name: "Muse" }]);
      router.refresh();
    } catch (error) { setKeyError((error as Error).message); }
    finally { setKey(""); setBusy(null); }
  }
  async function addDocument() {
    if (busy) return;
    setBusy("document"); setDocError("");
    try {
      const result = await change("/api/kb", "POST", { title: name.trim(), body: body.trim() });
      if (result.id) setSavedDocs((rows) => [{ id: result.id!, title: name.trim() }, ...rows]);
      setName(""); setBody(""); router.refresh();
    } catch (error) { setDocError((error as Error).message); }
    finally { setBusy(null); }
  }
  async function remove(kind: "key" | "document", id: string) {
    if (busy) return;
    setBusy(id);
    const setError = kind === "key" ? setKeyError : setDocError;
    setError("");
    try {
      await change(`/api/${kind === "key" ? "credentials" : "kb"}/${encodeURIComponent(id)}`, "DELETE");
      if (kind === "key") setSavedKeys((rows) => rows.filter((row) => row.id !== id));
      else setSavedDocs((rows) => rows.filter((row) => row.id !== id));
      router.refresh();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(null); }
  }
  const deleteButton = (kind: "key" | "document", row: { id: string }, label: string) => <button
    type="button" className="icon-btn stored-action stored-delete" aria-label={`Delete ${label}`} disabled={busy !== null}
    onClick={() => void remove(kind, row.id)}>{busy === row.id ? <LoaderCircle size={17} className="animate-spin" /> : <Trash2 size={17} />}</button>;

  return <div className="stored-sections">
    <section className="section">
      <h2>Saved keys</h2>
      <StoredTable label="Saved keys" headings={["Key purpose / name", "Key"]} empty={!savedKeys.length} busy={busy === "key"} canAdd={!busy && !savedKeys.length && key.trim().length >= 8} onAdd={addKey}
        entry={[
          <select key="purpose" aria-label="Key purpose" defaultValue="muse" disabled={busy !== null || savedKeys.length > 0}><option value="muse">Muse{savedKeys.length ? " (saved)" : ""}</option></select>,
          <input key="value" aria-label="New Muse key" type="password" autoComplete="off" spellCheck={false} value={key} maxLength={8192} placeholder="Enter Muse key" disabled={busy !== null || savedKeys.length > 0} onChange={(event) => setKey(event.target.value)} />,
        ]}>
        {savedKeys.map((row) => <tr key={row.id}><td>{row.name}</td><td><HiddenValue label="Saved key. The value cannot be displayed." /></td><td>{deleteButton("key", row, `${row.name} key`)}</td></tr>)}
      </StoredTable>
      <p className="note">Only you can use your saved key. Delete it before adding a replacement.</p>
      {keyError && <p className="error-text" role="alert">{keyError}</p>}
    </section>
    <section className="section">
      <h2>Your documents</h2>
      <StoredTable label="Your documents" headings={["Document name", "Document"]} empty={!savedDocs.length} busy={busy === "document"} canAdd={!busy && !!name.trim() && !!body.trim()} onAdd={addDocument}
        entry={[
          <input key="name" aria-label="New document name" value={name} maxLength={120} placeholder="Document name" disabled={busy !== null} onChange={(event) => setName(event.target.value)} />,
          <textarea key="body" aria-label="New document text" value={body} rows={2} maxLength={60000} placeholder="Paste document text" disabled={busy !== null} onChange={(event) => setBody(event.target.value)} />,
        ]}>
        {savedDocs.map((row) => <tr key={row.id}><td>{row.title}</td><td><HiddenValue label="Saved document. Used only by your account's agents." /></td><td>{deleteButton("document", row, `document ${row.title}`)}</td></tr>)}
      </StoredTable>
      <p className="note">Documents are available only to agents you run from your account.</p>
      {docError && <p className="error-text" role="alert">{docError}</p>}
    </section>
  </div>;
}
