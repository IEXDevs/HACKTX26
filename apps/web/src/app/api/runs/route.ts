import { NextRequest } from "next/server";
import { z } from "zod";
import { operatorIdFor } from "@/lib/connectors";
import { getSessionUser } from "@/lib/auth";
import { getWorkspaceUser, listRuns, requireWorkspace } from "@/lib/queries";
import { createRun } from "@/lib/runtime/orchestrator";

export const dynamic = "force-dynamic";

const CreateRunBody = z.object({
  agentId: z.string().min(1),
  goal: z.string().min(8).max(4_000),
  dataClass: z.enum(["public", "internal", "confidential", "restricted"]).optional(),
  budgetUsd: z.number().positive().max(100).optional(),
  mode: z.enum(["scripted", "live"]).optional(),
  triggerId: z.string().min(1).nullable().optional(),
});

export async function GET() {
  const workspace = await requireWorkspace();
  const rows = await listRuns(workspace.id, { limit: 100 });
  return Response.json({ runs: rows });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = CreateRunBody.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid run request.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { workspace, user } = await getWorkspaceUser();
  const session = await getSessionUser();

  try {
    const runId = await createRun({
      workspaceId: workspace.id,
      agentId: parsed.data.agentId,
      goal: parsed.data.goal,
      dataClass: parsed.data.dataClass,
      budgetUsd: parsed.data.budgetUsd,
      mode: parsed.data.mode,
      triggerId: parsed.data.triggerId ?? null,
      trigger: "manual",
      operatorUserId: operatorIdFor(session?.id, user?.id),
    });
    return Response.json({ runId }, { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 409 });
  }
}
