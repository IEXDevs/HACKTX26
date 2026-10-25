import { NextRequest, NextResponse } from "next/server";
import { supabaseAuthEnabled } from "@/lib/env";
import { authOrigin, createSupabaseRequestClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return startGoogleLogin(request);
}

export async function GET(request: NextRequest) {
  return startGoogleLogin(request);
}

function safeNext(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") ? value : "/";
}

// 303, not the default 307: the button posts a form, and a 307 would make the
// browser repeat that POST against Supabase's authorize URL, which only takes GET.
async function startGoogleLogin(request: NextRequest) {
  const origin = authOrigin(request);
  if (!supabaseAuthEnabled()) {
    return NextResponse.redirect(new URL("/login?error=Auth%20is%20not%20configured", origin), 303);
  }
  const client = createSupabaseRequestClient(request);
  if (!client) {
    return NextResponse.redirect(new URL("/login?error=Auth%20is%20not%20configured", origin), 303);
  }

  const formNext =
    request.method === "POST"
      ? (await request.formData().catch(() => null))?.get("next")
      : request.nextUrl.searchParams.get("next");
  const nextPath = safeNext(formNext);

  // Must match Authentication > URL configuration exactly. Do not put ?next= here.
  const redirectTo = `${origin}/auth/callback`;

  const { data, error } = await client.supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data.url) {
    const message = error?.message ?? "Google sign-in failed";
    const hint =
      /provider/i.test(message)
        ? `${message}. Enable Google under Authentication > Providers.`
        : /redirect/i.test(message)
          ? `${message}. Add ${redirectTo} to Authentication > URL configuration.`
          : message;
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(hint)}`, origin), 303);
  }

  const response = NextResponse.redirect(data.url, 303);
  response.cookies.set("auth-next", nextPath, {
    path: "/",
    maxAge: 600,
    sameSite: "lax",
    httpOnly: true,
  });
  return client.applyCookies(response);
}
