import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { recordAuthEvent } from "@/lib/observability";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  if (session) {
    await recordAuthEvent({
      userId: session.id,
      email: session.email,
      event: "signed_out",
      provider: "google",
    });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}
