import { describe, expect, it } from "vitest";
import {
  AUTH_COOKIE_OPTIONS,
  hasAuthTokenCookie,
  persistCookieOptions,
  SESSION_MAX_AGE,
  writeAuthCookies,
} from "./auth-cookies";

describe("auth cookies", () => {
  it("keeps a long-lived httpOnly cookie so refresh does not drop the session", () => {
    expect(persistCookieOptions()).toMatchObject({
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      secure: false,
    });
  });

  it("still clears cookies on sign-out", () => {
    expect(persistCookieOptions({ maxAge: 0 }).maxAge).toBe(0);
  });

  it("strips supabase fields Next.js cannot store", () => {
    const written: Array<{ name: string; options: Record<string, unknown> }> = [];
    writeAuthCookies(
      {
        set(name, _value, options) {
          written.push({ name, options: options ?? {} });
        },
      },
      [
        {
          name: "sb-proj-auth-token",
          value: "token",
          options: { ...AUTH_COOKIE_OPTIONS, name: "leaked" } as never,
        },
      ],
    );
    expect(written[0]?.options).not.toHaveProperty("name");
    expect(written[0]?.options.httpOnly).toBe(true);
    expect(written[0]?.options.maxAge).toBe(SESSION_MAX_AGE);
  });

  it("detects a stored supabase session cookie", () => {
    expect(hasAuthTokenCookie([{ name: "sb-proj-auth-token", value: "tok" }])).toBe(true);
    expect(hasAuthTokenCookie([{ name: "sb-proj-auth-token-code-verifier", value: "pkce" }])).toBe(
      false,
    );
  });
});
