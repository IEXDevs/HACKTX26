import { getSessionUser } from "@/lib/auth";
import { getConnectedComposioAccountId, operatorIdFor } from "@/lib/connectors";
import { listGithubRepos } from "@/lib/github-sync";
import { getWorkspaceUser } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const { workspace, user } = await getWorkspaceUser();
  const session = await getSessionUser();
  const operatorId = operatorIdFor(session?.id, user?.id);
  try {
    const accountId = await getConnectedComposioAccountId(workspace.id, operatorId, "github");
    const repos = await listGithubRepos(operatorId, undefined, accountId);
    return Response.json({ repos });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
