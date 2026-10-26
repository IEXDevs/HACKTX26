import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_OPTIONS, hasAuthTokenCookie, writeAuthCookies } from "./auth-cookies";
import { runtimeEnv } from "./runtime-env";

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/auth/login",
  "/auth/password",
  "/auth/signout",
  "/api/connectors/callback",
  "/api/health",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const url = runtimeEnv("NEXT_PUBLIC_SUPABASE_URL") ?? "";
  const anonKey = runtimeEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? "";
  const pathname = request.nextUrl.pathname;
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  if (!url || !anonKey) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(url, anonKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      encode: "tokens-only",
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const cookie of cookiesToSet) request.cookies.set(cookie.name, cookie.value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        writeAuthCookies(response.cookies, cookiesToSet, https);
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const signedIn =
    Boolean(user) || Boolean(session?.access_token) || hasAuthTokenCookie(request.cookies.getAll());

  if (!signedIn && !isPublic(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    if (pathname !== "/") login.searchParams.set("next", pathname);
    const redirect = NextResponse.redirect(login);
    copyCookies(response, redirect);
    return redirect;
  }

  if (signedIn && pathname === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    const redirect = NextResponse.redirect(home);
    copyCookies(response, redirect);
    return redirect;
  }

  return response;
}

function copyCookies(from: NextResponse, to: NextResponse): void {
  const setCookies =
    typeof from.headers.getSetCookie === "function" ? from.headers.getSetCookie() : [];
  for (const cookie of setCookies) {
    to.headers.append("set-cookie", cookie);
  }
}
