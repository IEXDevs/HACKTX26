import { NextRequest } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { getWorkspaceUser, requireWorkspace } from "@/lib/queries";
import { addKbDocument } from "@/lib/runtime/kb";

export const dynamic = "force-dynamic";

const Body = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(60_000),
  dataClass: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
});

/** Add a document for agents to search. Agents never see one above their own data class. */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Expected { title, body, dataClass? }. The text can be up to 60,000 characters." },
      { status: 400 },
    );
  }

  const workspace = await requireWorkspace();
  const { user } = await getWorkspaceUser();
  const actor = user?.email ?? "operator@local";
  const id = await addKbDocument({
    workspaceId: workspace.id,
    title: parsed.data.title,
    body: parsed.data.body,
    dataClass: parsed.data.dataClass,
    addedBy: actor,
  });

  await writeAudit({
    workspaceId: workspace.id,
    actor,
    action: "kb.document_added",
    targetType: "kb_document",
    targetId: id,
    detail: { title: parsed.data.title, dataClass: parsed.data.dataClass, chars: parsed.data.body.length },
  });

  return Response.json({ id }, { status: 201 });
}
