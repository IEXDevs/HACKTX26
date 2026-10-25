import { NextRequest, NextResponse } from "next/server";
import { acceptSignedInUser } from "@/lib/auth";
import { recordAuthEvent } from "@/lib/observability";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextRaw = request.nextUrl.searchParams.get("next") ?? "/";
  const next = nextRaw.startsWith("/") ? nextRaw : "/";
  const origin = request.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=Missing%20auth%20code", origin));
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(new URL("/login?error=Auth%20is%20not%20configured", origin));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    await recordAuthEvent({
      event: "login_failed",
      provider: "google",
      metadata: { message: error.message },
    });
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, origin),
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await acceptSignedInUser(user, request);
  }

  return NextResponse.redirect(new URL(next, origin));
}
