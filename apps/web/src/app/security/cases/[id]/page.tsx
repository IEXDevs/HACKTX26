import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { CaseReview } from "@/components/relay/case-review";
import { getDb } from "@/lib/db/client";
import { agents, securityFindings } from "@/lib/db/schema";
import { usd } from "@/lib/format";
import { checkRetest, loadCase } from "@/lib/loop/cases";
import { requireWorkspace } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await requireWorkspace();
  const found = await loadCase(id).catch(() => null);
  if (!found || found.workspaceId !== workspace.id) notFound();
  // Judge a finished retest on view, in case the engine hook has not yet.
  const row = await checkRetest(found.id);
  const db = await getDb();
  const [[finding], [target]] = await Promise.all([
    db.select().from(securityFindings).where(eq(securityFindings.id, row.findingId)).limit(1),
    db.select().from(agents).where(eq(agents.id, row.targetAgentId)).limit(1),
  ]);
  if (!finding) notFound();

  return (
    <CaseReview
      view={{
        id: row.id,
        title: finding.title,
        targetName: target?.name ?? "Agent",
        targetId: row.targetAgentId,
        severity: row.severity,
        status: finding.status,
        state: row.state,
        escalationReason: row.escalationReason,
        round: row.round,
        maxRounds: row.maxRounds,
        spent: usd(row.spentUsd),
        cap: usd(row.budgetCapUsd),
        steps: row.reproduction.steps,
        hops: row.hops,
        conversation: row.conversation,
        proposal: row.proposal,
        retest: row.retests[row.retests.length - 1] ?? null,
      }}
    />
  );
}
