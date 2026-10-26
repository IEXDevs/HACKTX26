import type { User as AuthUser } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { ensureBootstrapped } from "./bootstrap";
import { getDb } from "./db/client";
import { users, workspaces, type User } from "./db/schema";
import { DEMO_LOGIN, emailFromLogin } from "./auth-identity";
import { newId, now, observabilityEnabled } from "./env";
import { touchProfile } from "./observability";
import { createSupabaseServerClient, supabaseAdmin } from "./supabase";

export { DEMO_LOGIN, emailFromLogin } from "./auth-identity";

const DEFAULT_WORKSPACE_SLUG = "astronom-platform";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/** Cached per request, so the layout and page share one Supabase Auth round trip. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (error || !data.user || !email) {
    // "Auth session missing!" is the signed-out case, not a failure.
    if (error && !/session missing/i.test(error.message)) {
       
      console.warn("[auth] getSessionUser:", error.message);
    }
    return null;
  }
  const user = data.user;
  return {
    id: user.id,
    email,
    name:
      (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
      (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
      (typeof user.user_metadata?.username === "string" && user.user_metadata.username) ||
      email.split("@")[0] ||
      "Operator",
    avatarUrl:
      typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null,
  };
});

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
  const db = await getDb();
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
  const [inserted] = await db.insert(users).values(row).onConflictDoNothing({ target: users.email }).returning();
  if (inserted) return inserted;
  const [concurrent] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!concurrent) throw new Error("The signed-in user could not be saved.");
  return concurrent;
}

export async function acceptSignedInUser(authUser: AuthUser): Promise<User> {
  const local = await upsertLocalUser(authUser);
  await touchProfile(authUser.id);
  return local;
}

function hashHue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return hash;
}

let demoUserPromise: Promise<void> | null = null;

/** Create the demo password user if it is missing. Never reset the password
 * on an existing user — GoTrue revokes every session when password is in the
 * update payload, which looks like "login does not stick". */
export function ensureDemoUser(): Promise<void> {
  if (!demoUserPromise) {
    demoUserPromise = provisionDemoUser().catch((error) => {
      demoUserPromise = null;
       
      console.warn("[auth] demo user:", error instanceof Error ? error.message : error);
    });
  }
  return demoUserPromise;
}

const demoMetadata = { full_name: DEMO_LOGIN.name, username: DEMO_LOGIN.username };

async function findDemoUser() {
  const admin = supabaseAdmin();
  if (!admin) return { admin: null, existing: null } as const;
  const email = emailFromLogin(DEMO_LOGIN.username);
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  if (error) throw error;
  return {
    admin,
    existing: data.users.find((user) => user.email?.toLowerCase() === email) ?? null,
  };
}

async function provisionDemoUser(): Promise<void> {
  if (!observabilityEnabled()) return;
  const { admin, existing } = await findDemoUser();
  if (!admin || existing) return;
  const { error: createError } = await admin.auth.admin.createUser({
    email: emailFromLogin(DEMO_LOGIN.username),
    password: DEMO_LOGIN.password,
    email_confirm: true,
    user_metadata: demoMetadata,
  });
  if (createError) throw createError;
}

/** Repair the advertised demo password after a failed sign-in. */
export async function resetDemoPassword(): Promise<void> {
  if (!observabilityEnabled()) return;
  const { admin, existing } = await findDemoUser();
  if (!admin || !existing) {
    await provisionDemoUser();
    return;
  }
  const { error } = await admin.auth.admin.updateUserById(existing.id, {
    password: DEMO_LOGIN.password,
    email_confirm: true,
    user_metadata: demoMetadata,
  });
  if (error) throw error;
}
