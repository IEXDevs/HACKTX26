import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY_RULES,
  evaluatePermission,
  minimizeScopes,
} from "../src/protocol/permissions";

describe("permission evaluation", () => {
  it("allows low-risk reads by default", () => {
    const d = evaluatePermission({ resource: "fs.read", scopes: ["read"], risk: "low" });
    expect(d.effect).toBe("allow");
  });

  it("requires approval for shell execution", () => {
    const d = evaluatePermission({
      resource: "shell.exec",
      scopes: ["execute"],
      risk: "high",
    });
    expect(d.effect).toBe("require_approval");
    expect(d.matchedRuleId).toBe("approve-shell");
  });

  it("hard-denies production CLI access regardless of grants", () => {
    const d = evaluatePermission({
      resource: "cli:prod-deploy",
      scopes: ["execute"],
      risk: "high",
      agentGrants: [{ resource: "cli:*", scopes: ["execute"] }],
    });
    expect(d.effect).toBe("deny");
  });

  it("never auto-allows critical risk, even with a grant", () => {
    const d = evaluatePermission({
      resource: "secret.use",
      scopes: ["secret"],
      risk: "critical",
      agentGrants: [{ resource: "secret.use", scopes: ["secret"] }],
    });
    expect(d.effect).toBe("require_approval");
  });

  it("requires per-run approval for a high-risk granted capability", () => {
    const d = evaluatePermission({
      resource: "shell.exec",
      scopes: ["execute"],
      risk: "high",
      agentGrants: [{ resource: "shell.exec", scopes: ["execute"] }],
    });
    expect(d.effect).toBe("require_approval");
  });

  it("honours path-constrained grants", () => {
    const grant = {
      resource: "fs.write",
      scopes: ["write" as const],
      constraints: { paths: ["reports/"] },
    };
    expect(
      evaluatePermission({
        resource: "fs.write",
        scopes: ["write"],
        risk: "medium",
        path: "reports/q3.md",
        agentGrants: [grant],
      }).effect,
    ).toBe("allow");

    const outside = evaluatePermission({
      resource: "fs.write",
      scopes: ["write"],
      risk: "medium",
      path: "src/auth.ts",
      agentGrants: [grant],
    });
    expect(outside.effect).not.toBe("allow");
  });

  it("defaults to approval when nothing matches", () => {
    const d = evaluatePermission(
      { resource: "unknown.tool", scopes: ["read"], risk: "medium" },
      [],
    );
    expect(d.effect).toBe("require_approval");
  });
});

describe("scope minimization", () => {
  it("drops scopes the task does not need", () => {
    const { granted, dropped } = minimizeScopes(
      ["read", "write", "execute", "admin"],
      ["read"],
    );
    expect(granted).toEqual(["read"]);
    expect(dropped).toEqual(["write", "execute", "admin"]);
  });
});
