import { NextRequest, NextResponse } from "next/server";
import {
  acceptSignedInUser,
  DEMO_LOGIN,
  emailFromLogin,
  ensureDemoUser,
  resetDemoPassword,
} from "@/lib/auth";
import { supabaseAuthEnabled } from "@/lib/env";
import { recordAuthEvent } from "@/lib/observability";
import { authOrigin, createSupabaseRequestClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/login", request.url), 303);
}

export async function POST(request: NextRequest) {
  const origin = authOrigin(request);
  if (!supabaseAuthEnabled()) {
    return NextResponse.redirect(new URL("/login?error=Auth%20is%20not%20configured", origin), 303);
  }

  const form = await request.formData().catch(() => null);
  const username = String(form?.get("username") ?? "").trim();
  const password = String(form?.get("password") ?? "");
  const nextRaw = String(form?.get("next") ?? "/");
  const next = nextRaw.startsWith("/") ? nextRaw : "/";
  const email = emailFromLogin(username);

  if (!email || !password) {
    return NextResponse.redirect(
      new URL("/login?error=Username%20and%20password%20are%20required", origin),
      303,
    );
  }

  await ensureDemoUser();
  const client = createSupabaseRequestClient(request);
  if (!client) {
    return NextResponse.redirect(new URL("/login?error=Auth%20is%20not%20configured", origin), 303);
  }

  let { data, error } = await client.supabase.auth.signInWithPassword({ email, password });
  const isDemo =
    username.toLowerCase() === DEMO_LOGIN.username && password === DEMO_LOGIN.password;
  if ((error || !data.user) && isDemo) {
    await resetDemoPassword().catch((resetError) => {
      // eslint-disable-next-line no-console
      console.warn("[auth] reset demo password:", resetError instanceof Error ? resetError.message : resetError);
    });
    ({ data, error } = await client.supabase.auth.signInWithPassword({ email, password }));
  }
  if (error || !data.user) {
    await recordAuthEvent({
      email,
      event: "login_failed",
      provider: "email",
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
      metadata: { username, message: error?.message ?? "sign-in failed" },
    });
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error?.message ?? "Sign-in failed")}`, origin),
      303,
    );
  }

  await acceptSignedInUser(data.user, request);
  // 303, not 307: a form POST must follow as GET, or the session cookies land
  // on a replayed POST to `/` and the browser looks unsigned-in.
  return client.applyCookies(NextResponse.redirect(new URL(next, origin), 303));
}
