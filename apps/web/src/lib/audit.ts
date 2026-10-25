import { getDb } from "./db/client";
import { auditLog } from "./db/schema";
import { newId } from "./env";
import { recordActivity } from "./observability";

export async function writeAudit(input: {
  workspaceId: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  detail?: Record<string, unknown>;
  userId?: string | null;
}): Promise<void> {
  await getDb().insert(auditLog).values({
    id: newId("aud"),
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    detail: input.detail ?? {},
    at: new Date(),
  });
  void recordActivity({
    workspaceId: input.workspaceId,
    userId: input.userId,
    actor: input.actor,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    detail: input.detail,
  });
}
