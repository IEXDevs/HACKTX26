import { NextRequest } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { addKbDocument } from "@/lib/runtime/kb";
import { assetFailure, requireAssetAccount } from "@/lib/account-assets";

export const dynamic = "force-dynamic";

const Body = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(60_000),
  dataClass: z.enum(["public", "internal", "confidential", "restricted"]).default("internal"),
}).strict();

/** Add a document for agents to search. Agents never see one above their own data class. */
export async function POST(request: NextRequest) {
  try {
    const account = await requireAssetAccount();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "Expected { title, body, dataClass? }. The text can be up to 60,000 characters." },
        { status: 400 },
      );
    }

    const id = await addKbDocument({
      workspaceId: account.workspaceId,
      title: parsed.data.title,
      body: parsed.data.body,
      dataClass: parsed.data.dataClass,
      addedBy: account.accountId,
    });

    await writeAudit({
      workspaceId: account.workspaceId,
      actor: account.accountId,
      action: "kb.document_added",
      targetType: "kb_document",
      targetId: id,
      detail: { dataClass: parsed.data.dataClass },
    });

    return Response.json({ id }, { status: 201 });
  } catch (error) { return assetFailure(error); }
}
