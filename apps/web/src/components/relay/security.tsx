"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown } from "@/components/icons";
import { AdvancedSwitch, useAdvanced } from "./advanced";
import { StartRun, type RunnableAgent } from "./start-run";

export interface SecurityApproval {
  id: string;
  runId: string;
  ask: string;
  agent: string;
  reason: string;
  risk: string;
}
export interface SecurityIssue {
  id: string;
  title: string;
  detail: string;
  remediation: string | null;
  evidence: string | null;
  severity: string;
  category: string;
  status: string;
  agent: string;
  runId: string | null;
  when: string;
}

const severityWord: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};
const statusWord: Record<string, string> = {
  fixed: "Fixed",
  accepted: "Risk accepted",
  false_positive: "Not an issue",
};

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(value.error ?? "The change was not saved.");
  }
}

export function SecurityView({
  approvals,
  issues,
  probes,
  checkers,
}: {
  approvals: SecurityApproval[];
  issues: SecurityIssue[];
  probes: number;
  checkers: RunnableAgent[];
}) {
  const router = useRouter();
  const [advanced, toggleAdvanced] = useAdvanced(),
    [open, setOpen] = useState<string | null>(null),
    [showResolved, setShowResolved] = useState(false),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  const live = issues.filter((i) => i.status === "open");
  const resolved = issues.filter((i) => i.status !== "open");
  const serious = live.filter((i) => i.severity === "critical" || i.severity === "high").length;

  async function act(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const triage = (issue: SecurityIssue, status: string) =>
    act(issue.id, () => send(`/api/findings/${issue.id}`, "PATCH", { status }));

  const byCategory = [...new Set(issues.map((i) => i.category))].map((category) => ({
    category,
    open: live.filter((i) => i.category === category).length,
    total: issues.filter((i) => i.category === category).length,
  }));

  return (
    <div className="page">
      <div className="page-top">
        <h1>Security</h1>
        <div className="page-actions">
          <AdvancedSwitch on={advanced} toggle={toggleAdvanced} />
          {checkers.length > 0 && (
            <StartRun agents={checkers} label="Run a security check" />
          )}
        </div>
      </div>

      <dl className="stats">
        <div>
          <dt>Open issues</dt>
          <dd>{live.length}</dd>
        </div>
        <div>
          <dt>High or critical</dt>
          <dd className={serious ? "stopped" : ""}>{serious}</dd>
        </div>
        <div>
          <dt>Waiting on you</dt>
          <dd>{approvals.length}</dd>
        </div>
        {advanced && (
          <div>
            <dt>Checks run</dt>
            <dd>{probes}</dd>
          </div>
        )}
      </dl>

      {error && <p className="error-text" style={{ marginTop: 16 }}>{error}</p>}

      {approvals.length > 0 && (
        <section className="section">
          <h2>Needs a decision</h2>
          <ul className="list">
            {approvals.map((a) => (
              <li key={a.id}>
                <div>
                  <b>{a.ask}</b>
                  <small>
                    {a.agent} · {a.reason}
                  </small>
                </div>
                <button
                  className="btn small primary"
                  disabled={busy === a.id}
                  onClick={() =>
                    act(a.id, () => send(`/api/approvals/${a.id}`, "POST", { decision: "approved" }))
                  }
                >
                  Approve
                </button>
                <button
                  className="btn small"
                  disabled={busy === a.id}
                  onClick={() =>
                    act(a.id, () => send(`/api/approvals/${a.id}`, "POST", { decision: "denied" }))
                  }
                >
                  Deny
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <h2>Open issues</h2>
        {live.length ? (
          <ul className="list">
            {live.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                open={open === issue.id}
                onToggle={() => setOpen(open === issue.id ? null : issue.id)}
                busy={busy === issue.id}
                advanced={advanced}
                actions={
                  <>
                    <button className="btn small primary" onClick={() => triage(issue, "fixed")}>
                      Mark fixed
                    </button>
                    <button className="btn small" onClick={() => triage(issue, "accepted")}>
                      Accept the risk
                    </button>
                    <button className="btn small" onClick={() => triage(issue, "false_positive")}>
                      Not an issue
                    </button>
                  </>
                }
              />
            ))}
          </ul>
        ) : (
          <p className="empty">No open issues.</p>
        )}
      </section>

      {resolved.length > 0 && (
        <section className="section">
          <button className="link-btn" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? "Hide" : "Show"} {resolved.length} resolved
          </button>
          {showResolved && (
            <ul className="list" style={{ marginTop: 12 }}>
              {resolved.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  open={open === issue.id}
                  onToggle={() => setOpen(open === issue.id ? null : issue.id)}
                  busy={busy === issue.id}
                  advanced={advanced}
                  actions={
                    <button className="btn small" onClick={() => triage(issue, "open")}>
                      Reopen
                    </button>
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {advanced && byCategory.length > 0 && (
        <section className="section">
          <h2>By type</h2>
          <div className="table">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Open</th>
                  <th>All time</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.map((row) => (
                  <tr key={row.category}>
                    <td>{row.category.replaceAll("_", " ")}</td>
                    <td>{row.open}</td>
                    <td>{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function IssueRow({
  issue,
  open,
  onToggle,
  busy,
  advanced,
  actions,
}: {
  issue: SecurityIssue;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  advanced: boolean;
  actions: React.ReactNode;
}) {
  const tone =
    issue.severity === "critical" || issue.severity === "high"
      ? "sev high"
      : issue.severity === "medium"
        ? "sev medium"
        : "sev";
  return (
    <li className="expand-row">
      <button className="expand-head" aria-expanded={open} onClick={onToggle}>
        <span className={tone}>{severityWord[issue.severity] ?? issue.severity}</span>
        <span className="expand-title">
          <b>{issue.title}</b>
          <small>
            {statusWord[issue.status] ? `${statusWord[issue.status]} · ` : ""}
            {issue.agent} · {issue.when}
          </small>
        </span>
        <ChevronDown size={16} className="expand-chevron" />
      </button>
      {open && (
        <div className="expand-body">
          <p>{issue.detail}</p>
          {issue.remediation && (
            <p>
              <strong>How to fix: </strong>
              {issue.remediation}
            </p>
          )}
          {advanced && issue.evidence && <pre className="evidence">{issue.evidence}</pre>}
          <div className="expand-actions" aria-busy={busy}>
            {actions}
            {issue.runId && (
              <Link href={`/runs/${issue.runId}`} className="btn small">
                See the run
              </Link>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
