import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { endConnect, operatorIdFor } from "@/lib/connectors";
import { getWorkspaceUser } from "@/lib/queries";
import { authOrigin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const dest = new URL("/connectors", authOrigin(request));
  try {
    const { workspace, user } = await getWorkspaceUser();
    const session = await getSessionUser();
    const hinted = request.nextUrl.searchParams.get("uid");
    const operatorId = session?.id
      ? operatorIdFor(session.id, user?.id)
      : hinted && hinted.length > 0
        ? hinted
        : operatorIdFor(null, user?.id);
    await endConnect(workspace.id, operatorId);
    dest.searchParams.set("linked", "1");
  } catch {
    dest.searchParams.set("linked", "0");
    dest.searchParams.set("error", "connect");
  }
  return NextResponse.redirect(dest);
}
