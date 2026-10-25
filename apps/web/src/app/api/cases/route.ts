import { NextRequest } from "next/server";
import { z } from "zod";
import { advanceCase } from "@/lib/loop/blue-team";
import { elevateCase, loadCase, openCase, person } from "@/lib/loop/cases";
import { getWorkspaceUser } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Body = z.object({ findingId: z.string().min(1) });

/**
 * A person accepts a finding: this opens its feedback-loop case, sends it up
 * the chain of command to the target's creator, and hands it to the blue team.
 */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Expected { findingId }." }, { status: 400 });
  const { workspace, user } = await getWorkspaceUser();
  const actor = user?.email ?? "operator@local";
  try {
    const opened = await openCase(parsed.data.findingId, person(actor));
    if (opened.workspaceId !== workspace.id) {
      return Response.json({ error: "Finding not found." }, { status: 404 });
    }
    const row = opened.deliveredTo ? opened : await elevateCase(opened.id, actor);
    await advanceCase(row.id);
    return Response.json({ case: await loadCase(row.id) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 409 });
  }
}
