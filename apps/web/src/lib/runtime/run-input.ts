import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { auditLog, inputRequests, runCheckpoints, runs } from "../db/schema";
import { newId } from "../env";
import { redactSecrets } from "../secrets";
import type { ModelMessage, ModelToolCall } from "./types";

export interface AgentContinuation {
  agentId: string; taskId: string | null; nextStep: number;
  messages: ModelMessage[]; calls: ModelToolCall[]; nextCall: number;
  lastText: string; emptyTurns: number; reportRetry: boolean;
}
export interface RunContinuation {
  motivator?: import("./motivator").MotivatorState;
  rootResult?: { status: "succeeded" | "failed" | "halted"; summary: string };
  frames: Array<[string, AgentContinuation]>;
  delegations: Array<[string, string]>;
  spawned: string[]; grunts: string[]; highRiskGrants: string[];
  connectors: Array<[string, string[]]>; budgetWrapUp: string[];
}

/** Persist the checkpoint and waiting status together before releasing the runner. */
export async function saveRunContinuation(runId: string, state: RunContinuation): Promise<void> {
  const updatedAt = new Date();
  await (await getDb()).transaction(async (tx) => {
    await tx.insert(runCheckpoints).values({ runId, state, updatedAt })
      .onConflictDoUpdate({ target: runCheckpoints.runId, set: { state, updatedAt } });
    await tx.update(runs).set({ status: "awaiting_input", heartbeatAt: updatedAt }).where(eq(runs.id, runId));
  });
}
export class InputPause extends Error {
  constructor() { super("Waiting for user input."); }
}
export const QuestionSchema = z.object({ question: z.string().trim().min(3).max(1500), reason: z.string().trim().min(3).max(3000) });
export const AnswerSchema = z.object({ answer: z.string().trim().min(1).max(6000) });

export async function listPendingInputs(workspaceId: string, runId?: string) {
  return (await getDb()).select().from(inputRequests).where(and(
    eq(inputRequests.workspaceId, workspaceId), eq(inputRequests.status, "pending"),
    ...(runId ? [eq(inputRequests.runId, runId)] : []),
  )).orderBy(asc(inputRequests.requestedAt));
}

/** Claim both the answer and the paused run in one transaction. No duplicate resume. */
export async function answerInput(id: string, workspaceId: string, answer: string, actor: string) {
  const parsed = AnswerSchema.safeParse({ answer });
  if (!parsed.success) return { ok: false as const, status: 400, error: "Enter an answer of 1 to 6000 characters." };
  const db = await getDb();
  return await db.transaction(async (tx) => {
    const request = (await tx.select().from(inputRequests).where(and(eq(inputRequests.id, id), eq(inputRequests.workspaceId, workspaceId))))[0];
    if (!request) return { ok: false as const, status: 404, error: "Question not found." };
    const run = (await tx.select().from(runs).where(and(eq(runs.id, request.runId), eq(runs.workspaceId, workspaceId))).for("update"))[0];
    const checkpoint = (await tx.select().from(runCheckpoints).where(eq(runCheckpoints.runId, request.runId)))[0];
    if (request.status !== "pending" || run?.status !== "awaiting_input" || !checkpoint) {
      return { ok: false as const, status: 409, error: "This run is no longer waiting for that answer." };
    }
    const now = new Date();
    await tx.update(inputRequests).set({ status: "answered", answer: redactSecrets(parsed.data.answer), answeredBy: actor, answeredAt: now }).where(eq(inputRequests.id, id));
    await tx.update(runs).set({ status: "queued", heartbeatAt: now }).where(eq(runs.id, request.runId));
    await tx.insert(auditLog).values({ id: newId("aud"), workspaceId, actor, action: "input.answered", targetType: "run", targetId: request.runId, detail: { requestId: id }, at: now });
    return { ok: true as const, runId: request.runId };
  });
}
