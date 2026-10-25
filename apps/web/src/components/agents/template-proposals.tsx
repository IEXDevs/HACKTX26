"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ProposalView {
  id: string;
  name: string;
  summary: string;
  instructions: string;
  tools: string[];
  role: string;
  complexity: string;
  reason: string;
  status: "pending" | "saved" | "dismissed";
  templateId: string | null;
  createdAt: string;
}

export function TemplateProposals({ proposals }: { proposals: ProposalView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = proposals.filter((proposal) => proposal.status === "pending");

  async function act(id: string, action: "save" | "dismiss") {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/template-proposals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? `Could not ${action} the proposal.`);
        return;
      }
      router.refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="section">
      <h2>Proposed child templates</h2>
      {pending.length > 0 ? (
        <p className="empty" style={{ marginBottom: 12 }}>
          {pending.length} waiting for approval.
        </p>
      ) : null}
      {proposals.length === 0 ? (
        <p className="empty">No proposals yet.</p>
      ) : (
        <ul className="list">
          {proposals.map((proposal) => (
            <li key={proposal.id}>
              <div>
                <b>
                  {proposal.name}
                  <i className="tag">{proposal.status}</i>
                  <i className="tag">{proposal.role}</i>
                </b>
                <small>{proposal.summary}</small>
                <small className="detail">{proposal.reason}</small>
                <small className="detail">
                  {proposal.tools.length > 0 ? proposal.tools.join(" · ") : "no tools"}
                </small>
                <pre className="detail" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                  {proposal.instructions}
                </pre>
                {proposal.status === "pending" ? (
                  <div className="agent-actions" style={{ marginTop: 10 }}>
                    <button
                      className="btn small primary"
                      disabled={busy === proposal.id}
                      onClick={() => void act(proposal.id, "save")}
                    >
                      Save template
                    </button>
                    <button
                      className="btn small"
                      disabled={busy === proposal.id}
                      onClick={() => void act(proposal.id, "dismiss")}
                    >
                      Dismiss
                    </button>
                  </div>
                ) : proposal.templateId ? (
                  <Link href="/" className="btn small" style={{ marginTop: 10 }}>
                    Saved to the builder gallery
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
