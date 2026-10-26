"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ACTION_POLICIES,
  type ApprovalMode,
  type PolicyEffect,
} from "@agent-os/core";

const verdictWord: Record<PolicyEffect, string> = {
  allow: "Allowed",
  allow_with_log: "Allowed and logged",
  require_approval: "Asks you first",
  deny: "Blocked",
};

const OPTIONS: PolicyEffect[] = ["allow", "allow_with_log", "require_approval", "deny"];

export function ActionPolicy({
  initial,
  initialApprovalMode = "request",
}: {
  initial: Record<string, PolicyEffect>;
  initialApprovalMode?: ApprovalMode;
}) {
  const router = useRouter();
  const [effects, setEffects] = useState(initial);
  const [approvalMode, setApprovalMode] = useState(initialApprovalMode);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function save(patch: { effects?: Record<string, PolicyEffect>; approvalMode?: ApprovalMode }, key: string) {
    const previous = { effects, approvalMode };
    if (patch.effects) setEffects((current) => ({ ...current, ...patch.effects }));
    if (patch.approvalMode) setApprovalMode(patch.approvalMode);
    setBusy(key);
    setError("");
    try {
      const response = await fetch("/api/policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error ?? "The change was not saved.");
      if (value.effects) setEffects(value.effects);
      if (value.approvalMode) setApprovalMode(value.approvalMode);
      router.refresh();
    } catch (cause) {
      setEffects(previous.effects);
      setApprovalMode(previous.approvalMode);
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="section">
      <h2>AI permissions</h2>
      <div className="tabs" role="group" aria-label="AI permission approval mode">
        <button type="button" aria-pressed={approvalMode === "request"} disabled={busy !== null}
          onClick={() => void save({ approvalMode: "request" }, "approval-mode")}>Request permission</button>
        <button type="button" aria-pressed={approvalMode === "motivator"} disabled={busy !== null}
          onClick={() => void save({ approvalMode: "motivator" }, "approval-mode")}>Approve for me</button>
      </div>
      <p className="note">{approvalMode === "motivator"
        ? "The motivator reviews new permission requests across the workspace. It can approve an action, reject it, or ask you to decide. Blocked actions stay blocked."
        : "Permission requests come to you for approval. Approve for me delegates each review to the motivator. This applies to new requests across the workspace."}</p>
      <h3>What agents may do</h3>
      {error ? <p className="error-text">{error}</p> : null}
      <ul className="list policy-list">
        {ACTION_POLICIES.map((row) => {
          const effect = effects[row.resource] ?? "require_approval";
          return (
            <li key={row.resource}>
              <div>
                <b id={`policy-${row.resource}`}>{row.action}</b>
              </div>
              <div className="policy-options" role="group" aria-labelledby={`policy-${row.resource}`}>
                {OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={option}
                    aria-pressed={effect === option}
                    disabled={busy !== null}
                    onClick={() => {
                      if (option !== effect) void save({ effects: { [row.resource]: option } }, row.resource);
                    }}
                  >
                    {option === "require_approval" && approvalMode === "motivator" ? "Motivator reviews" : verdictWord[option]}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
