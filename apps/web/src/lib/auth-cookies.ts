import type { CookieOptions } from "@supabase/ssr";

/** Chrome caps cookie lifetime at 400 days. */
export const SESSION_MAX_AGE = 400 * 24 * 60 * 60;

type CookieSetter = {
  set(
    name: string,
    value: string,
    options?: {
      path?: string;
      maxAge?: number;
      expires?: Date;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "lax" | "strict" | "none";
    },
  ): unknown;
};

/** Next.js rejects unknown cookie fields (like `name` leaking from supabase). */
export function persistCookieOptions(
  options?: CookieOptions,
  https = false,
): {
  path: string;
  maxAge: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
} {
  const clearing = options?.maxAge === 0;
  return {
    path: "/",
    maxAge: clearing ? 0 : (options?.maxAge ?? SESSION_MAX_AGE),
    httpOnly: true,
    secure: https,
    sameSite: "lax",
  };
}

export function writeAuthCookies(
  store: CookieSetter,
  cookies: Array<{ name: string; value: string; options: CookieOptions }>,
  https = false,
): void {
  for (const cookie of cookies) {
    store.set(cookie.name, cookie.value, persistCookieOptions(cookie.options, https));
  }
}

export function hasAuthTokenCookie(cookies: Array<{ name: string; value?: string }>): boolean {
  return cookies.some(
    (cookie) =>
      cookie.name.includes("-auth-token") &&
      !cookie.name.includes("code-verifier") &&
      Boolean(cookie.value),
  );
}

export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  maxAge: SESSION_MAX_AGE,
};
