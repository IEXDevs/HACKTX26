import { describe, expect, it } from "vitest";
import { descendantsOf, treeContaining } from "./agent-tree";

const row = (id: string, parentAgentId: string | null) => ({ id, parentAgentId });

const rows = [
  row("lead", null),
  row("worker_a", "lead"),
  row("worker_b", "lead"),
  row("grunt", "worker_a"),
  row("other_lead", null),
  row("other_worker", "other_lead"),
  // A standalone worker, like the blue team lead: nothing above it.
  row("blue_team", null),
];

const ids = (list: Array<{ id: string }>) => list.map((r) => r.id).sort();

describe("descendantsOf", () => {
  it("keeps depth-first order even when children appear before their parents", () => {
    const unordered = [row("grandchild", "child"), row("child", "lead"), row("sibling", "lead"), row("other", null)];
    expect(descendantsOf(unordered, "lead").map((agent) => agent.id)).toEqual(["child", "grandchild", "sibling"]);
  });

  it("visits each descendant once and excludes the root in a cycle", () => {
    const loop = [row("a", "b"), row("b", "a"), row("child", "b")];
    expect(descendantsOf(loop, "a").map((agent) => agent.id)).toEqual(["b", "child"]);
  });

  it("handles deep imported trees without recursive calls", () => {
    const deep = Array.from({ length: 20_000 }, (_, index) => row(String(index), index === 0 ? "lead" : String(index - 1)));
    expect(descendantsOf(deep, "lead")).toHaveLength(deep.length);
  });
});

describe("treeContaining", () => {
  it("returns the whole team from any member", () => {
    const team = ["grunt", "lead", "worker_a", "worker_b"];
    expect(ids(treeContaining(rows, "lead"))).toEqual(team);
    expect(ids(treeContaining(rows, "worker_b"))).toEqual(team);
    expect(ids(treeContaining(rows, "grunt"))).toEqual(team);
  });

  it("leaves other teams and standalone agents out", () => {
    const team = ids(treeContaining(rows, "lead"));
    expect(team).not.toContain("other_lead");
    expect(team).not.toContain("blue_team");
  });

  it("returns a standalone agent on its own", () => {
    expect(ids(treeContaining(rows, "blue_team"))).toEqual(["blue_team"]);
  });

  it("keeps an agent whose parent is missing, so the validator can report it", () => {
    const broken = [row("child", "gone"), row("lead", null)];
    expect(ids(treeContaining(broken, "child"))).toEqual(["child"]);
  });

  it("survives a parent loop", () => {
    const loop = [row("a", "b"), row("b", "a")];
    expect(ids(treeContaining(loop, "a")).length).toBeGreaterThan(0);
  });

  it("returns nothing for an unknown id", () => {
    expect(treeContaining(rows, "nope")).toEqual([]);
  });
});
