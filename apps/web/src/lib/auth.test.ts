import { describe, expect, it } from "vitest";
import { DEMO_LOGIN, emailFromLogin } from "./auth-identity";

describe("password login identity", () => {
  it("maps a username to a local email so Supabase never needs a mailbox", () => {
    expect(emailFromLogin("testuser")).toBe("testuser@astronom.local");
    expect(emailFromLogin(" TestUser ")).toBe("testuser@astronom.local");
  });

  it("passes through a real email", () => {
    expect(emailFromLogin("maya@astronom.dev")).toBe("maya@astronom.dev");
  });

  it("keeps the demo account available after the login card stops showing it", () => {
    expect(DEMO_LOGIN).toMatchObject({ username: "testuser", password: "astronomtest" });
  });
});
