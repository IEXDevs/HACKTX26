/**
 * A parent can never give a child more than it has. When a parent hands
 * access down to a grunt it creates or reuses, it goes through here, so the
 * child ends up with at most the parent's tools, each within the parent's
 * path, host, and command limits.
 *
 * Tools that come from an agent's role rather than from a parent are left
 * alone: delegation follows rank, findings follow the red team, and case
 * tools follow the blue team. The engine checks those separately.
 */
import { coveringGrant, TOOL_BY_NAME, type PermissionGrant, type Risk, type Scope } from "@agent-os/core";
import { CASE_TOOL_BY_NAME } from "@/lib/loop/case-tools";

type Holder = { allowedTools: readonly string[]; grants: readonly PermissionGrant[] };
type Parent = Holder & { id: string; name: string };

/** How a tool is described: built-in by default; a run also knows its workspace's outside actions. */
export type ToolLookup = (tool: string) => { name: string; scopes: readonly string[]; risk: Risk } | undefined;
const builtIn: ToolLookup = (tool) => TOOL_BY_NAME.get(tool);

/** Tools given by role, never by a parent. */
export function isRoleTool(tool: string): boolean {
  return tool === "agent.delegate" || tool === "security.report" || CASE_TOOL_BY_NAME.has(tool);
}

/** The grants among `grants` that apply to `tool` at all, whatever their limits. */
function grantsForTool(grants: readonly PermissionGrant[], tool: string, lookup: ToolLookup): PermissionGrant[] {
  const entry = lookup(tool);
  if (!entry) return [];
  return grants.filter((grant) =>
    coveringGrant({ resource: entry.name, scopes: entry.scopes as Scope[], risk: entry.risk, agentGrants: [grant] }),
  );
}

/**
 * A child's grants for `tools`, cut from its parent's: each keeps the
 * parent's limits. A tool the parent holds without a grant gives the child
 * none either; workspace policy then decides for both alike.
 */
export function grantsFromParent(
  parent: Parent,
  tools: readonly string[],
  lookup: ToolLookup = builtIn,
): PermissionGrant[] {
  return tools.flatMap((tool) => {
    const entry = lookup(tool);
    if (!entry) return [];
    return grantsForTool(parent.grants, tool, lookup).map((grant) => ({
      resource: entry.name,
      scopes: [...entry.scopes] as Scope[],
      ...(grant.constraints ? { constraints: grant.constraints } : {}),
      grantedBy: `agent:${parent.id}`,
      note: `Cut from ${parent.name}'s grant.`,
    }));
  });
}

/** Path prefixes inside both lists: for each pair that overlaps, the narrower one. */
function overlapPaths(a: readonly string[], b: readonly string[]): string[] {
  const out = new Set<string>();
  for (const x of a) for (const y of b) {
    if (x.startsWith(y)) out.add(x);
    else if (y.startsWith(x)) out.add(y);
  }
  return [...out];
}

function overlapExact(a: readonly string[], b: readonly string[]): string[] {
  return a.filter((x) => b.includes(x));
}

/**
 * What both grants allow, or null if they share nothing. A limit set on
 * either side holds; where both set one, only the overlap remains.
 */
export function intersectGrant(child: PermissionGrant, parent: PermissionGrant): PermissionGrant | null {
  const scopes = child.scopes.filter((scope) => parent.scopes.includes(scope));
  if (scopes.length === 0) return null;
  const c = child.constraints ?? {};
  const p = parent.constraints ?? {};
  const limit = (
    mine: readonly string[] | undefined,
    theirs: readonly string[] | undefined,
    overlap: (a: readonly string[], b: readonly string[]) => string[],
  ): string[] | undefined | null => {
    if (!mine && !theirs) return undefined;
    if (!mine) return [...theirs!];
    if (!theirs) return [...mine];
    const both = overlap(mine, theirs);
    return both.length ? both : null;
  };
  const paths = limit(c.paths, p.paths, overlapPaths);
  const hosts = limit(c.hosts, p.hosts, overlapExact);
  const commands = limit(c.commands, p.commands, overlapExact);
  if (paths === null || hosts === null || commands === null) return null;
  const constraints = {
    ...(paths ? { paths } : {}),
    ...(hosts ? { hosts } : {}),
    ...(commands ? { commands } : {}),
  };
  const { constraints: _own, ...rest } = child;
  return { ...rest, scopes, ...(Object.keys(constraints).length ? { constraints } : {}) };
}

/**
 * Narrow a child to what its parent has. It keeps a tool only if the parent
 * holds it too, and its grants for that tool only within the parent's limits.
 * Where the parent holds a tool without a grant, the child keeps the tool but
 * no grant, so workspace policy treats both the same. Where the parent's
 * limits and the child's share nothing, the child loses the tool.
 */
export function clampToParent(
  child: Holder,
  parent: Parent,
  lookup: ToolLookup = builtIn,
): { allowedTools: string[]; grants: PermissionGrant[] } {
  const parentHolds = new Set(parent.allowedTools);
  const allowedTools: string[] = [];
  const grants: PermissionGrant[] = [];
  for (const tool of new Set(child.allowedTools)) {
    if (isRoleTool(tool)) {
      allowedTools.push(tool);
      grants.push(...grantsForTool(child.grants, tool, lookup));
      continue;
    }
    if (!parentHolds.has(tool)) continue;
    const theirs = grantsForTool(parent.grants, tool, lookup);
    if (theirs.length === 0) {
      allowedTools.push(tool);
      continue;
    }
    const own = grantsForTool(child.grants, tool, lookup);
    const kept = own.length
      ? own.flatMap((mine) => theirs.flatMap((t) => intersectGrant(mine, t) ?? []))
      : grantsFromParent(parent, [tool], lookup);
    if (kept.length === 0) continue;
    allowedTools.push(tool);
    grants.push(...kept);
  }
  // Grants for tools it does not hold carry nothing; they are dropped with the rest.
  return { allowedTools, grants: dedupe(grants) };
}

function dedupe(grants: PermissionGrant[]): PermissionGrant[] {
  const seen = new Set<string>();
  return grants.filter((grant) => {
    const key = JSON.stringify([grant.resource, grant.scopes, grant.constraints ?? null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
