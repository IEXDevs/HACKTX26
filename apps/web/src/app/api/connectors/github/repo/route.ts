import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { getGithubWorkingRepo, operatorIdFor, setGithubWorkingRepo } from "@/lib/connectors";
import { refreshGithubCache } from "@/lib/github-sync";
import { getWorkspaceUser } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const { workspace, user } = await getWorkspaceUser();
  const session = await getSessionUser();
  const working = await getGithubWorkingRepo(workspace.id, operatorIdFor(session?.id, user?.id));
  return Response.json({ repo: working?.repo ?? null, branch: working?.branch ?? null });
}

const Body = z.object({
  repo: z.string().min(1).max(200),
  branch: z.string().max(120).optional(),
  sync: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Expected { repo, branch? }." }, { status: 400 });
  }
  const { workspace, user } = await getWorkspaceUser();
  const session = await getSessionUser();
  const operatorId = operatorIdFor(session?.id, user?.id);
  try {
    const working = await setGithubWorkingRepo(workspace.id, operatorId, parsed.data.repo, parsed.data.branch);
    await writeAudit({
      workspaceId: workspace.id,
      actor: user?.email ?? session?.email ?? operatorId,
      action: "connector.github.repo",
      targetType: "connector",
      targetId: "github",
      detail: { repo: working.repo, branch: working.branch },
      userId: session?.id ?? null,
    });
    let sync: { files: number; skipped: boolean; error?: string } | null = null;
    if (parsed.data.sync !== false) {
      const result = await refreshGithubCache({ workspaceId: workspace.id, userId: operatorId });
      sync = { files: result.files, skipped: result.skipped, error: result.error };
    }
    return Response.json({ ok: true, ...working, sync });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
