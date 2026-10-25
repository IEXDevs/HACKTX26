"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Loader2, ShieldAlert, X } from "lucide-react";
import { EmptyState, RiskTag, buttonClass } from "@/components/ui/primitives";
import { relativeTime } from "@/lib/format";

export interface ApprovalView {
  id: string;
  runId: string;
  agentId: string;
  resource: string;
  scopes: string[];
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
  requestedAt: string;
}

/**
 * The decision here is written to the database and polled by the waiting run
 * engine, so approving from this page actually unblocks the run mid-execution.
 */
export function ApprovalInbox({
  approvals,
  agentNames,
}: {
  approvals: ApprovalView[];
  agentNames: Record<string, string>;
}) {
  const [rows, setRows] = useState(approvals);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Server data (e.g. after router.refresh()) is the source of truth; local
  // row removal only papers over the gap until the next render lands.
  useEffect(() => {
    setRows(approvals);
  }, [approvals]);

  async function decide(id: string, decision: "approved" | "denied") {
    setBusy(id);
    setConfirming(null);
    setError(null);
    try {
      const response = await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note: notes[id]?.trim() || undefined }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? `Decision failed (HTTP ${response.status}).`);
        return;
      }
      setRows((current) => current.filter((row) => row.id !== id));
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ShieldAlert size={20} />}
        title="Queue is clear"
        description="No agent is waiting on a human. New requests land here the instant a run blocks."
      />
    );
  }

  return (
    <div>
      {error ? (
        <p
          role="alert"
          className="mx-3 mt-3 rounded-xs border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger"
        >
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-line">
        {rows.map((approval) => (
          <li key={approval.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <RiskTag risk={approval.risk} />
                  <span className="mono text-[11px] text-ink">{approval.resource}</span>
                  <span className="mono text-[9px] text-ink-4">
                    {relativeTime(approval.requestedAt)}
                  </span>
                </div>
                <p className="mono mt-1 text-[9.5px] text-ink-4">
                  {agentNames[approval.agentId] ?? approval.agentId}
                  <span className="px-1 text-line-strong">·</span>
                  scopes {approval.scopes.join(", ")}
                  <span className="px-1 text-line-strong">·</span>
                  {approval.id}
                </p>
              </div>
              <Link
                href={`/runs/${approval.runId}`}
                className="focus-ring mono flex shrink-0 items-center gap-1 text-[9.5px] text-accent hover:text-accent/80"
              >
                trace <ArrowUpRight size={9} />
              </Link>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-2">{approval.reason}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <input
                value={notes[approval.id] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({ ...current, [approval.id]: event.target.value }))
                }
                placeholder="Decision note (recorded in the audit log)"
                className="focus-ring h-7 min-w-0 flex-1 rounded-xs border border-line-strong bg-surface-2 px-2 text-[11px] text-ink placeholder:text-ink-4"
              />
              {approval.risk === "critical" && confirming !== approval.id ? (
                <button
                  type="button"
                  disabled={busy === approval.id}
                  onClick={() => setConfirming(approval.id)}
                  className={buttonClass("danger", "sm")}
                >
                  <ShieldAlert size={11} />
                  Approve…
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy === approval.id}
                  onClick={() => decide(approval.id, "approved")}
                  className={buttonClass(approval.risk === "critical" ? "danger" : "primary", "sm")}
                >
                  {busy === approval.id ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Check size={11} />
                  )}
                  {approval.risk === "critical" ? "Confirm grant" : "Approve"}
                </button>
              )}
              <button
                type="button"
                disabled={busy === approval.id}
                onClick={() => decide(approval.id, "denied")}
                className={buttonClass("danger", "sm")}
              >
                <X size={11} />
                Deny
              </button>
              {confirming === approval.id ? (
                <button
                  type="button"
                  disabled={busy === approval.id}
                  onClick={() => setConfirming(null)}
                  className={buttonClass("ghost", "sm")}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-4 py-2.5">
        <p className="text-[10px] leading-relaxed text-ink-4">
          A critical capability can never be pre-authorised by a grant. Denying is a
          first-class outcome: the run records the refusal and continues with what it has.
        </p>
      </div>
    </div>
  );
}
