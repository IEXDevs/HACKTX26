import { NextRequest } from "next/server";
import { z } from "zod";
import { requireWorkspace } from "@/lib/queries";
import { healFinding, healWorkspace } from "@/lib/runtime/autoheal";

export const dynamic = "force-dynamic";

const Body = z.object({
  findingId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

/**
 * Lock in a hard boundary derived from a red-team finding.
 *
 * The result is an org-level prompt block attached to every agent. Re-running
 * the eval suite after this is an honest test: the trace either shows the rule
 * being respected or it does not.
 */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "Expected { findingId?: string, limit?: number }." },
      { status: 400 },
    );
  }

  const workspace = await requireWorkspace();

  try {
    const healed = parsed.data.findingId
      ? [await healFinding(workspace.id, parsed.data.findingId)]
      : await healWorkspace(workspace.id, parsed.data.limit ?? 3);

    return Response.json(
      {
        healed,
        healedCount: healed.length,
        message:
          healed.length === 0
            ? "No open high or critical findings to heal."
            : `${healed.length} guardrail${healed.length === 1 ? "" : "s"} locked into the company prompt stack.`,
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
