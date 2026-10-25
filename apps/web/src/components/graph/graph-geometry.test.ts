import { describe, expect, it } from "vitest";
import {
  alignPeers,
  bezierPoint,
  blobScale,
  greyed,
  modelColor,
  sCurve,
  sideCurve,
  spawnOrigin,
  spawnScale,
  tidyLayout,
  type LayoutNode,
} from "./graph-geometry";

const node = (id: string, parentAgentId: string | null, r = 30, labelWidth = 90): LayoutNode => ({
  id,
  parentAgentId,
  r,
  labelWidth,
});

const team = [
  node("lead", null, 40),
  node("a", "lead"),
  node("b", "lead", 30, 220),
  node("c", "lead"),
  node("a1", "a"),
  node("a2", "a"),
];

describe("tidyLayout", () => {
  it("puts children below their parent", () => {
    const pos = tidyLayout(team);
    for (const n of team) {
      if (!n.parentAgentId) continue;
      expect(pos.get(n.id)!.y).toBeGreaterThan(pos.get(n.parentAgentId)!.y);
    }
  });

  it("never lets two nodes or their captions overlap on a row", () => {
    const pos = tidyLayout(team);
    const byRow = new Map<number, LayoutNode[]>();
    for (const n of team) {
      const y = pos.get(n.id)!.y;
      byRow.set(y, [...(byRow.get(y) ?? []), n]);
    }
    for (const row of byRow.values()) {
      const sorted = [...row].sort((p, q) => pos.get(p.id)!.x - pos.get(q.id)!.x);
      for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1]!;
        const next = sorted[i]!;
        const need = Math.max(prev.r * 2, prev.labelWidth) / 2 + Math.max(next.r * 2, next.labelWidth) / 2;
        expect(pos.get(next.id)!.x - pos.get(prev.id)!.x).toBeGreaterThanOrEqual(need);
      }
    }
  });

  it("centers a parent over its children", () => {
    const pos = tidyLayout(team);
    expect(pos.get("a")!.x).toBeCloseTo((pos.get("a1")!.x + pos.get("a2")!.x) / 2);
  });

  it("spreads further apart as spacing grows", () => {
    const tight = tidyLayout(team, 0.8);
    const roomy = tidyLayout(team, 1.6);
    const span = (m: Map<string, { x: number; y: number }>) => m.get("c")!.x - m.get("a")!.x;
    expect(span(roomy)).toBeGreaterThan(span(tight));
    expect(roomy.get("a")!.y).toBeGreaterThan(tight.get("a")!.y);
  });

  it("places every node even with a missing parent or a loop", () => {
    const odd = [node("x", "missing"), node("p", "q"), node("q", "p")];
    const pos = tidyLayout(odd);
    expect([...pos.keys()].sort()).toEqual(["p", "q", "x"]);
  });
});

describe("sCurve", () => {
  it("runs from the bottom of the parent to the top of the child", () => {
    const curve = sCurve({ x: 0, y: 0 }, 40, { x: 120, y: 200 }, 30);
    expect(bezierPoint(curve, 0)).toEqual({ x: 0, y: 40 });
    expect(bezierPoint(curve, 1)).toEqual({ x: 120, y: 170 });
  });

  it("leaves and enters vertically", () => {
    const [p0, p1, p2, p3] = sCurve({ x: 0, y: 0 }, 40, { x: 120, y: 200 }, 30);
    expect(p1.x).toBe(p0.x);
    expect(p2.x).toBe(p3.x);
  });
});

describe("motivator peer geometry", () => {
  const peers = [...team, { ...node("motivator", null, 40, 100), peerOf: "lead" }];

  it("places the motivator beside the top agent and reserves room in the forest", () => {
    const nodes = [...peers, node("other", null, 40, 180)];
    const pos = tidyLayout(nodes);
    expect(pos.get("motivator")!.y).toBe(pos.get("lead")!.y);
    expect(pos.get("motivator")!.x).toBeGreaterThan(pos.get("lead")!.x + 100);
    expect(pos.get("other")!.x - pos.get("motivator")!.x).toBeGreaterThan(140);
    const tree = tidyLayout(team);
    expect(pos.get("a")!.x - pos.get("lead")!.x).toBeCloseTo(tree.get("a")!.x - tree.get("lead")!.x);
  });

  it("keeps a peer horizontal after old saved positions or dragging move the lead", () => {
    const pos = tidyLayout(peers);
    const gap = pos.get("motivator")!.x - pos.get("lead")!.x;
    pos.set("lead", { x: 300, y: 250 });
    pos.set("motivator", { x: -100, y: 900 });
    alignPeers(peers, pos);
    expect(pos.get("motivator")).toEqual({ x: 300 + gap, y: 250 });
  });

  it.each([1, -1])("connects side rims with a straight horizontal line in direction %s", (direction) => {
    const curve = sideCurve({ x: 0, y: 20 }, 40, { x: 240 * direction, y: 20 }, 30);
    expect(curve[0]).toEqual({ x: 40 * direction, y: 20 });
    expect(curve[3]).toEqual({ x: 210 * direction, y: 20 });
    expect(curve.every((point) => point.y === 20)).toBe(true);
  });
});

describe("node visuals", () => {
  it("keeps the working rim soft: within about ten percent of a circle", () => {
    for (let i = 0; i < 360; i += 7) {
      const s = blobScale((i * Math.PI) / 180, i / 13, 0.37);
      expect(s).toBeGreaterThan(0.9);
      expect(s).toBeLessThan(1.1);
    }
  });

  it("gives each model its own color, with a provider fallback", () => {
    expect(modelColor("muse-spark-1.3", "meta")).not.toBe(modelColor("muse-wonder-1.0", "meta"));
    expect(modelColor("unknown-model", "anthropic")).toBe(modelColor(null, "anthropic"));
    expect(modelColor(null, "nobody")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("greys a color toward neutral", () => {
    expect(greyed("#ff0000", 0)).toBe("#ff0000");
    expect(greyed("#ff0000", 1)).toBe("#808080");
  });
});

describe("subagent spawn", () => {
  it("starts a child on its parent, then grows to full size", () => {
    const parent = { x: 10, y: 20 };
    const seat = { x: 80, y: 140 };
    expect(spawnOrigin(parent, seat)).toEqual(parent);
    expect(spawnOrigin(undefined, seat)).toEqual(seat);
    expect(spawnScale(0)).toBe(0);
    expect(spawnScale(700)).toBe(1);
    expect(spawnScale(350)).toBeGreaterThan(0.7);
    expect(spawnScale(350)).toBeLessThan(1);
  });

  it("opens a seat for a new sibling without overlapping captions", () => {
    const before = tidyLayout(team);
    const grown = tidyLayout([...team, node("a3", "a", 30, 160)]);
    expect(grown.get("a3")!.y).toBe(grown.get("a1")!.y);
    expect(Math.abs(grown.get("a3")!.x - grown.get("a1")!.x)).toBeGreaterThan(80);
    // Existing children shift aside so the new one fits on the same row.
    expect(grown.get("a2")!.x).not.toBe(before.get("a2")!.x);
  });
});
