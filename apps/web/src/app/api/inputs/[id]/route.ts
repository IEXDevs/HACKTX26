import { NextRequest } from "next/server";
import { getWorkspaceUser } from "@/lib/queries";
import { answerInput, AnswerSchema } from "@/lib/runtime/run-input";
import { executeRun } from "@/lib/runtime/orchestrator";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = AnswerSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Enter an answer of 1 to 6000 characters." }, { status: 400 });
  const { workspace, user } = await getWorkspaceUser();
  const result = answerInput((await params).id, workspace.id, body.data.answer, user?.email ?? "operator@local");
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  void executeRun(result.runId).catch((error) => console.error(`[run ${result.runId}] resume failed`, error));
  return Response.json({ ok: true, runId: result.runId });
}
