"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTabDraft } from "@/lib/use-tab-draft";

export interface InputRequestData {
  id: string; runId: string; workflow: string; ask: string; preview: string; waiting: string;
}

export function InputRequest({ request }: { request: InputRequestData }) {
  const router = useRouter();
  const [answer, setAnswer, clearAnswer] = useTabDraft(`astronom.input-request.${request.id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!answer.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/inputs/${request.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: answer.trim() }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "The answer could not be sent.");
      clearAnswer();
      router.refresh();
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  }
  return (
    <article className="need-card input-request">
      <header><span>{request.workflow}</span><span>Waiting {request.waiting}</span></header>
      <h3>{request.ask}</h3>
      <p>{request.preview}</p>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="field" htmlFor={`answer-${request.id}`}>Your answer</label>
        <textarea id={`answer-${request.id}`} aria-label={`Answer: ${request.ask}`} value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={6000} rows={3} disabled={busy} required />
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="need-card-actions">
          <button type="submit" className="approve" disabled={busy || !answer.trim()}>{busy ? "Resuming…" : "Send and resume"}</button>
          <Link href={`/runs/${request.runId}`}>Details</Link>
        </div>
      </form>
    </article>
  );
}
