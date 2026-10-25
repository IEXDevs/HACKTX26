"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Loader2, ShieldX, X } from "lucide-react";
import { EmptyState, RiskTag, StatusBadge, buttonClass } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";

export interface FindingView {
  id: string;
  title: string;
  detail: string;
  evidence: string | null;
  remediation: string | null;
  severity: "low" | "medium" | "high" | "critical" | "info";
  category: string;
  status: "open" | "accepted" | "fixed" | "false_positive";
  runId: string;
  agentId: string;
  targetAgentId: string | null;
  createdAt: string;
}

const SEVERITIES = ["all", "critical", "high", "medium", "low", "info"] as const;
const STATUSES = ["open", "accepted", "fixed", "false_positive", "all"] as const;

const NEXT_ACTIONS: Record<
  FindingView["status"],
  Array<{ status: FindingView["status"]; label: string; icon: typeof Check }>
> = {
  open: [
    { status: "accepted", label: "Accept risk", icon: Check },
    { status: "fixed", label: "Mark fixed", icon: Check },
    { status: "false_positive", label: "False positive", icon: X },
  ],
  accepted: [
    { status: "fixed", label: "Mark fixed", icon: Check },
    { status: "open", label: "Reopen", icon: ShieldX },
  ],
  fixed: [{ status: "open", label: "Reopen", icon: ShieldX }],
  false_positive: [{ status: "open", label: "Reopen", icon: ShieldX }],
};

export function FindingsBoard({
  findings,
  agentNames,
}: {
  findings: FindingView[];
  agentNames: Record<string, string>;
}) {
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("all");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("open");
  const [rows, setRows] = useState(findings);
  const [expanded, setExpanded] = useState<string | null>(findings[0]?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Server data is the source of truth after router.refresh().
  useEffect(() => {
    setRows(findings);
  }, [findings]);

  const visible = rows.filter((finding) => {
    if (severity !== "all" && finding.severity !== severity) return false;
    if (status !== "all" && finding.status !== status) return false;
    return true;
  });

  async function triage(finding: FindingView, next: FindingView["status"]) {
    setBusy(finding.id);
    setError(null);
    try {
      const response = await fetch(`/api/findings/${finding.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? `Triage failed (HTTP ${response.status}).`);
        return;
      }
      setRows((current) =>
        current.map((row) => (row.id === finding.id ? { ...row, status: next } : row)),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="micro mr-1">severity</span>
          {SEVERITIES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSeverity(value)}
              className={cn(
                "focus-ring rounded-xs px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.06em] transition-colors",
                severity === value
                  ? "bg-surface-3 text-ink"
                  : "text-ink-4 hover:bg-surface-2 hover:text-ink-2",
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="micro mr-1">state</span>
          {STATUSES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={cn(
                "focus-ring rounded-xs px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.06em] transition-colors",
                status === value
                  ? "bg-surface-3 text-ink"
                  : "text-ink-4 hover:bg-surface-2 hover:text-ink-2",
              )}
            >
              {value.replaceAll("_", " ")}
            </button>
          ))}
        </div>
        <span className="mono ml-auto text-[10px] text-ink-4">
          {visible.length} of {rows.length}
        </span>
      </div>

      {error ? (
        <p
          role="alert"
          className="mx-3 mt-3 rounded-xs border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger"
        >
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          icon={<ShieldX size={20} />}
          title="Nothing in this bucket"
          description="Change the filters, or dispatch the red team to probe another target."
        />
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((finding) => {
            const open = expanded === finding.id;
            return (
              <li key={finding.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : finding.id)}
                  aria-expanded={open}
                  className="focus-ring flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/50"
                >
                  <ChevronDown
                    size={13}
                    className={cn(
                      "mt-0.5 shrink-0 text-ink-4 transition-transform",
                      open && "rotate-180",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <RiskTag risk={finding.severity} />
                      <span className="mono text-[9.5px] uppercase tracking-[0.08em] text-ink-4">
                        {finding.category.replaceAll("_", " ")}
                      </span>
                      <StatusBadge status={finding.status} />
                      <span className="mono text-[9.5px] text-ink-4">
                        {relativeTime(finding.createdAt)}
                      </span>
                    </span>
                    <span className="mt-1 block text-[12px] leading-snug text-ink">
                      {finding.title}
                    </span>
                    <span className="mono mt-0.5 block text-[9.5px] text-ink-4">
                      {agentNames[finding.agentId] ?? finding.agentId}
                      <span className="px-1 text-line-strong">→</span>
                      {finding.targetAgentId
                        ? (agentNames[finding.targetAgentId] ?? finding.targetAgentId)
                        : "workspace"}
                      <span className="px-1 text-line-strong">·</span>
                      {finding.id}
                    </span>
                  </span>
                </button>

                {open ? (
                  <div className="animate-fade-up space-y-3 px-4 pb-4 pl-10">
                    <p className="max-w-3xl text-[11.5px] leading-relaxed text-ink-2">
                      {finding.detail}
                    </p>
                    {finding.evidence ? (
                      <div>
                        <div className="micro mb-1">Reproduction evidence</div>
                        <pre className="mono whitespace-pre-wrap rounded-xs border border-line bg-void p-2.5 text-[10.5px] leading-relaxed text-ink-3">
                          {finding.evidence}
                        </pre>
                      </div>
                    ) : null}
                    {finding.remediation ? (
                      <div>
                        <div className="micro mb-1">Remediation</div>
                        <p className="text-[11px] leading-relaxed text-ink-2">
                          {finding.remediation}
                        </p>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {NEXT_ACTIONS[finding.status].map((action) => {
                        const Icon = action.icon;
                        return (
                          <button
                            key={action.status}
                            type="button"
                            disabled={busy === finding.id}
                            onClick={() => triage(finding, action.status)}
                            className={buttonClass(
                              action.status === "open" ? "outline" : "secondary",
                              "sm",
                            )}
                          >
                            {busy === finding.id ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Icon size={11} />
                            )}
                            {action.label}
                          </button>
                        );
                      })}
                      <Link
                        href={`/runs/${finding.runId}`}
                        className="focus-ring mono ml-auto flex items-center gap-1 text-[9.5px] text-accent hover:text-accent/80"
                      >
                        open trace <ArrowUpRight size={9} />
                      </Link>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-line px-4 py-2.5">
        <p className="text-[10px] leading-relaxed text-ink-4">
          Triage writes an <span className="mono">audit_log</span> row and leaves the
          originating run trace untouched.
        </p>
      </div>
    </div>
  );
}
