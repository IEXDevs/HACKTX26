import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { agents, auditLog, evalSuites } from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { getWorkspaceContext, requireWorkspace } from "@/lib/queries";
import { runEvalSuite, runEvalSuites } from "@/lib/runtime/evals";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    suiteId: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
    overall: z.boolean().optional(),
  })
  .refine((value) => Number(Boolean(value.suiteId)) + Number(Boolean(value.templateId)) + Number(Boolean(value.overall)) === 1, {
    message: "Expected { suiteId }, { templateId }, or { overall: true }.",
  });

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid eval request." }, { status: 400 });
  }

  const workspace = await requireWorkspace();

  try {
    const suiteIds = parsed.data.suiteId
      ? [parsed.data.suiteId]
      : await suiteIdsFor(workspace.id, parsed.data.templateId, parsed.data.overall === true);

    if (suiteIds.length === 0) {
      return Response.json({ error: "No eval suites to run." }, { status: 400 });
    }

    const batch = suiteIds.length === 1 ? { results: [await runEvalSuite(workspace.id, suiteIds[0]!)] } : await runEvalSuites(workspace.id, suiteIds);
    const { user } = await getWorkspaceContext();
    const casesPassed = batch.results.reduce((sum, result) => sum + result.row.casesPassed, 0);
    const casesTotal = batch.results.reduce((sum, result) => sum + result.row.casesTotal, 0);
    await getDb().insert(auditLog).values({
      id: newId("aud"),
      workspaceId: workspace.id,
      actor: user?.email ?? "operator@local",
      action: "eval.run",
      targetType: parsed.data.suiteId ? "eval_suite" : parsed.data.templateId ? "template" : "workspace",
      targetId: parsed.data.suiteId ?? parsed.data.templateId ?? workspace.id,
      detail: {
        suiteIds,
        casesPassed,
        casesTotal,
      },
      at: new Date(),
    });

    const first = batch.results[0]!;
    return Response.json(
      {
        ...first,
        casesPassed,
        casesTotal,
        suites: batch.results.length,
        failed: batch.results.filter((result) => result.row.status === "failed").length,
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}

async function suiteIdsFor(workspaceId: string, templateId: string | undefined, overall: boolean): Promise<string[]> {
  const db = getDb();
  const suites = await db.select().from(evalSuites).where(eq(evalSuites.workspaceId, workspaceId));
  if (overall) return suites.map((suite) => suite.id);
  if (!templateId) return [];
  const agentRows = await db.select({ id: agents.id, templateId: agents.templateId }).from(agents);
  const ids = new Set(agentRows.filter((agent) => agent.templateId === templateId).map((agent) => agent.id));
  return suites.filter((suite) => ids.has(suite.agentId)).map((suite) => suite.id);
}
