import { NextRequest } from "next/server";
import { z } from "zod";
import { elevateCase, openCase, person } from "@/lib/loop/cases";
import { getWorkspaceContext } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Body = z.object({ findingId: z.string().min(1) });

/**
 * A person accepts a finding: this opens its feedback-loop case and sends it
 * up the chain of command to the target's creator.
 */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Expected { findingId }." }, { status: 400 });
  const { workspace, user } = await getWorkspaceContext();
  const actor = user?.email ?? "operator@local";
  try {
    const opened = await openCase(parsed.data.findingId, person(actor));
    if (opened.workspaceId !== workspace.id) {
      return Response.json({ error: "Finding not found." }, { status: 404 });
    }
    const row = opened.deliveredTo ? opened : await elevateCase(opened.id, actor);
    return Response.json({ case: row }, { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 409 });
  }
}
