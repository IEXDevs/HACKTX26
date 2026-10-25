import { describe, expect, it } from "vitest";
import { canonicalizeLoopbackHost } from "./supabase";

describe("canonicalizeLoopbackHost", () => {
  it("maps loopback hosts to localhost so OAuth apps still match", () => {
    expect(canonicalizeLoopbackHost("127.0.0.1:3000")).toBe("localhost:3000");
    expect(canonicalizeLoopbackHost("0.0.0.0:3000")).toBe("localhost:3000");
    expect(canonicalizeLoopbackHost("[::1]:3000")).toBe("localhost:3000");
    expect(canonicalizeLoopbackHost("localhost:3000")).toBe("localhost:3000");
    expect(canonicalizeLoopbackHost("astronom.tech")).toBe("astronom.tech");
  });
});
