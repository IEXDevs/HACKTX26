import { NextRequest, NextResponse } from "next/server";
import { supabaseAuthEnabled } from "@/lib/env";
import { recordAuthEvent } from "@/lib/observability";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return startGoogleLogin(request);
}

export async function GET(request: NextRequest) {
  return startGoogleLogin(request);
}

// 303, not the default 307: the button posts a form, and a 307 would make the
// browser repeat that POST against Supabase's authorize URL, which only takes GET.
async function startGoogleLogin(request: NextRequest) {
  if (!supabaseAuthEnabled()) {
    return NextResponse.redirect(new URL("/login?error=Auth%20is%20not%20configured", request.url), 303);
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/login?error=Auth%20is%20not%20configured", request.url), 303);
  }

  const formNext =
    request.method === "POST"
      ? (await request.formData().catch(() => null))?.get("next")
      : request.nextUrl.searchParams.get("next");
  const nextPath = typeof formNext === "string" && formNext.startsWith("/") ? formNext : "/";
  const origin = request.nextUrl.origin;
  const redirectTo = new URL("/auth/callback", origin);
  redirectTo.searchParams.set("next", nextPath);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectTo.toString(),
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });

  if (error || !data.url) {
    await recordAuthEvent({
      event: "login_failed",
      provider: "google",
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
      metadata: { message: error?.message ?? "missing oauth url" },
    });
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error?.message ?? "Google sign-in failed")}`, origin),
      303,
    );
  }

  return NextResponse.redirect(data.url, 303);
}
