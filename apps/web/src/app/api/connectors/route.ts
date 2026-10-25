import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listConnectorViews, operatorIdFor } from "@/lib/connectors";
import { getWorkspaceUser } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { workspace, user } = await getWorkspaceUser();
  const session = await getSessionUser();
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const result = await listConnectorViews({
    workspaceId: workspace.id,
    userId: operatorIdFor(session?.id, user?.id),
    query,
  });
  return Response.json(result);
}
