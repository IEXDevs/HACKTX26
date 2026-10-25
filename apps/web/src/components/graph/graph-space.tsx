"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Boxes, Crown, Maximize, ShieldHalf, Terminal, X } from "@/components/icons";
import { Button, Divider, KeyValue, StatusBadge, Tag } from "@/components/ui/primitives";
import { duration, initials, relativeTime, tokens, usd } from "@/lib/format";
import type { GraphAgent, GraphFlow, GraphSnapshot, GraphTask } from "@/lib/graph-data";
import { DotGrid, type DotGridHandle } from "./dot-grid";
import {
  blobScale,
  estimateLabelWidth,
  greyed,
  hash01,
  modelColor,
  nodeRadius,
  sampleCurve,
  sCurve,
  tidyLayout,
  type Cubic,
  type V2,
} from "./graph-geometry";
import { drawModelMark } from "./model-marks";

export type { GraphAgent, GraphFlow, GraphTask };

/* ------------------------------------------------------------------ */
/* theme                                                               */
/* ------------------------------------------------------------------ */

const LIGHT = {
  ink: "#14231a",
  ink4: "#6b786f",
  danger: "#b2361f",
  tip: "rgba(255,255,255,0.96)",
  tipLine: "#c4cfc7",
  dotBase: "#c9d4cc",
  dotActive: "#2f7a4d",
};
const DARK: typeof LIGHT = {
  ink: "#eef1ef",
  ink4: "#7c8781",
  danger: "#ff6b5b",
  tip: "rgba(21,25,23,0.96)",
  tipLine: "#343c38",
  dotBase: "#2a322e",
  dotActive: "#9be8bd",
};
function themeNow(): typeof LIGHT {
  return document.documentElement.dataset.theme === "dark" ? DARK : LIGHT;
}

/* ------------------------------------------------------------------ */
/* status, read visually                                               */
/* ------------------------------------------------------------------ */

function runStatus(agent: GraphAgent): string {
  return agent.lastRun?.status ?? agent.status;
}
/** Thinking or working: the rim wobbles. */
function isBusy(agent: GraphAgent): boolean {
  const s = runStatus(agent);
  return s === "running" || s === "thinking" || s === "working";
}
/** Paused, queued, or waiting on a person: the node turns grey. */
function isWaiting(agent: GraphAgent): boolean {
  const s = runStatus(agent);
  return agent.status === "paused" || s === "paused" || s === "queued" || s === "awaiting_approval" || s === "blocked";
}
function isFailed(agent: GraphAgent): boolean {
  const s = runStatus(agent);
  return s === "failed" || s === "halted" || s === "cancelled";
}
function isDone(agent: GraphAgent): boolean {
  const s = runStatus(agent);
  return s === "succeeded" || s === "done";
}

interface Laid extends GraphAgent {
  r: number;
  color: string;
  busy: boolean;
  waiting: boolean;
  failed: boolean;
  seed: number;
  labelWidth: number;
}

interface Edge {
  from: string;
  to: string;
  /** Work handed down from `from` to `to`. */
  down: boolean;
  /** A report coming back up from `to` to `from`. */
  up: boolean;
}

/** Parent-child links plus any other agents that actually talked. */
function edgesFor(agents: Laid[], flows: GraphFlow[]): Edge[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const out: Edge[] = [];
  const seen = new Set<string>();
  for (const child of agents) {
    const parent = child.parentAgentId ? byId.get(child.parentAgentId) : undefined;
    if (!parent) continue;
    seen.add(`${parent.id}|${child.id}`);
    out.push({
      from: parent.id,
      to: child.id,
      down: child.busy,
      up: parent.busy && isDone(child),
    });
  }
  for (const flow of flows) {
    if (flow.kind !== "info") continue;
    const a = byId.get(flow.fromId);
    const b = byId.get(flow.toId);
    if (!a || !b) continue;
    if (seen.has(`${a.id}|${b.id}`) || seen.has(`${b.id}|${a.id}`)) continue;
    seen.add(`${a.id}|${b.id}`);
    out.push({ from: a.id, to: b.id, down: b.busy, up: a.busy && isDone(b) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* saved layout                                                        */
/* ------------------------------------------------------------------ */

interface SavedLayout {
  spacing: number;
  positions: Record<string, V2>;
}
const DEFAULT_SPACING = 1;
const storageKey = (workflowId?: string) => `astronom.graph.${workflowId ?? "all"}`;
function loadLayout(workflowId?: string): SavedLayout | null {
  try {
    const raw = window.localStorage.getItem(storageKey(workflowId));
    return raw ? (JSON.parse(raw) as SavedLayout) : null;
  } catch {
    return null;
  }
}
function saveLayout(workflowId: string | undefined, layout: SavedLayout) {
  try {
    window.localStorage.setItem(storageKey(workflowId), JSON.stringify(layout));
  } catch {
    /* private window or storage off: the layout just won't survive a reload */
  }
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

// Stable default: a fresh `[]` per render would retrigger the prop-sync effect below forever.
const NO_FLOWS: GraphFlow[] = [];

export function GraphSpace({
  agents: initialAgents,
  tasks: initialTasks,
  workflowId,
  flows: initialFlows = NO_FLOWS,
}: {
  agents: GraphAgent[];
  tasks: GraphTask[];
  workflowId?: string;
  flows?: GraphFlow[];
}) {
  const [agents, setAgents] = useState(initialAgents);
  const [tasks, setTasks] = useState(initialTasks);
  const [flows, setFlows] = useState(initialFlows);
  useEffect(() => {
    setAgents(initialAgents);
    setTasks(initialTasks);
    setFlows(initialFlows);
  }, [initialAgents, initialTasks, initialFlows]);
  useEffect(() => {
    if (!workflowId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch(`/api/workflows/${workflowId}/graph`);
        if (!response.ok) return;
        const snapshot = (await response.json()) as GraphSnapshot;
        if (cancelled) return;
        setAgents(snapshot.agents);
        setTasks(snapshot.tasks);
        setFlows(snapshot.flows);
      } catch {
        /* keep the last good frame */
      }
    };
    const timer = setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [workflowId]);

  const laid = useMemo<Laid[]>(
    () =>
      agents.map((a) => ({
        ...a,
        r: nodeRadius(a.role, a.complexity),
        color: modelColor(a.modelId, a.provider),
        busy: isBusy(a),
        waiting: isWaiting(a),
        failed: isFailed(a),
        seed: hash01(a.id),
        labelWidth: estimateLabelWidth(a.name),
      })),
    [agents],
  );
  const edges = useMemo(() => edgesFor(laid, flows), [laid, flows]);

  /* --------- layout: automatic, with per-node overrides --------- */
  // No control for spacing any more. A spacing saved in this browser earlier still applies.
  const [spacing, setSpacing] = useState(DEFAULT_SPACING);
  const overridesRef = useRef<Map<string, V2>>(new Map());
  const [layoutVersion, setLayoutVersion] = useState(0);
  useEffect(() => {
    const saved = loadLayout(workflowId);
    if (!saved) return;
    if (typeof saved.spacing === "number") setSpacing(saved.spacing);
    overridesRef.current = new Map(Object.entries(saved.positions ?? {}));
    setLayoutVersion((v) => v + 1);
  }, [workflowId]);
  const persist = useCallback(
    (next: Partial<SavedLayout> = {}) => {
      saveLayout(workflowId, {
        spacing: next.spacing ?? spacing,
        positions: Object.fromEntries(overridesRef.current),
      });
    },
    [workflowId, spacing],
  );

  const targets = useMemo(() => {
    void layoutVersion;
    const auto = tidyLayout(laid, spacing);
    for (const [id, pos] of overridesRef.current) if (auto.has(id)) auto.set(id, { ...pos });
    return auto;
  }, [laid, spacing, layoutVersion]);

  const [selectedId, setSelectedId] = useState<string | null>(laid.find((a) => a.role === "orchestrator")?.id ?? laid[0]?.id ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState(LIGHT);
  useEffect(() => {
    setTheme(themeNow());
    const watch = new MutationObserver(() => setTheme(themeNow()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, []);

  const selected = laid.find((a) => a.id === selectedId) ?? null;
  const parent = selected?.parentAgentId ? laid.find((a) => a.id === selected.parentAgentId) ?? null : null;
  const childrenOf = selected ? laid.filter((a) => a.parentAgentId === selected.id) : [];
  const selectedTasks = selected ? tasks.filter((t) => t.agentId === selected.id) : [];

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<DotGridHandle>(null);
  const camRef = useRef({ x: 0, y: 0, zoom: 0.9, targetZoom: 0.9 });
  // The draw loop runs outside React, so it reads everything it needs from refs.
  const agentsRef = useRef<Laid[]>(laid);
  const edgesRef = useRef<Edge[]>(edges);
  const targetsRef = useRef(targets);
  const themeRef = useRef(theme);
  const selectedRef = useRef(selectedId);
  agentsRef.current = laid;
  edgesRef.current = edges;
  targetsRef.current = targets;
  themeRef.current = theme;
  selectedRef.current = selectedId;
  const hoverRef = useRef<string | null>(null);
  const hitsRef = useRef<{ id: string; x: number; y: number; r: number }[]>([]);
  /** Where each node is drawn right now. Eases toward its target; the dragged node is exact. */
  const posRef = useRef<Map<string, V2>>(new Map());
  const dragRef = useRef({ down: false, nid: null as string | null, moved: 0, sx: 0, sy: 0, gx: 0, gy: 0, panX: 0, panY: 0 });

  const fittedRef = useRef(false);
  const fitCamera = useCallback((force = false) => {
    const wrap = wrapRef.current;
    const nodes = agentsRef.current;
    if (!wrap || nodes.length === 0) return;
    const vw = wrap.clientWidth;
    const vh = wrap.clientHeight;
    if (vw < 80 || vh < 80) return;
    if (fittedRef.current && !force) return;
    fittedRef.current = true;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const a of nodes) {
      const p = targetsRef.current.get(a.id);
      if (!p) continue;
      const half = Math.max(a.r, a.labelWidth / 2) + 40;
      minX = Math.min(minX, p.x - half);
      maxX = Math.max(maxX, p.x + half);
      minY = Math.min(minY, p.y - a.r - 40);
      maxY = Math.max(maxY, p.y + a.r + 60);
    }
    if (!(minX <= maxX && minY <= maxY)) return;
    const fit = Math.min(vw / Math.max(1, maxX - minX), vh / Math.max(1, maxY - minY));
    const z = Math.min(1.2, Math.max(0.35, fit * 0.92));
    camRef.current = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: z, targetZoom: z };
  }, []);
  const fitCameraRef = useRef(fitCamera);
  fitCameraRef.current = fitCamera;
  useEffect(() => {
    fitCameraRef.current(false);
  }, [targets]);

  /* --------- render loop --------- */
  useLayoutEffect(() => {
    let cancelled = false;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let last = performance.now();
    let ro: ResizeObserver | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let wrap: HTMLDivElement | null = null;
    let family = "system-ui, sans-serif";

    const resize = () => {
      if (!canvas || !wrap) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      fitCameraRef.current(false);
    };

    const boot = () => {
      if (cancelled) return;
      canvas = canvasRef.current;
      wrap = wrapRef.current;
      ctx = canvas?.getContext("2d") ?? null;
      if (!canvas || !wrap || !ctx) {
        raf = requestAnimationFrame(boot);
        return;
      }
      family = getComputedStyle(wrap).fontFamily || family;
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(wrap);
      window.addEventListener("resize", resize);
      last = performance.now();
      raf = requestAnimationFrame(draw);
    };

    const t0 = performance.now();

    /** A node outline: a circle at rest, a soft drifting blob while working. */
    const nodePath = (c: CanvasRenderingContext2D, x: number, y: number, rad: number, wobble: boolean, t: number, seed: number) => {
      c.beginPath();
      if (!wobble) {
        c.arc(x, y, rad, 0, Math.PI * 2);
        return;
      }
      const steps = 72;
      for (let i = 0; i <= steps; i += 1) {
        const th = (i / steps) * Math.PI * 2;
        const rr = rad * blobScale(th, t, seed);
        const px = x + Math.cos(th) * rr;
        const py = y + Math.sin(th) * rr;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
    };

    const strokeCurve = (c: CanvasRenderingContext2D, curve: Cubic) => {
      c.beginPath();
      c.moveTo(curve[0].x, curve[0].y);
      c.bezierCurveTo(curve[1].x, curve[1].y, curve[2].x, curve[2].y, curve[3].x, curve[3].y);
      c.stroke();
    };

    /** Downstream: a bright wave rides inside the edge from parent to child. */
    const drawDownstream = (c: CanvasRenderingContext2D, curve: Cubic, tube: number, t: number) => {
      const samples = sampleCurve(curve, 56);
      let length = 0;
      for (let i = 1; i < samples.length; i += 1) {
        length += Math.hypot(samples[i]!.p.x - samples[i - 1]!.p.x, samples[i]!.p.y - samples[i - 1]!.p.y);
      }
      const wavelength = Math.max(26, tube * 4);
      const amp = tube * 0.26;
      c.lineWidth = Math.max(1.4, tube * 0.24);
      c.strokeStyle = "rgba(255,255,255,0.92)";
      c.beginPath();
      samples.forEach(({ p, n, t: s }, i) => {
        const fadeEnds = Math.sin(Math.PI * s);
        const off = amp * fadeEnds * Math.sin(((s * length) / wavelength - t * 1.4) * Math.PI * 2);
        const x = p.x + n.x * off;
        const y = p.y + n.y * off;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      });
      c.stroke();
    };

    /**
     * Upstream: the same wave idea run backwards, slower and longer, broken into
     * dashes, in a light tint of the child's color. It climbs from child to parent.
     */
    const drawUpstream = (c: CanvasRenderingContext2D, curve: Cubic, tube: number, t: number, tint: string) => {
      const samples = sampleCurve(curve, 56);
      const wavelength = Math.max(40, tube * 7);
      const amp = tube * 0.2;
      let length = 0;
      for (let i = 1; i < samples.length; i += 1) {
        length += Math.hypot(samples[i]!.p.x - samples[i - 1]!.p.x, samples[i]!.p.y - samples[i - 1]!.p.y);
      }
      c.setLineDash([tube * 0.9, tube * 0.7]);
      c.lineDashOffset = t * 30;
      c.lineWidth = Math.max(1.6, tube * 0.3);
      c.strokeStyle = greyed(tint, 0.45, 255);
      c.beginPath();
      samples.forEach(({ p, n, t: s }, i) => {
        const off = amp * Math.sin(Math.PI * s) * Math.sin(((s * length) / wavelength + t * 0.8) * Math.PI * 2);
        const x = p.x + n.x * off;
        const y = p.y + n.y * off;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      });
      c.stroke();
      c.setLineDash([]);
      c.lineDashOffset = 0;
    };

    const draw = (now: number) => {
      if (cancelled || !ctx) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      const nodes = agentsRef.current;
      const cam = camRef.current;
      const selId = selectedRef.current;
      const hoverId = hoverRef.current;
      const T = themeRef.current;
      const dragId = dragRef.current.down ? dragRef.current.nid : null;

      cam.zoom += (cam.targetZoom - cam.zoom) * 0.14;

      // Every free node eases to its own target. Nothing pushes or pulls anything else.
      const pos = posRef.current;
      const ease = 1 - Math.exp(-dt * 9);
      for (const a of nodes) {
        const target = targetsRef.current.get(a.id);
        if (!target) continue;
        const p = pos.get(a.id);
        if (!p) {
          pos.set(a.id, { ...target });
          continue;
        }
        if (a.id === dragId) continue;
        p.x += (target.x - p.x) * ease;
        p.y += (target.y - p.y) * ease;
      }
      for (const id of [...pos.keys()]) if (!nodes.some((a) => a.id === id)) pos.delete(id);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const zoom = cam.zoom;
      const S = (p: V2) => ({ x: w / 2 + (p.x - cam.x) * zoom, y: h / 2 + (p.y - cam.y) * zoom });
      const byId = new Map(nodes.map((a) => [a.id, a]));

      /* --- edges: thick S-curves, colored from one model to the other --- */
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const tube = Math.min(13, Math.max(5, 9 * zoom));
      const labelPx = Math.min(16, Math.max(11, 14 * zoom));
      // Edges leave from under the title, so they never run through it.
      const titleBlock = labelPx * 1.3 + 14;
      for (const edge of edgesRef.current) {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        const pa = pos.get(edge.from);
        const pb = pos.get(edge.to);
        if (!a || !b || !pa || !pb) continue;
        const sa = S(pa);
        const sb = S(pb);
        const below = sb.y >= sa.y;
        const curve = sCurve(
          sa,
          a.r * zoom * 1.04 + (below ? titleBlock : 0),
          sb,
          b.r * zoom * 1.04 + (below ? 0 : titleBlock),
        );
        const active = edge.down || edge.up;
        const related = a.id === selId || b.id === selId;
        const ca = a.waiting ? greyed(a.color, 0.75) : a.color;
        const cb = b.waiting ? greyed(b.color, 0.75) : b.color;
        const grad = ctx.createLinearGradient(curve[0].x, curve[0].y, curve[3].x, curve[3].y);
        const alpha = active ? "cc" : related ? "99" : "59";
        grad.addColorStop(0, `${ca}${alpha}`);
        grad.addColorStop(1, `${cb}${alpha}`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = tube;
        strokeCurve(ctx, curve);
        if (edge.down) drawDownstream(ctx, curve, tube, t);
        if (edge.up) drawUpstream(ctx, curve, tube, t, cb);
      }

      /* --- nodes --- */
      hitsRef.current = [];
      for (const a of nodes) {
        const wp = pos.get(a.id);
        if (!wp) continue;
        const p = S(wp);
        if (p.x < -200 || p.x > w + 200 || p.y < -200 || p.y > h + 200) continue;
        const sel = a.id === selId;
        const hov = a.id === hoverId;
        const dragged = a.id === dragId;
        const rad = a.r * zoom * (dragged ? 1.06 : hov ? 1.03 : 1);
        hitsRef.current.push({ id: a.id, x: p.x, y: p.y, r: rad });
        const color = a.waiting ? greyed(a.color, 0.75) : a.color;

        // Working: a soft halo that breathes behind the wobbling body.
        if (a.busy) {
          const halo = ctx.createRadialGradient(p.x, p.y, rad * 0.8, p.x, p.y, rad * 1.9);
          halo.addColorStop(0, `${color}66`);
          halo.addColorStop(1, `${color}00`);
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad * 1.9, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = color;
          nodePath(ctx, p.x, p.y, rad * 1.13, true, t * 0.8 + 3, a.seed + 0.5);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        // Body: the model's color, lit from the top left.
        nodePath(ctx, p.x, p.y, rad, a.busy, t, a.seed);
        ctx.fillStyle = color;
        ctx.fill();
        const shine = ctx.createRadialGradient(p.x - rad * 0.35, p.y - rad * 0.45, rad * 0.1, p.x, p.y, rad * 1.1);
        shine.addColorStop(0, "rgba(255,255,255,0.28)");
        shine.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = shine;
        ctx.fill();

        if (a.failed) {
          ctx.strokeStyle = T.danger;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (sel || hov || dragged) {
          ctx.strokeStyle = T.ink;
          ctx.globalAlpha = sel || dragged ? 0.9 : 0.45;
          ctx.lineWidth = 2.2;
          nodePath(ctx, p.x, p.y, rad + (a.failed ? 10 : 6), a.busy, t, a.seed);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // The model's mark, front and center.
        ctx.globalAlpha = a.waiting ? 0.75 : 0.96;
        drawModelMark(ctx, a.provider, p.x, p.y, rad * 1.02, "#ffffff");
        ctx.globalAlpha = 1;

        // Title underneath.
        ctx.font = `600 ${labelPx}px ${family}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = T.ink;
        ctx.globalAlpha = a.waiting ? 0.6 : 0.95;
        ctx.fillText(a.name, p.x, p.y + rad + (a.failed ? 13 : 10));
        ctx.globalAlpha = 1;

        // Hover: which model it runs on.
        if (hov && !dragged) {
          ctx.font = `500 12px ${family}`;
          const label = a.model;
          const tw = ctx.measureText(label).width + 20;
          const tx = Math.min(Math.max(p.x, tw / 2 + 8), w - tw / 2 - 8);
          const ty = p.y - rad - 40;
          ctx.fillStyle = T.tip;
          ctx.strokeStyle = T.tipLine;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(tx - tw / 2, ty, tw, 26, 8);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = T.ink;
          ctx.textBaseline = "middle";
          ctx.fillText(label, tx, ty + 13);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    boot();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  /* --------- interaction: pan, zoom, move one node, select --------- */
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    let cancelled = false;
    let unbind: (() => void) | null = null;
    const wait = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) {
        requestAnimationFrame(wait);
        return;
      }
      bind(canvas);
    };
    const bind = (canvas: HTMLCanvasElement) => {
      const pick = (x: number, y: number) => {
        let best: { id: string; d2: number } | null = null;
        for (const hit of hitsRef.current) {
          const d2 = (hit.x - x) ** 2 + (hit.y - y) ** 2;
          if (d2 < (hit.r + 8) ** 2 && (!best || d2 < best.d2)) best = { id: hit.id, d2 };
        }
        return best;
      };
      const toWorld = (clientX: number, clientY: number) => {
        const rect = canvas.getBoundingClientRect();
        const cam = camRef.current;
        return {
          x: cam.x + (clientX - rect.left - rect.width / 2) / cam.zoom,
          y: cam.y + (clientY - rect.top - rect.height / 2) / cam.zoom,
        };
      };

      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
        let gx = 0;
        let gy = 0;
        if (hit) {
          const wpt = toWorld(e.clientX, e.clientY);
          const p = posRef.current.get(hit.id);
          if (p) {
            gx = p.x - wpt.x;
            gy = p.y - wpt.y;
          }
          setDragging(true);
        }
        dragRef.current = {
          down: true,
          nid: hit?.id ?? null,
          moved: 0,
          sx: e.clientX,
          sy: e.clientY,
          gx,
          gy,
          panX: camRef.current.x,
          panY: camRef.current.y,
        };
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* capture is best-effort; window listeners still cover the drag */
        }
        canvas.style.cursor = "grabbing";
      };

      const onMove = (e: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        const d = dragRef.current;
        if (!d.down) {
          const hit = e.target === canvas ? pick(e.clientX - rect.left, e.clientY - rect.top) : null;
          hoverRef.current = hit?.id ?? null;
          canvas.style.cursor = hit ? "grab" : "default";
          return;
        }
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        d.moved = Math.max(d.moved, Math.hypot(dx, dy));
        if (d.nid) {
          // Only this node moves. Its edges follow because they are drawn from positions.
          const wpt = toWorld(e.clientX, e.clientY);
          posRef.current.set(d.nid, { x: wpt.x + d.gx, y: wpt.y + d.gy });
        } else {
          const zoom = camRef.current.zoom;
          camRef.current.x = d.panX - dx / zoom;
          camRef.current.y = d.panY - dy / zoom;
        }
      };

      const finish = (e: PointerEvent | null) => {
        const d = dragRef.current;
        if (!d.down) return;
        const wasDrag = d.moved >= 4;
        const nid = d.nid;
        d.down = false;
        d.nid = null;
        canvas.style.cursor = "default";
        setDragging(false);
        if (nid && wasDrag) {
          const p = posRef.current.get(nid);
          if (p) {
            overridesRef.current.set(nid, { x: p.x, y: p.y });
            persistRef.current();
            setLayoutVersion((v) => v + 1);
          }
          // The background answers the drop with a shockwave where the node landed.
          if (e) {
            const rect = canvas.getBoundingClientRect();
            dotsRef.current?.shock(e.clientX - rect.left, e.clientY - rect.top);
          }
        }
        if (!wasDrag && e) {
          const rect = canvas.getBoundingClientRect();
          const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
          if (hit) {
            setSelectedId(hit.id);
            setModalOpen(true);
          } else {
            setModalOpen(false);
            setSelectedId(null);
          }
        }
      };
      const onUp = (e: PointerEvent) => finish(e);
      const onCancel = () => finish(null);

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const cam = camRef.current;
        const prev = cam.targetZoom;
        const next = Math.min(2.2, Math.max(0.3, prev * Math.exp(-e.deltaY * 0.0011)));
        const worldX = cam.x + (mx - rect.width / 2) / prev;
        const worldY = cam.y + (my - rect.height / 2) / prev;
        cam.x = worldX - (mx - rect.width / 2) / next;
        cam.y = worldY - (my - rect.height / 2) / next;
        cam.targetZoom = next;
      };
      const onLeave = () => {
        hoverRef.current = null;
      };

      canvas.addEventListener("pointerdown", onDown);
      // window-level move/up so a drag never dies at the canvas edge
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      canvas.addEventListener("pointerleave", onLeave);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      unbind = () => {
        canvas.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        canvas.removeEventListener("pointerleave", onLeave);
        canvas.removeEventListener("wheel", onWheel);
      };
    };
    wait();
    return () => {
      cancelled = true;
      unbind?.();
    };
  }, []);

  /* --------- keyboard --------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function tidy() {
    overridesRef.current.clear();
    persist();
    setLayoutVersion((v) => v + 1);
    window.setTimeout(() => fitCamera(true), 0);
  }

  return (
    <div className="graph-space relative h-full w-full">
      {/* ---------- background: dots that answer a dragged and dropped agent ---------- */}
      <DotGrid
        ref={dotsRef}
        className="graph-dots"
        baseColor={theme.dotBase}
        activeColor={theme.dotActive}
        dotSize={4}
        gap={20}
        proximity={110}
        strength={0.9}
        shockRadius={300}
        shockStrength={4}
        glow={0.45}
        fade={0.25}
        mouseInteraction={dragging}
        clickShock={false}
      />

      {/* ---------- floating controls, inside the canvas ---------- */}
      <div className="absolute right-4 top-3 z-10">
        <div className="btn-group">
          <Button variant="secondary" size="sm" onClick={tidy} title="Put every agent back in its automatic spot">
            Tidy
          </Button>
          <Button variant="secondary" size="sm" onClick={() => fitCamera(true)} title="Reset view">
            <Maximize size={12} /> Center
          </Button>
        </div>
      </div>

      {/* ---------- canvas ---------- */}
      <div ref={wrapRef} className="graph-wrap absolute inset-0 select-none">
        {laid.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[13px] text-ink-4">No agents in this workflow yet.</p>
          </div>
        ) : null}
        <canvas ref={canvasRef} className="graph-canvas touch-none" />
        <span className="pointer-events-none absolute bottom-3 left-4 text-[11px] text-ink-4">
          Drag to pan · scroll to zoom · drag an agent to move it
        </span>

        {/* ---------- details drawer ---------- */}
        {modalOpen && selected ? (
          <aside className="animate-fade-up absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col border-l border-line bg-surface/95 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full font-mono text-[11px] text-white"
                  style={{ background: selected.waiting ? greyed(selected.color, 0.75) : selected.color }}
                >
                  {initials(selected.name)}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink">{selected.name}</div>
                  <div className="mono mt-0.5 truncate text-[10px] text-ink-4">
                    {selected.role} · {selected.model}
                  </div>
                </div>
              </div>
              <StatusBadge status={selected.lastRun?.status ?? selected.status} />
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="focus-ring rounded-xs p-1 text-ink-4 hover:bg-surface-2 hover:text-ink"
                aria-label="Close details"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="border-b border-line p-4">
                <p className="text-[11.5px] leading-relaxed text-ink-2">{selected.summary}</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Tag tone={selected.role === "security" ? "audit" : "accent"}>{selected.complexity}</Tag>
                  <Tag>{selected.dataClass}</Tag>
                  <Tag>v{selected.version}</Tag>
                  {parent ? <Tag tone="muted">↳ {parent.name}</Tag> : null}
                  {selected.openFindings > 0 ? <Tag tone="danger">{selected.openFindings} findings</Tag> : null}
                </div>
              </div>

              {/* current job */}
              <div className="border-b border-line p-4">
                <div className="micro mb-2">Current task</div>
                {selectedTasks.length === 0 ? (
                  <p className="text-[11px] text-ink-4">No task yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {selectedTasks.slice(0, 3).map((task, i) => (
                      <li key={`${task.runId}-${i}`} className="rounded-sm border border-line bg-surface-2/60 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="mono truncate text-[10px] text-warn">{task.status}</span>
                          <Link href={`/runs/${task.runId}`} className="mono flex-none text-[9.5px] text-accent hover:underline">
                            trace →
                          </Link>
                        </div>
                        <p className="mt-1 text-[11px] leading-snug text-ink-2">{task.title}</p>
                        <p className="mono mt-1 text-[9px] text-ink-4">{relativeTime(task.at)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
                <div className="p-3">
                  <KeyValue label="Model">{selected.model}</KeyValue>
                  <KeyValue label="Tokens">
                    {tokens((selected.inputTokens ?? 0) + (selected.outputTokens ?? 0))}
                    <span className="text-ink-4">
                      {" "}
                      ({tokens(selected.inputTokens)} in / {tokens(selected.outputTokens)} out)
                    </span>
                  </KeyValue>
                  <KeyValue label="Time run">{duration(selected.durationMs)}</KeyValue>
                </div>
                <div className="p-3">
                  <KeyValue label="Spend">{usd(selected.spentUsd, { precise: true })}</KeyValue>
                  <KeyValue label="Diff">
                    {(selected.diff?.writes ?? 0)} writes · {(selected.diff?.reads ?? 0)} reads
                    {(selected.diff?.deletes ?? 0) ? ` · ${selected.diff.deletes} deletes` : ""}
                  </KeyValue>
                  <KeyValue label="Last run">
                    {selected.lastRun ? (
                      <Link href={`/runs/${selected.lastRun.id}`} className="focus-ring text-accent hover:underline">
                        {selected.lastRun.status} · {relativeTime(selected.lastRun.at)}
                      </Link>
                    ) : (
                      <span className="text-ink-4">never</span>
                    )}
                  </KeyValue>
                </div>
              </div>
              {(selected.filesTouched?.length ?? 0) > 0 ? (
                <div className="border-b border-line px-4 py-3">
                  <div className="micro mb-1.5">Files touched</div>
                  <p className="mono text-[10px] leading-relaxed text-ink-3">
                    {selected.filesTouched.slice(0, 8).join(" · ")}
                  </p>
                </div>
              ) : null}

              {selected.budgetUsd ? (
                <div className="border-b border-line px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="micro">Budget burn</span>
                    <span className="mono text-[10px] text-ink-4">
                      {Math.round((selected.spentUsd / selected.budgetUsd) * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (selected.spentUsd / selected.budgetUsd) * 100)}%`,
                        background:
                          selected.spentUsd / selected.budgetUsd > 0.9
                            ? "var(--color-danger, #b2361f)"
                            : selected.spentUsd / selected.budgetUsd > 0.7
                              ? "var(--color-warn, #b07400)"
                              : selected.color,
                      }}
                    />
                  </div>
                </div>
              ) : null}

              {/* capability */}
              <div className="border-b border-line p-4">
                <div className="micro mb-2">Capability</div>
                <div className="mono mb-1 text-[10px] text-ink-4">
                  {selected.tools.length} tools · {selected.grants.length} grants
                </div>
                <div className="flex flex-wrap gap-1">
                  {selected.tools.slice(0, 8).map((tool) => (
                    <span key={tool} className="mono rounded-xs border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">
                      {tool}
                    </span>
                  ))}
                </div>
                {childrenOf.length > 0 ? (
                  <>
                    <Divider className="my-3" />
                    <div className="micro mb-2">Reports</div>
                    <div className="flex flex-wrap gap-1.5">
                      {childrenOf.map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => setSelectedId(child.id)}
                          className="focus-ring mono rounded-xs border border-line px-1.5 py-0.5 text-[10px] text-ink-3 hover:border-line-strong hover:text-ink"
                        >
                          {child.name}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>

            </div>

            {/* view system (the live VSCode-like console) */}
            <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
              <Link href={selected.trailHref ?? `/agents/${selected.id}/trail`} className="block hover:bg-surface-2">
                <div className="p-3">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                    <Terminal size={12} className="text-accent" /> Trail
                  </div>
                  <p className="mono mt-1 text-[9.5px] text-ink-4">toolcalls · files · thought</p>
                </div>
              </Link>
              <Link href={selected.consoleHref ?? `/agents/${selected.id}/console`} className="block hover:bg-surface-2">
                <div className="p-3">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                    {selected.role === "orchestrator" ? (
                      <Crown size={12} className="text-accent" />
                    ) : selected.role === "security" ? (
                      <ShieldHalf size={12} className="text-audit" />
                    ) : (
                      <Boxes size={12} className="text-ink-3" />
                    )}
                    Filesystem
                  </div>
                  <p className="mono mt-1 text-[9.5px] text-ink-4">sandbox · live files</p>
                </div>
              </Link>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
