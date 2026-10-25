import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import {
  ACTION_POLICIES,
  POLICY_EFFECTS,
  resolveActionEffects,
  type PolicyEffect,
} from "@agent-os/core";
import { writeAudit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
import { getWorkspaceUser } from "@/lib/queries";

export const dynamic = "force-dynamic";

const EffectBody = {
  parse(value: unknown): Record<string, PolicyEffect> | null {
    if (!value || typeof value !== "object") return null;
    const effects = (value as { effects?: unknown }).effects;
    if (!effects || typeof effects !== "object") return null;
    const allowed = new Set<string>(ACTION_POLICIES.map((row) => row.resource));
    const next: Record<string, PolicyEffect> = {};
    for (const [resource, effect] of Object.entries(effects as Record<string, unknown>)) {
      if (!allowed.has(resource)) continue;
      if (!POLICY_EFFECTS.includes(effect as PolicyEffect)) return null;
      next[resource] = effect as PolicyEffect;
    }
    return next;
  },
};

export async function GET() {
  const { workspace } = await getWorkspaceUser();
  return Response.json({ effects: resolveActionEffects(workspace.actionEffects) });
}

export async function PATCH(request: NextRequest) {
  const { workspace, user } = await getWorkspaceUser();
  const body = await request.json().catch(() => null);
  const patch = EffectBody.parse(body);
  if (!patch) {
    return Response.json({ error: "Invalid policy." }, { status: 400 });
  }
  const effects = resolveActionEffects({ ...workspace.actionEffects, ...patch });
  await getDb()
    .update(workspaces)
    .set({ actionEffects: effects })
    .where(eq(workspaces.id, workspace.id));
  await writeAudit({
    workspaceId: workspace.id,
    actor: user?.email ?? user?.name ?? "operator",
    action: "policy.actions_updated",
    targetType: "workspace",
    targetId: workspace.id,
    detail: { effects: patch },
    userId: user?.id,
  });
  return Response.json({ effects });
}
