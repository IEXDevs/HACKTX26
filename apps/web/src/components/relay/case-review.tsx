"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUp, Check, LoaderCircle } from "@/components/icons";
import type { CaseHop, CaseMessage, CaseProposal, CaseRetest } from "@/lib/db/schema";
import { RichText } from "./rich-text";
import { useAutoRefresh } from "./use-auto-refresh";

export interface CaseView {
  id: string;
  title: string;
  targetName: string;
  targetId: string;
  severity: string;
  status: string;
  state: "open" | "queued" | "escalated" | "verified" | "closed";
  escalationReason: string | null;
  round: number;
  maxRounds: number;
  spent: string;
  cap: string;
  steps: string[];
  hops: CaseHop[];
  conversation: CaseMessage[];
  proposal: CaseProposal | null;
  retest: CaseRetest | null;
}

const statusWord: Record<string, string> = {
  accepted: "Waiting for a proposed fix",
  proposed_fix: "Waiting for your approval",
  approved: "Approved",
  applied: "Applied, retest next",
  retesting: "Retesting",
  retest_passed: "Retest passed",
  retest_failed: "Retest failed",
  fixed: "Fixed",
  false_positive: "Not an issue",
  duplicate: "Merged into another case",
};

/**
 * One feedback-loop case: the creator conversation, the proposed change as a
 * diff, the approval, and the retest. Approval covers the shown change only.
 */
export function CaseReview({ view }: { view: CaseView }) {
  const router = useRouter();
  const [input, setInput] = useState(""),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  const open = view.state === "open";
  const waitingRetest = view.retest?.verdict === "pending";
  const canPropose = open && (view.status === "accepted" || view.status === "retest_failed");
  const canApprove = open && view.status === "proposed_fix" && !!view.proposal;

  useAutoRefresh(waitingRetest, 4000);

  async function act(name: string, body: Record<string, unknown>) {
    setBusy(name);
    setError("");
    try {
      const response = await fetch(`/api/cases/${view.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error ?? "That did not work.");
      if (name === "message") setInput("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page">
      <div className="composer-bar">
        <Link href="/security" className="glass-pill">
          <ArrowLeft size={16} aria-hidden />
          Security
        </Link>
      </div>

      <div className="page-top" style={{ marginTop: 24, marginBottom: 8 }}>
        <div>
          <h1>{view.title}</h1>
          <p className="wf-meta">
            <Link href={`/workflows/${view.targetId}`}>{view.targetName}</Link> ·{" "}
            {statusWord[view.status] ?? view.status}
            {view.round > 0 && ` · Round ${view.round} of ${view.maxRounds}`}
          </p>
        </div>
      </div>

      {view.state === "escalated" && (
        <div className="callout">
          <div>
            <b>This fix needs you.</b>
            <p style={{ margin: "4px 0 0" }}>{view.escalationReason}</p>
          </div>
        </div>
      )}
      {view.state === "queued" && (
        <div className="callout">
          <div>
            <b>Waiting its turn.</b>
            <p style={{ margin: "4px 0 0" }}>Another fix for {view.targetName} is in progress. This one starts when that one is done.</p>
          </div>
        </div>
      )}
      {view.status === "fixed" && (
        <div className="callout">
          <div>
            <b>Fixed.</b>
            <p style={{ margin: "4px 0 0" }}>The original problem stayed fixed three times in a row against the new version.</p>
          </div>
        </div>
      )}

      <div className={view.proposal && canApprove ? "page-split" : "section"}>
      <section>
        <h2>Conversation</h2>
        <div className="chat case-chat" aria-live="polite">
          {view.conversation.map((m, i) =>
            m.from === "person" ? (
              <div key={i} className="chat-you">
                <p>{m.text}</p>
              </div>
            ) : m.from === "creator" || m.from === "blue_team" ? (
              <div key={i} className="chat-builder">
                <span className="chat-avatar" aria-hidden />
                <div>
                  {m.from === "blue_team" && <small className="case-source">Blue team</small>}
                  <RichText text={m.text} />
                </div>
              </div>
            ) : (
              <p key={i} className="case-note">
                {m.text}
              </p>
            ),
          )}
        </div>
      </section>

      {view.proposal && canApprove ? (
        <section>
          <h2>Proposed change</h2>
          <div className="card">
            <b>{view.proposal.summary}</b>
            <p className="case-source">
              {view.proposal.draftedBy && view.proposal.draftedBy !== "agent-creator"
                ? "Drafted by the blue team"
                : view.proposal.source === "live"
                  ? "Proposed by the agent creator"
                  : "Suggested by the built-in rules"}{" "}
              ·
              Changes {view.targetName} only
            </p>
            <pre className="case-diff">
              {view.proposal.diff.split("\n").map((line, i) => (
                <span key={i} className={line.startsWith("+ ") ? "add" : line.startsWith("- ") ? "del" : ""}>
                  {line}
                  {"\n"}
                </span>
              ))}
            </pre>
            <div className="dialog-actions" style={{ marginTop: 14 }}>
              <button
                className="btn primary"
                disabled={!!busy}
                onClick={() => void act("approve", { action: "approve", proposalHash: view.proposal!.hash })}
              >
                {busy === "approve" ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
                Approve and apply
              </button>
            </div>
          </div>
        </section>
      ) : null}
      </div>

      {view.retest && (
        <section className="section">
          <h2>
            Retest · {view.retest.verdict === "pending" ? "running" : view.retest.verdict}
            {view.retest.fixture && " · scripted, not a live model"}
          </h2>
          <ul className="list">
            {view.retest.runs.map((r) => {
              const failure = view.retest!.failures.find((f) => f.runId === r.runId);
              return (
                <li key={r.runId}>
                  <div>
                    <b>{r.kind === "reproduction" ? "The original problem" : r.kind === "regression" ? "An earlier problem" : "A new test input"}</b>
                    <small>{failure ? failure.reason : view.retest!.verdict === "pending" ? "Running" : "Held"}</small>
                  </div>
                  <Link href={`/runs/${r.runId}`} className="btn small">
                    See the run
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}

      {open && (
        <div className="case-dock">
          {canPropose && (
            <button className="btn" disabled={!!busy} onClick={() => void act("propose", { action: "propose" })}>
              {busy === "propose" && <LoaderCircle size={15} className="animate-spin" aria-hidden />}
              Ask for a fix
            </button>
          )}
          <Reply
            value={input}
            onChange={setInput}
            busy={busy === "message"}
            disabled={!!busy || !input.trim()}
            onSubmit={() => void act("message", { action: "message", text: input.trim() })}
          />
        </div>
      )}
    </div>
  );
}

function Reply({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);
  return (
    <form
      className="composer-box"
      style={{ flex: 1 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSubmit();
      }}
    >
      <label className="composer-field">
        <span className="sr-only">Reply to the agent creator</span>
        <textarea
          ref={box}
          rows={1}
          placeholder="Tell the creator what to change…"
          maxLength={4000}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !disabled) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      </label>
      <button type="submit" className="composer-send" disabled={disabled}>
        {busy ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowUp size={16} />}
        Send
      </button>
    </form>
  );
}
