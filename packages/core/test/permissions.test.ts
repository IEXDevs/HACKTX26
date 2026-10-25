import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACTION_EFFECTS,
  DEFAULT_POLICY_RULES,
  evaluatePermission,
  minimizeScopes,
  resolveActionEffects,
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

  it("keeps a grant's path and host limits even where the workspace allows the action", () => {
    const effects = resolveActionEffects({});
    const agentGrants = [
      { resource: "fs.write", scopes: ["write" as const], constraints: { paths: ["reports/"] } },
      { resource: "http.fetch", scopes: ["net" as const, "read" as const], constraints: { hosts: ["api.example.com"] } },
    ];
    const write = (path: string) =>
      evaluatePermission({ resource: "fs.write", scopes: ["write"], risk: "medium", path, agentGrants }, DEFAULT_POLICY_RULES, effects);
    expect(write("reports/q3.md").effect).toBe("allow_with_log");
    expect(write("src/auth.ts")).toMatchObject({ effect: "deny" });
    const fetch = (host: string) =>
      evaluatePermission(
        { resource: "http.fetch", scopes: ["net", "read"], risk: "medium", host, agentGrants },
        DEFAULT_POLICY_RULES,
        effects,
      );
    expect(fetch("api.example.com").effect).toBe("allow_with_log");
    expect(fetch("evil.example.net").effect).toBe("deny");
    // No grant for the action at all: the workspace setting decides, as before.
    expect(
      evaluatePermission({ resource: "fs.read", scopes: ["read"], risk: "low", path: "src/a.ts", agentGrants }, DEFAULT_POLICY_RULES, effects)
        .effect,
    ).toBe("allow");
  });

  it("defaults to approval when nothing matches", () => {
    const d = evaluatePermission(
      { resource: "unknown.tool", scopes: ["read"], risk: "medium" },
      [],
    );
    expect(d.effect).toBe("require_approval");
  });

  it("lets workspace policy override the production freeze", () => {
    const d = evaluatePermission(
      { resource: "cli:prod-deploy", scopes: ["execute"], risk: "high" },
      DEFAULT_POLICY_RULES,
      { "cli:prod-deploy": "allow" },
    );
    expect(d.effect).toBe("allow");
    expect(d.matchedRuleId).toBe("workspace:cli:prod-deploy");
  });

  it("applies the six named workspace defaults when none are stored", () => {
    const effects = resolveActionEffects({});
    expect(effects).toEqual(DEFAULT_ACTION_EFFECTS);
    expect(
      evaluatePermission(
        { resource: "fs.read", scopes: ["read"], risk: "low" },
        DEFAULT_POLICY_RULES,
        effects,
      ).effect,
    ).toBe("allow");
    expect(
      evaluatePermission(
        { resource: "fs.write", scopes: ["write"], risk: "medium" },
        DEFAULT_POLICY_RULES,
        effects,
      ).effect,
    ).toBe("allow_with_log");
    expect(
      evaluatePermission(
        { resource: "http.fetch", scopes: ["net", "read"], risk: "medium" },
        DEFAULT_POLICY_RULES,
        effects,
      ).effect,
    ).toBe("allow_with_log");
    expect(
      evaluatePermission(
        { resource: "shell.exec", scopes: ["execute"], risk: "high" },
        DEFAULT_POLICY_RULES,
        effects,
      ).effect,
    ).toBe("require_approval");
    expect(
      evaluatePermission(
        { resource: "secret.use", scopes: ["secret"], risk: "critical" },
        DEFAULT_POLICY_RULES,
        effects,
      ).effect,
    ).toBe("require_approval");
    expect(
      evaluatePermission(
        { resource: "cli:prod-deploy", scopes: ["execute"], risk: "high" },
        DEFAULT_POLICY_RULES,
        effects,
      ).effect,
    ).toBe("deny");
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
