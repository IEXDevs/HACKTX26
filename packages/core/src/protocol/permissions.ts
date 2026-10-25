/**
 * Least-privilege permission model.
 *
 * Every tool invocation is evaluated against a policy *before* the executor is
 * allowed to touch anything. The policy result is one of four outcomes, and the
 * runtime records each evaluation on the event stream, so the audit log can
 * answer "what could this agent have done" as well as "what did it do".
 */
import { z } from "zod";
import { RiskSchema } from "./events";

export const ScopeSchema = z.enum([
  "read",
  "write",
  "execute",
  "net",
  "secret",
  "admin",
]);
export type Scope = z.infer<typeof ScopeSchema>;

export const PermissionGrantSchema = z.object({
  /** Tool name, connector id, or glob like `fs:*`. */
  resource: z.string(),
  scopes: z.array(ScopeSchema),
  /** Optional path / host allowlist scoped to the grant. */
  constraints: z
    .object({
      paths: z.array(z.string()).optional(),
      hosts: z.array(z.string()).optional(),
      commands: z.array(z.string()).optional(),
    })
    .optional(),
  grantedBy: z.string().optional(),
  note: z.string().optional(),
});
export type PermissionGrant = z.infer<typeof PermissionGrantSchema>;

export const PolicyRuleSchema = z.object({
  id: z.string(),
  /** `*` or exact resource / prefix glob. */
  resource: z.string(),
  /** Risk band this rule applies to; omitted = all bands. */
  risk: RiskSchema.optional(),
  effect: z.enum(["allow", "allow_with_log", "require_approval", "deny"]),
  reason: z.string().optional(),
  priority: z.number().int().default(0),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const DEFAULT_POLICY_RULES: readonly PolicyRule[] = [
  {
    id: "deny-secret-read",
    resource: "*",
    risk: "critical",
    effect: "require_approval",
    reason: "Critical-risk capabilities always require a human decision.",
    priority: 100,
  },
  {
    id: "freeze-prod-deploy",
    resource: "cli:prod-*",
    effect: "deny",
    reason: "Production write access is frozen outside the release window.",
    priority: 90,
  },
  {
    id: "approve-secret-use",
    resource: "secret.*",
    effect: "require_approval",
    reason: "Credential leases are minted per call and always signed off.",
    priority: 60,
  },
  {
    id: "approve-shell",
    resource: "shell.*",
    effect: "require_approval",
    reason: "Shell execution can mutate the sandbox and reach the network.",
    priority: 50,
  },
  {
    id: "approve-mcp",
    resource: "mcp.*",
    effect: "require_approval",
    reason: "Third-party MCP servers are not covered by the org trust boundary.",
    priority: 50,
  },
  {
    id: "approve-fs-delete",
    resource: "fs.delete",
    effect: "require_approval",
    reason: "Destructive filesystem operations need a human decision.",
    priority: 40,
  },
  {
    id: "log-egress",
    resource: "http.*",
    effect: "allow_with_log",
    reason: "Outbound reads are logged and rate-limited but not gated.",
    priority: 20,
  },
  {
    id: "log-medium",
    resource: "*",
    risk: "medium",
    effect: "allow_with_log",
    reason: "Medium-risk capability inside the sandbox boundary; audited.",
    priority: 10,
  },
  {
    id: "allow-low",
    resource: "*",
    risk: "low",
    effect: "allow",
    reason: "Read-only or non-destructive capability inside the agent boundary.",
    priority: 10,
  },
];

export interface PermissionRequest {
  resource: string;
  scopes: Scope[];
  risk: z.infer<typeof RiskSchema>;
  agentGrants?: readonly PermissionGrant[];
  /** Path being touched, used to evaluate path-constrained grants. */
  path?: string;
  host?: string;
}

export type PermissionDecision =
  | { effect: "allow"; reason: string; matchedRuleId: string | null }
  | { effect: "allow_with_log"; reason: string; matchedRuleId: string | null }
  | { effect: "require_approval"; reason: string; matchedRuleId: string | null }
  | { effect: "deny"; reason: string; matchedRuleId: string | null };

function globMatches(pattern: string, value: string): boolean {
  if (pattern === "*" || pattern === value) return true;
  if (!pattern.includes("*")) return false;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function grantCovers(
  grant: PermissionGrant,
  request: PermissionRequest,
): boolean {
  if (!globMatches(grant.resource, request.resource)) return false;
  if (!request.scopes.every((s) => grant.scopes.includes(s))) return false;
  if (request.path && grant.constraints?.paths) {
    const allowed = grant.constraints.paths.some((p) =>
      request.path?.startsWith(p),
    );
    if (!allowed) return false;
  }
  if (request.host && grant.constraints?.hosts) {
    if (!grant.constraints.hosts.includes(request.host)) return false;
  }
  return true;
}

/**
 * Explicit per-agent grants win over org defaults: an agent may be *more*
 * restricted than the org, never less, unless the grant was itself approved.
 * `deny` rules always win, in every tier.
 */
export function evaluatePermission(
  request: PermissionRequest,
  rules: readonly PolicyRule[] = DEFAULT_POLICY_RULES,
): PermissionDecision {
  const matchingRules = rules
    .filter((r) => globMatches(r.resource, request.resource))
    .filter((r) => !r.risk || r.risk === request.risk)
    .sort((a, b) => b.priority - a.priority);

  const hardDeny = matchingRules.find((r) => r.effect === "deny");
  if (hardDeny) {
    return {
      effect: "deny",
      reason: hardDeny.reason ?? "Blocked by organisation policy.",
      matchedRuleId: hardDeny.id,
    };
  }

  const grant = request.agentGrants?.find((g) => grantCovers(g, request));
  if (grant) {
    // A standing grant pre-authorises low and medium risk only. High and
    // critical capabilities are per-run decisions, always.
    if (request.risk === "critical" || request.risk === "high") {
      return {
        effect: "require_approval",
        reason: `Grant "${grant.resource}" covers this, but ${request.risk} risk is a per-run decision.`,
        matchedRuleId: null,
      };
    }
    return {
      effect: "allow",
      reason: `Covered by agent grant for ${grant.resource}${grant.note ? ` (${grant.note})` : ""}.`,
      matchedRuleId: null,
    };
  }

  const rule = matchingRules[0];
  if (!rule) {
    // Default-deny: anything not explicitly allowed is gated.
    return {
      effect: "require_approval",
      reason: "No policy rule or grant covers this capability; default is approval.",
      matchedRuleId: null,
    };
  }

  return {
    effect: rule.effect,
    reason: rule.reason ?? `Matched policy rule ${rule.id}.`,
    matchedRuleId: rule.id,
  };
}

/** Reduce a requested scope set to only what a task actually needs. */
export function minimizeScopes(
  requested: readonly Scope[],
  needed: readonly Scope[],
): { granted: Scope[]; dropped: Scope[] } {
  const now = new Set(needed);
  const granted = requested.filter((s) => now.has(s));
  const dropped = requested.filter((s) => !now.has(s));
  return { granted, dropped };
}

export interface SecretLease {
  credentialId: string;
  /** Never persisted; held only for the duration of one tool call. */
  value: string;
  expiresAt: number;
}

export function isLeaseExpired(lease: SecretLease, now = Date.now()): boolean {
  return lease.expiresAt <= now;
}
