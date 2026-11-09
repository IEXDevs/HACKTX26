import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase-middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Crawlers must fetch these files without being redirected to login.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots\\.txt$|sitemap\\.xml$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
