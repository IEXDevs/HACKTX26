import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { beginConnect, operatorIdFor } from "@/lib/connectors";
import { supabaseAuthEnabled } from "@/lib/env";
import { getWorkspaceUser } from "@/lib/queries";
import { authOrigin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ toolkit: string }> },
) {
  const { toolkit } = await context.params;
  const { workspace, user } = await getWorkspaceUser();
  const session = await getSessionUser();
  if (supabaseAuthEnabled() && !session?.id) {
    return Response.json({ error: "Sign in required to link apps." }, { status: 401 });
  }
  const operatorId = operatorIdFor(session?.id, user?.id);
  const callbackUrl = `${authOrigin(request)}/api/connectors/callback?uid=${encodeURIComponent(operatorId)}`;

  try {
    const { redirectUrl } = await beginConnect({
      workspaceId: workspace.id,
      userId: operatorId,
      toolkit,
      callbackUrl,
    });
    await writeAudit({
      workspaceId: workspace.id,
      actor: user?.email ?? session?.email ?? operatorId,
      action: "connector.connect",
      targetType: "connector",
      targetId: toolkit,
      userId: session?.id ?? null,
    });
    return Response.json({ redirectUrl });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
