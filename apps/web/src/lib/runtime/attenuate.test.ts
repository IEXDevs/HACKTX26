import { describe, expect, it } from "vitest";
import type { PermissionGrant } from "@agent-os/core";
import { clampToParent, grantsFromParent, intersectGrant } from "./attenuate";

const write = (paths?: string[]): PermissionGrant => ({
  resource: "fs.write",
  scopes: ["write"],
  ...(paths ? { constraints: { paths } } : {}),
});
const fetch = (hosts?: string[]): PermissionGrant => ({
  resource: "http.fetch",
  scopes: ["net", "read"],
  ...(hosts ? { constraints: { hosts } } : {}),
});
const parent = (allowedTools: string[], grants: PermissionGrant[]) => ({ id: "agt_p", name: "Parent", allowedTools, grants });

describe("intersecting two grants", () => {
  it("keeps only what both allow", () => {
    expect(intersectGrant(write(), write(["services/"]))?.constraints).toEqual({ paths: ["services/"] });
    expect(intersectGrant(write(["services/api/"]), write(["services/"]))?.constraints).toEqual({ paths: ["services/api/"] });
    expect(intersectGrant(write(["services/"]), write(["services/api/"]))?.constraints).toEqual({ paths: ["services/api/"] });
    expect(intersectGrant(write(["docs/"]), write(["services/"]))).toBeNull();
    expect(intersectGrant(fetch(["a.com", "b.com"]), fetch(["b.com"]))?.constraints).toEqual({ hosts: ["b.com"] });
    expect(intersectGrant(fetch(["a.com"]), fetch(["b.com"]))).toBeNull();
    expect(intersectGrant(write(), write())?.constraints).toBeUndefined();
  });
});

describe("clamping a child to its parent", () => {
  it("drops tools the parent does not hold, and keeps role tools", () => {
    const child = {
      allowedTools: ["fs.read", "fs.write", "http.fetch", "shell.exec", "agent.delegate", "security.report", "case.read"],
      grants: [write(), fetch()],
    };
    const out = clampToParent(child, parent(["fs.read", "fs.write"], []));
    expect(out.allowedTools.sort()).toEqual(["agent.delegate", "case.read", "fs.read", "fs.write", "security.report"]);
    // The parent holds fs.write on workspace policy alone, so the child does too: no grant that could allow more.
    expect(out.grants).toEqual([]);
  });

  it("holds the child's grants to the parent's limits, and drops a tool whose limits share nothing", () => {
    const narrowed = clampToParent(
      { allowedTools: ["fs.write", "http.fetch"], grants: [write(), fetch(["evil.example"])] },
      parent(["fs.write", "http.fetch"], [write(["services/"]), fetch(["api.example"])]),
    );
    expect(narrowed.allowedTools).toEqual(["fs.write"]);
    expect(narrowed.grants).toEqual([{ ...write(["services/"]) }]);
  });

  it("gives a child with no grant of its own the parent's limits", () => {
    const out = clampToParent({ allowedTools: ["fs.write"], grants: [] }, parent(["fs.write"], [write(["services/"])]));
    expect(out.grants.map((g) => g.constraints)).toEqual([{ paths: ["services/"] }]);
  });
});

describe("a new grunt's grants", () => {
  it("keep the parent's limits, and give none where the parent holds the tool without a grant", () => {
    const grants = grantsFromParent(parent(["fs.read", "fs.write"], [write(["services/"])]), ["fs.read", "fs.write"]);
    expect(grants).toEqual([
      {
        resource: "fs.write",
        scopes: ["write"],
        constraints: { paths: ["services/"] },
        grantedBy: "agent:agt_p",
        note: "Cut from Parent's grant.",
      },
    ]);
  });
});
