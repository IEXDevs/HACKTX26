import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
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

/** Origin used in Google redirectTo. Query strings are not allowed on this URL. */
export function authOrigin(request: NextRequest): string {
  const host = (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "localhost:3000"
  ).replace("127.0.0.1", "localhost");
  const proto =
    request.headers.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Route-handler client. Cookies set during OAuth/password sign-in are copied
 * onto the NextResponse we return — otherwise PKCE/session cookies never
 * reach the browser and Google login fails after the redirect.
 */
export function createSupabaseRequestClient(request: NextRequest): {
  supabase: AppSupabaseClient;
  applyCookies: (response: NextResponse) => NextResponse;
} | null {
  if (!supabaseAuthEnabled()) return null;
  const pending: Array<{ name: string; value: string; options: CookieOptions }> = [];
  const supabase = createServerClient(env.supabase.url, env.supabase.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
          pending.push(cookie);
        }
      },
    },
  });
  return {
    supabase,
    applyCookies(response) {
      for (const cookie of pending) {
        response.cookies.set(cookie.name, cookie.value, cookie.options);
      }
      return response;
    },
  };
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
