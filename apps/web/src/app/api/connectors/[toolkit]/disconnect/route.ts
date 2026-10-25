import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { disconnectAccount, operatorIdFor } from "@/lib/connectors";
import { getWorkspaceUser } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ toolkit: string }> },
) {
  const { toolkit } = await context.params;
  const { workspace, user } = await getWorkspaceUser();
  const session = await getSessionUser();
  const operatorId = operatorIdFor(session?.id, user?.id);
  try {
    await disconnectAccount(workspace.id, operatorId, toolkit);
    await writeAudit({
      workspaceId: workspace.id,
      actor: user?.email ?? session?.email ?? operatorId,
      action: "connector.disconnect",
      targetType: "connector",
      targetId: toolkit,
      userId: session?.id ?? null,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
