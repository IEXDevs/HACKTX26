import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  // 303 so the browser follows with GET, not a repeat of this POST.
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
