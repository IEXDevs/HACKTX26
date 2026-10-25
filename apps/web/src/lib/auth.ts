import type { User as AuthUser } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { ensureBootstrapped } from "./bootstrap";
import { getDb } from "./db/client";
import { users, workspaces, type User } from "./db/schema";
import { newId, now } from "./env";
import { recordAuthEvent, touchProfile } from "./observability";
import { createSupabaseServerClient } from "./supabase";

const DEFAULT_WORKSPACE_SLUG = "astronom-platform";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (error || !data.user || !email) return null;
  const user = data.user;
  return {
    id: user.id,
    email,
    name:
      (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
      (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
      email.split("@")[0] ||
      "Operator",
    avatarUrl:
      typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null,
  };
}

export async function upsertLocalUser(
  authUser: AuthUser | SessionUser,
  workspaceId?: string,
): Promise<User> {
  await ensureBootstrapped();
  const email =
    "email" in authUser && authUser.email
      ? authUser.email
      : ((authUser as AuthUser).email ?? "");
  const metadata = "user_metadata" in authUser ? authUser.user_metadata : {};
  const name =
    (typeof metadata?.full_name === "string" && metadata.full_name) ||
    (typeof metadata?.name === "string" && metadata.name) ||
    ("name" in authUser && typeof authUser.name === "string" ? authUser.name : email.split("@")[0]!) ||
    "Operator";
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) return existing;

  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, DEFAULT_WORKSPACE_SLUG))
    .limit(1);
  const row = {
    id: newId("usr"),
    workspaceId: workspaceId ?? workspace?.id ?? "ws_astronom",
    name,
    email,
    role: "engineer" as const,
    avatarHue: Math.abs(hashHue(email)) % 360,
    createdAt: now(),
  };
  await db.insert(users).values(row);
  return row;
}

export async function acceptSignedInUser(
  authUser: AuthUser,
  request: Request,
): Promise<User> {
  const local = await upsertLocalUser(authUser);
  await recordAuthEvent({
    userId: authUser.id,
    email: authUser.email,
    event: "signed_in",
    provider: authUser.app_metadata?.provider ?? "google",
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
    metadata: {
      localUserId: local.id,
      workspaceId: local.workspaceId,
    },
  });
  await touchProfile(authUser.id);
  return local;
}

function hashHue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return hash;
}
