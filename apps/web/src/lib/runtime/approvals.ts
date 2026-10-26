/**
 * Approval broker.
 *
 * The human decision itself is written by the API route (so it survives a
 * reload and is visible to every process). The engine waits on the database
 * rather than on in-memory state, which means a pending run keeps working after
 * a dev-server restart and a decision made in another tab still lands.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { approvals } from "@/lib/db/schema";
import type { Risk } from "@agent-os/core";

export interface ApprovalDecision {
  decision: "approved" | "denied" | "expired";
  decidedBy: string;
  note: string | null;
}

const POLL_MS = 300;

export async function waitForApprovalDecision(
  approvalId: string,
  opts: { timeoutMs?: number } = {},
): Promise<ApprovalDecision> {
  const db = await getDb();
  const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60 * 1000);

  for (;;) {
    const [row] = await db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .limit(1);

    if (!row) {
      return { decision: "expired", decidedBy: "system", note: "Approval row disappeared." };
    }
    if (row.status !== "pending") {
      return {
        decision: row.status,
        decidedBy: row.decidedBy ?? "system",
        note: row.note,
      };
    }
    if (Date.now() >= deadline) {
      await db
        .update(approvals)
        .set({
          status: "expired",
          decidedBy: "system",
          note: "No decision before the approval window closed.",
          resolvedAt: new Date(),
        })
        .where(eq(approvals.id, approvalId));
      return {
        decision: "expired",
        decidedBy: "system",
        note: "No decision before the approval window closed.",
      };
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export interface ApprovalRequestInput {
  id: string;
  workspaceId: string;
  runId: string;
  agentId: string;
  callId: string | null;
  resource: string;
  scopes: string[];
  risk: Risk;
  reason: string;
}

export async function createApprovalRequest(input: ApprovalRequestInput): Promise<void> {
  await (await getDb()).insert(approvals).values({
    id: input.id,
    workspaceId: input.workspaceId,
    runId: input.runId,
    agentId: input.agentId,
    callId: input.callId,
    resource: input.resource,
    scopes: input.scopes,
    risk: input.risk,
    reason: input.reason,
    status: "pending",
    requestedAt: new Date(),
  });
}
