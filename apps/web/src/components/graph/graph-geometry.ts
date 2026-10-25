/**
 * Pure geometry for the workflow map: tidy tree layout, S-shaped edges, the
 * wobbling rim of a working node, and each model's color. No DOM, no canvas, so
 * it is unit tested on its own.
 */

export interface V2 {
  x: number;
  y: number;
}

export interface LayoutNode {
  id: string;
  parentAgentId: string | null;
  r: number;
  /** Width the caption needs under the node. */
  labelWidth: number;
  /** A required peer sits beside this agent instead of taking a tree level. */
  peerOf?: string;
}

const nodeWidth = (node: LayoutNode) => Math.max(node.r * 2, node.labelWidth);

/** Keep peers horizontal even after a saved layout or a drag moves their lead. */
export function alignPeers(nodes: readonly LayoutNode[], positions: Map<string, V2>, spacing = 1): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rightEdges = new Map<string, number>();
  for (const peer of nodes) {
    const lead = peer.peerOf ? byId.get(peer.peerOf) : undefined;
    const at = lead ? positions.get(lead.id) : undefined;
    if (!lead || !at) continue;
    const left = (rightEdges.get(lead.id) ?? at.x + nodeWidth(lead) / 2) + 64 * spacing;
    positions.set(peer.id, { x: left + nodeWidth(peer) / 2, y: at.y });
    rightEdges.set(lead.id, left + nodeWidth(peer));
  }
}

/** Node size follows its role and how heavy its work is. */
export function nodeRadius(role: string, complexity: string): number {
  let r = role === "orchestrator" || role === "motivator" ? 40 : role === "security" ? 32 : 30;
  if (complexity === "critical") r += 6;
  else if (complexity === "complex" || complexity === "high") r += 3;
  else if (complexity === "trivial" || complexity === "low") r -= 2;
  return r;
}

/** Rough caption width at the canvas label size, for layout before anything is drawn. */
export function estimateLabelWidth(name: string, px = 14): number {
  return Math.ceil(name.length * px * 0.56) + 12;
}

/**
 * Top-down tidy tree. Every subtree gets the width it needs (its own node and
 * caption, or its children side by side), children sit centered under their
 * parent, and siblings never overlap. `spacing` scales every gap.
 */
export function tidyLayout(nodes: readonly LayoutNode[], spacing = 1): Map<string, V2> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const primary = nodes.filter((n) => !n.peerOf || !byId.has(n.peerOf));
  const kids = new Map<string, LayoutNode[]>();
  for (const n of primary) {
    if (!n.parentAgentId || !byId.has(n.parentAgentId) || n.parentAgentId === n.id) continue;
    const list = kids.get(n.parentAgentId) ?? [];
    list.push(n);
    kids.set(n.parentAgentId, list);
  }
  for (const list of kids.values()) list.sort((a, b) => a.id.localeCompare(b.id));

  const gapX = 44 * spacing;
  const maxR = Math.max(30, ...nodes.map((n) => n.r));
  const level = (maxR * 2 + 92) * spacing;

  const own = (n: LayoutNode) => nodeWidth(n) + 2 * nodes.filter((peer) => peer.peerOf === n.id)
    .reduce((width, peer) => width + 64 * spacing + nodeWidth(peer), 0);
  const widths = new Map<string, number>();
  const visiting = new Set<string>();
  const width = (n: LayoutNode): number => {
    const known = widths.get(n.id);
    if (known !== undefined) return known;
    if (visiting.has(n.id)) return own(n); // parent loop: stop here
    visiting.add(n.id);
    const children = kids.get(n.id) ?? [];
    const row = children.reduce((sum, c) => sum + width(c), 0) + gapX * Math.max(0, children.length - 1);
    const w = Math.max(own(n), row);
    visiting.delete(n.id);
    widths.set(n.id, w);
    return w;
  };

  const out = new Map<string, V2>();
  const place = (n: LayoutNode, left: number, depth: number) => {
    if (out.has(n.id)) return;
    const w = width(n);
    const x = left + w / 2;
    out.set(n.id, { x, y: depth * level });
    const children = kids.get(n.id) ?? [];
    const row = children.reduce((sum, c) => sum + width(c), 0) + gapX * Math.max(0, children.length - 1);
    let cursor = x - row / 2;
    for (const c of children) {
      place(c, cursor, depth + 1);
      cursor += width(c) + gapX;
    }
  };

  const roots = primary.filter((n) => !n.parentAgentId || !byId.has(n.parentAgentId));
  let left = 0;
  for (const root of roots) {
    place(root, left, 0);
    left += width(root) + gapX * 2;
  }
  // Anything only reachable through a loop still gets a spot.
  for (const n of primary) {
    if (out.has(n.id)) continue;
    place(n, left, 0);
    left += width(n) + gapX * 2;
  }

  alignPeers(nodes, out, spacing);
  const xs = [...out.values()].map((p) => p.x);
  const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  for (const p of out.values()) p.x -= mid;
  return out;
}

/** Cubic Bézier as four points. */
export type Cubic = [V2, V2, V2, V2];

/** Straight peer link, from one side rim to the other. */
export function sideCurve(a: V2, ra: number, b: V2, rb: number): Cubic {
  const direction = b.x >= a.x ? 1 : -1;
  const start = { x: a.x + ra * direction, y: a.y };
  const end = { x: b.x - rb * direction, y: b.y };
  return [start, { x: start.x + (end.x - start.x) / 3, y: start.y },
    { x: start.x + (end.x - start.x) * 2 / 3, y: end.y }, end];
}

/**
 * An S-shaped edge from the rim of `a` to the rim of `b`. It leaves and enters
 * vertically, so a parent above its child reads as a smooth S.
 */
export function sCurve(a: V2, ra: number, b: V2, rb: number): Cubic {
  const down = b.y >= a.y ? 1 : -1;
  const p0 = { x: a.x, y: a.y + ra * down };
  const p3 = { x: b.x, y: b.y - rb * down };
  const bend = Math.max(36, Math.abs(p3.y - p0.y) * 0.5);
  return [p0, { x: p0.x, y: p0.y + bend * down }, { x: p3.x, y: p3.y - bend * down }, p3];
}

export function bezierPoint([p0, p1, p2, p3]: Cubic, t: number): V2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

export function bezierTangent([p0, p1, p2, p3]: Cubic, t: number): V2 {
  const u = 1 - t;
  const x = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
  const y = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/** Evenly spaced samples along the curve with their left-hand normals. */
export function sampleCurve(curve: Cubic, count: number): Array<{ p: V2; n: V2; t: number }> {
  const out: Array<{ p: V2; n: V2; t: number }> = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const p = bezierPoint(curve, t);
    const d = bezierTangent(curve, t);
    out.push({ p, n: { x: -d.y, y: d.x }, t });
  }
  return out;
}

/**
 * Radius multiplier for a working node's rim at angle `theta` and time `t`.
 * A few soft harmonics drifting at different speeds: scalloped like a badge,
 * but irregular and never sharp. Stays within about ±9%.
 */
export function blobScale(theta: number, t: number, seed: number): number {
  const p = seed * Math.PI * 2;
  return (
    1 +
    0.038 * Math.sin(8 * theta + 1.6 * t + p) +
    0.022 * Math.sin(5 * theta - 1.1 * t + p * 1.7) +
    0.016 * Math.sin(11 * theta + 0.9 * t + p * 0.6) +
    0.014 * Math.sin(3 * theta - 0.5 * t + p * 0.3)
  );
}

/** Stable 0..1 hash, so each node wobbles out of step with the others. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

const MODEL_COLORS: Record<string, string> = {
  "muse-wonder-1.0": "#3346E8",
  "muse-spark-1.3": "#0A7CFF",
  "anthropic/claude-opus-4-6": "#B85A36",
  "anthropic/claude-sonnet-4-6": "#D97757",
  "anthropic/claude-haiku-4-5": "#E0926A",
  "openai/gpt-5.4": "#0E8F6F",
  "openai/gpt-5.4-mini": "#2DB38C",
  "google/gemini-3-pro": "#7A5AF0",
  "selfhost/llama-4-70b": "#56657A",
  "selfhost/qwen-3-coder-32b": "#6F7C90",
};

const PROVIDER_COLORS: Record<string, string> = {
  meta: "#0A7CFF",
  anthropic: "#D97757",
  openai: "#0E8F6F",
  google: "#7A5AF0",
  selfhost: "#56657A",
};

/** Each model gets its own color; models from one provider share a family. */
export function modelColor(modelId: string | null, provider: string): string {
  return (modelId && MODEL_COLORS[modelId]) || PROVIDER_COLORS[provider] || "#6B786F";
}

/** A newly spawned child starts on its parent, then eases out to its seat. */
export function spawnOrigin(parent: V2 | undefined, target: V2): V2 {
  return parent ? { x: parent.x, y: parent.y } : { x: target.x, y: target.y };
}

/** 0 at birth, 1 after `durationMs`. Ease-out cubic so the pop settles quickly. */
export function spawnScale(ageMs: number, durationMs = 700): number {
  const t = Math.min(1, Math.max(0, ageMs / durationMs));
  return 1 - (1 - t) ** 3;
}

/** Blend a hex color toward grey. `amount` 0 keeps it, 1 is fully grey. */
export function greyed(hex: string, amount: number, grey = 128): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (grey - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
