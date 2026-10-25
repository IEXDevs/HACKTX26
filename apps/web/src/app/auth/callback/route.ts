import { NextRequest, NextResponse } from "next/server";
import { acceptSignedInUser } from "@/lib/auth";
import { authOrigin, createSupabaseRequestClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function loginError(origin: string, message: string) {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, origin));
}

export async function GET(request: NextRequest) {
  const origin = authOrigin(request);
  const errorParam =
    request.nextUrl.searchParams.get("error_description") ??
    request.nextUrl.searchParams.get("error");
  if (errorParam) {
    return loginError(origin, errorParam);
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return loginError(
      origin,
      "Google did not return an auth code. Check that the Google provider is enabled and the redirect URL is http://localhost:3000/auth/callback.",
    );
  }

  const client = createSupabaseRequestClient(request);
  if (!client) return loginError(origin, "Auth is not configured");

  const { error } = await client.supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return loginError(origin, error.message);
  }

  const {
    data: { user },
  } = await client.supabase.auth.getUser();
  if (user) {
    await acceptSignedInUser(user);
  }

  const nextRaw = request.cookies.get("auth-next")?.value ?? "/";
  const next = nextRaw.startsWith("/") ? nextRaw : "/";
  const response = NextResponse.redirect(new URL(next, origin));
  response.cookies.set("auth-next", "", { path: "/", maxAge: 0 });
  return client.applyCookies(response);
}
