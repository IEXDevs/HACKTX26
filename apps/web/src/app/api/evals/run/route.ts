import { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import { newId } from "@/lib/env";
import { getWorkspaceContext, requireWorkspace } from "@/lib/queries";
import { runEvalSuite } from "@/lib/runtime/evals";

export const dynamic = "force-dynamic";

const Body = z.object({ suiteId: z.string().min(1) });

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { suiteId }." }, { status: 400 });
  }

  const workspace = await requireWorkspace();

  try {
    const result = await runEvalSuite(workspace.id, parsed.data.suiteId);
    const { user } = await getWorkspaceContext();
    await getDb().insert(auditLog).values({
      id: newId("aud"),
      workspaceId: workspace.id,
      actor: user?.email ?? "operator@local",
      action: "eval.run",
      targetType: "eval_suite",
      targetId: parsed.data.suiteId,
      detail: {
        evalRunId: result.row.id,
        toolCallAccuracy: result.row.toolCallAccuracy,
        casesPassed: result.row.casesPassed,
        casesTotal: result.row.casesTotal,
      },
      at: new Date(),
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
