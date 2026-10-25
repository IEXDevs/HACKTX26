import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS, writeAuthCookies } from "./auth-cookies";
import { env, observabilityEnabled, supabaseAuthEnabled } from "./env";

export type AppSupabaseClient = SupabaseClient;

function isHttps(request?: NextRequest): boolean {
  const proto = request?.headers.get("x-forwarded-proto") ?? request?.nextUrl.protocol;
  return proto === "https" || proto === "https:";
}

export async function createSupabaseServerClient(): Promise<AppSupabaseClient | null> {
  if (!supabaseAuthEnabled()) return null;
  const cookieStore = await cookies();
  return createServerClient(env.supabase.url, env.supabase.anonKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      encode: "tokens-only",
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        try {
          writeAuthCookies(cookieStore, cookiesToSet);
        } catch {
          // Server Components cannot always set cookies; middleware refreshes the session.
        }
      },
    },
  });
}

/** Map loopback hosts to localhost so OAuth apps registered for localhost still match. */
export function canonicalizeLoopbackHost(host: string): string {
  return host
    .trim()
    .replace(/^127\.0\.0\.1\b/i, "localhost")
    .replace(/^0\.0\.0\.0\b/i, "localhost")
    .replace(/^\[::1\]/i, "localhost");
}

/** Origin used in Google redirectTo and Composio callbacks. Query strings are not allowed on this URL. */
export function authOrigin(request: NextRequest): string {
  const host = canonicalizeLoopbackHost(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000",
  );
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
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
  const pendingHeaders: Record<string, string> = {};
  const https = isHttps(request);
  const supabase = createServerClient(env.supabase.url, env.supabase.anonKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      encode: "tokens-only",
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
          pending.push(cookie);
        }
        Object.assign(pendingHeaders, headers);
      },
    },
  });
  return {
    supabase,
    applyCookies(response) {
      writeAuthCookies(response.cookies, pending, https);
      for (const [key, value] of Object.entries(pendingHeaders)) {
        response.headers.set(key, value);
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
