"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Panel, PanelHeader, StatusBadge, Tag } from "@/components/ui/primitives";

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
    <Panel>
      <PanelHeader
        title="Proposed child templates"
        hint={
          pending.length > 0
            ? `${pending.length} waiting for approval. Saving adds the child to the builder gallery.`
            : "Nothing is waiting. A parent with the creation toggle files a proposal when it creates a reusable child."
        }
      />
      {proposals.length === 0 ? (
        <p className="px-4 py-8 text-[12px] leading-relaxed text-ink-3">
          No proposals yet. Turn on “Propose reusable child templates” when you create the agent,
          then dispatch a run that delegates.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {proposals.map((proposal) => (
            <li key={proposal.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-ink">{proposal.name}</span>
                <Tag>{proposal.role}</Tag>
                <Tag tone="muted">{proposal.complexity}</Tag>
                <StatusBadge status={proposal.status === "saved" ? "active" : proposal.status === "pending" ? "pending" : "archived"} label={proposal.status} />
              </div>
              <p className="text-[12px] leading-relaxed text-ink-2">{proposal.summary}</p>
              <p className="text-[11px] leading-relaxed text-ink-3">{proposal.reason}</p>
              <p className="mono text-[10px] text-ink-4">
                {proposal.tools.length > 0 ? proposal.tools.join(" · ") : "no tools"}
              </p>
              <pre className="mono max-h-36 overflow-auto whitespace-pre-wrap rounded-xs border border-line bg-void/40 px-2 py-1.5 text-[10px] leading-relaxed text-ink-3">
                {proposal.instructions}
              </pre>
              {proposal.status === "pending" ? (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="primary" disabled={busy === proposal.id} onClick={() => act(proposal.id, "save")}>
                    {busy === proposal.id ? <Loader2 size={12} className="animate-spin" /> : null}
                    Save template
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === proposal.id} onClick={() => act(proposal.id, "dismiss")}>
                    Dismiss
                  </Button>
                </div>
              ) : proposal.templateId ? (
                <Link href="/build" className="focus-ring text-[11px] text-accent">
                  Saved to the builder gallery
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p className="border-t border-line px-4 py-2 text-[11px] text-danger">{error}</p>
      ) : null}
    </Panel>
  );
}
