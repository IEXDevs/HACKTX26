import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env, observabilityEnabled, supabaseAuthEnabled } from "./env";

export type AppSupabaseClient = SupabaseClient;

export async function createSupabaseServerClient(): Promise<AppSupabaseClient | null> {
  if (!supabaseAuthEnabled()) return null;
  const cookieStore = await cookies();
  return createServerClient(env.supabase.url, env.supabase.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        try {
          for (const cookie of cookiesToSet) {
            cookieStore.set(cookie.name, cookie.value, cookie.options);
          }
        } catch {
          // Server Components cannot always set cookies; middleware refreshes the session.
        }
      },
    },
  });
}

let adminClient: AppSupabaseClient | null | undefined;

/** Service-role client. Bypasses RLS. Never import this from a client component. */
export function supabaseAdmin(): AppSupabaseClient | null {
  if (!observabilityEnabled()) return null;
  if (adminClient !== undefined) return adminClient;
  adminClient = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}
