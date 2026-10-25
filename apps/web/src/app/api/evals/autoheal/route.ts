import { NextRequest } from "next/server";
import { z } from "zod";
import { person } from "@/lib/loop/cases";
import { getWorkspaceUser } from "@/lib/queries";
import { healFinding, healWorkspace } from "@/lib/runtime/autoheal";

export const dynamic = "force-dynamic";

const Body = z.object({
  findingId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

/**
 * Propose fixes for red-team findings. Nothing is applied and nothing is
 * marked fixed here: each proposal waits for a person's approval in its case,
 * and only a passing retest closes a finding. The person who calls this
 * accepts the findings it covers.
 */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "Expected { findingId?: string, limit?: number }." },
      { status: 400 },
    );
  }

  const { workspace, user } = await getWorkspaceUser();
  const actor = person(user?.email ?? "operator@local");

  try {
    const proposed = parsed.data.findingId
      ? [await healFinding(workspace.id, parsed.data.findingId, actor)]
      : await healWorkspace(workspace.id, actor, parsed.data.limit ?? 3);
    const waiting = proposed.filter((p) => p.status === "awaiting_approval").length;

    return Response.json(
      {
        proposed,
        proposedCount: proposed.length,
        message:
          proposed.length === 0
            ? "No open high or critical findings to fix."
            : `${waiting} fix${waiting === 1 ? "" : "es"} proposed. Each one waits for your approval.`,
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
