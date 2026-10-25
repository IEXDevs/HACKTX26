"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Crown,
  Crosshair,
  Loader2,
  Maximize,
  Play,
  Plus,
  ShieldHalf,
  Terminal,
  X,
} from "@/components/icons";
import { Button, Divider, KeyValue, Panel, StatusBadge, Tag } from "@/components/ui/primitives";
import { DispatchPanel, type DispatchAgentOption } from "@/components/dispatch/dispatch-panel";
import { relativeTime } from "@/lib/format";

export interface GraphAgent {
  id: string;
  name: string;
  role: string;
  status: string;
  summary: string;
  parentAgentId: string | null;
  model: string;
  complexity: string;
  dataClass: string;
  tools: string[];
  grants: { resource: string; scopes: string[]; paths?: string[] }[];
  maxSteps: number;
  version: number;
  lastRun: { id: string; status: string; at: string } | null;
  openFindings: number;
  budgetUsd: number | null;
  spentUsd: number;
}

/* ------------------------------------------------------------------ */
/* tokens (mirror the light theme in globals.css so the canvas matches) */
/* ------------------------------------------------------------------ */

const LIGHT = {
  canvas: "#f3f6f4",
  surface: "#ffffff",
  surface3: "#eef3ef",
  lineStrong: "#c4cfc7",
  ink: "#14231a",
  ink3: "#55625a",
  ink4: "#6b786f",
  accent: "#2f7a4d",
  info: "#1d6f86",
  warn: "#b07400",
  danger: "#b2361f",
  ok: "#2e7d4f",
  audit: "#6b4fb8",
  tip: "rgba(255,255,255,0.96)",
  inkRgb: "20,35,26",
  dotRgb: "120,140,128",
};
const DARK: typeof LIGHT = {
  canvas: "#0e1110",
  surface: "#151917",
  surface3: "#1c211f",
  lineStrong: "#343c38",
  ink: "#eef1ef",
  ink3: "#9ba5a0",
  ink4: "#7c8781",
  accent: "#5fbf86",
  info: "#59c8e0",
  warn: "#f0b450",
  danger: "#ff6b5b",
  ok: "#5fd08e",
  audit: "#a98bfa",
  tip: "rgba(21,25,23,0.96)",
  inkRgb: "238,241,239",
  dotRgb: "90,100,95",
};
/** Live palette; draw() re-syncs it with html[data-theme] every frame. */
const T = { ...LIGHT };
function syncTheme() {
  const want = document.documentElement.dataset.theme === "dark" ? DARK : LIGHT;
  if (T.canvas !== want.canvas) Object.assign(T, want);
}

/** Status to halo colour. The halo is the status signal. */
function haloColor(status: string): string {
  const map: Record<string, string> = {
    running: T.accent,
    queued: T.info,
    awaiting_approval: T.warn,
    succeeded: T.ok,
    active: T.ok,
    failed: T.danger,
    halted: T.danger,
    cancelled: T.warn,
    blocked: T.warn,
  };
  return map[status] ?? T.ink4;
}
function haloFor(agent: GraphAgent): string {
  return haloColor(agent.lastRun?.status ?? agent.status);
}
/** Mid-job → halo breathes, orbs orbit, edges stream. */
function isBusy(agent: GraphAgent): boolean {
  const s = agent.lastRun?.status ?? agent.status;
  return s === "running" || s === "queued";
}
function isBlocked(agent: GraphAgent): boolean {
  return (agent.lastRun?.status ?? agent.status) === "awaiting_approval";
}

/** Bubble size = the weight of the model it runs. Orchestrator is the biggest body. */
function baseRadius(agent: GraphAgent): number {
  let r = agent.role === "orchestrator" ? 34 : agent.role === "security" ? 19 : 17;
  if (agent.complexity === "critical") r += 7;
  else if (agent.complexity === "high") r += 4;
  else if (agent.complexity === "low") r -= 2;
  return r;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h) / 2 ** 31;
}

/* ------------------------------------------------------------------ */
/* layout — compact orbital clusters, siblings shoulder to shoulder     */
/* ------------------------------------------------------------------ */

interface V2 {
  x: number;
  y: number;
}
interface Laid extends GraphAgent {
  pos: V2;
  r: number;
  halo: string;
  busy: boolean;
  blocked: boolean;
}

function layout(agents: GraphAgent[]): Laid[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const roots = agents.filter((a) => !a.parentAgentId || !byId.has(a.parentAgentId));
  const out: Laid[] = [];
  const n = Math.max(roots.length, 1);

  const mk = (a: GraphAgent, pos: V2): Laid => ({
    ...a,
    pos,
    r: baseRadius(a),
    halo: haloFor(a),
    busy: isBusy(a),
    blocked: isBlocked(a),
  });

  roots.forEach((root, ri) => {
    const j = hash(root.id);
    const rootPos: V2 = { x: (ri - (n - 1) / 2) * 470 + (j - 0.5) * 30, y: (j - 0.5) * 60 };

    const children = agents
      .filter((a) => a.parentAgentId === root.id)
      .sort((a, b) => hash(a.id) - hash(b.id));

    out.push(mk(root, rootPos));
    // ring auto-sizes: circumference must fit every satellite's width + a gap
    const GAP = 40;
    const fitRadius = (members: GraphAgent[], floor: number) =>
      Math.max(
        floor,
        members.reduce((s, m) => s + baseRadius(m) * 2 + GAP, 0) / (Math.PI * 2),
      );
    const ringR = fitRadius(children, 190);
    children.forEach((child, ci) => {
      const count = Math.max(children.length, 3);
      const angle = (ci / count) * Math.PI * 2 + j * 2.4 + (children.length % 2 ? Math.PI / 2 : 0);
      const radius = ringR + (hash(child.id) - 0.5) * 24;
      const pos = {
        x: rootPos.x + Math.cos(angle) * radius,
        y: rootPos.y + Math.sin(angle) * radius * 0.82, // slight vertical squash = organic cluster
      };
      out.push(mk(child, pos));

      const grand = agents.filter((a) => a.parentAgentId === child.id);
      const grandR = fitRadius(grand, 140);
      grand.forEach((g, gi) => {
        const gc = Math.max(grand.length, 3);
        const gAngle = angle + ((gi - (grand.length - 1) / 2) * Math.PI) / (gc + 1);
        const gPos = {
          x: pos.x + Math.cos(gAngle) * grandR,
          y: pos.y + Math.sin(gAngle) * grandR * 0.82 - 22,
        };
        out.push(mk(g, gPos));
      });
    });
  });

  // safety net: anything orphaned by the mapping above orbits the first root
  for (const a of agents) {
    if (out.some((o) => o.id === a.id)) continue;
    const parent = out.find((o) => o.id === a.parentAgentId);
    const ang = hash(a.id) * Math.PI * 2;
    const origin = parent ?? out[0];
    out.push(
      mk(a, {
        x: (origin?.pos.x ?? 0) + Math.cos(ang) * 190,
        y: (origin?.pos.y ?? 0) + Math.sin(ang) * 190 * 0.82,
      }),
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* detail drawer data                                                  */
/* ------------------------------------------------------------------ */

export interface GraphTask {
  agentId: string;
  runId: string;
  title: string;
  status: string;
  at: string;
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export function GraphSpace({
  agents,
  tasks,
  dispatchAgents,
}: {
  agents: GraphAgent[];
  tasks: GraphTask[];
  dispatchAgents: DispatchAgentOption[];
}) {
  const router = useRouter();
  const laid = useMemo(() => layout(agents), [agents]);
  const [selectedId, setSelectedId] = useState<string | null>(laid.find((a) => a.role === "orchestrator")?.id ?? laid[0]?.id ?? null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [bubble, setBubble] = useState<{ agentId: string; goal: string; sending: boolean; error: string | null }>({ agentId: "", goal: "", sending: false, error: null });

  const selected = laid.find((a) => a.id === selectedId) ?? null;
  const parent = selected?.parentAgentId ? laid.find((a) => a.id === selected.parentAgentId) ?? null : null;
  const childrenOf = selected ? laid.filter((a) => a.parentAgentId === selected.id) : [];
  const peers = selected?.parentAgentId
    ? laid.filter((a) => a.parentAgentId === selected!.parentAgentId && a.id !== selected!.id)
    : [];
  const selectedTasks = selected ? tasks.filter((t) => t.agentId === selected.id) : [];

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const camRef = useRef({ x: 0, y: 26, zoom: 0.95, targetZoom: 0.95 });
  const agentsRef = useRef<Laid[]>(laid);
  const selectedRef = useRef(selectedId);
  const hoverRef = useRef<string | null>(null);
  const hitsRef = useRef<{ id: string; x: number; y: number; s: number; r: number }[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999, inside: false });
  const dragRef = useRef({
    down: false,
    nid: null as string | null,
    moved: 0,
    sx: 0,
    sy: 0,
    gx: 0,
    gy: 0,
    panX: 0,
    panY: 0,
  });
  /** committed positions — the truth. A drop writes the drop point here, so the
      old spot ceases to exist anywhere in the sim. Nothing can snap back to it. */
  const homeRef = useRef<Map<string, V2>>(new Map());
  /** simulated physics state, per node */
  const bodyRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number; fx: number; fy: number }>>(new Map());
  /** live pointer target (world) for the node being dragged */
  const targetRef = useRef<Map<string, V2>>(new Map());
  /** spring rest lengths — relax toward actual geometry when idle, so moved
      families stop straining and accept their new shape */
  const restRef = useRef<Map<string, number>>(new Map());
  /** static parent → child topology */
  const pairsRef = useRef<{ parentId: string; childId: string }[]>([]);
  /** auto-fit runs exactly once */
  const fittedRef = useRef(false);

  useEffect(() => {
    agentsRef.current = laid;
    const homes = homeRef.current;
    for (const a of laid) {
      if (!homes.has(a.id)) homes.set(a.id, { x: a.pos.x, y: a.pos.y });
      let body = bodyRef.current.get(a.id);
      if (!body) {
        const h = homes.get(a.id) ?? a.pos;
        body = { x: h.x, y: h.y, vx: 0, vy: 0, fx: 0, fy: 0 };
        bodyRef.current.set(a.id, body);
      }
      body.fx = 0;
      body.fy = 0;
    }
    for (const id of [...homes.keys()]) {
      if (!laid.some((a) => a.id === id)) {
        homes.delete(id);
        bodyRef.current.delete(id);
        targetRef.current.delete(id);
      }
    }
    // static topology; rest lengths seed from the base layout once, then relax live
    const pairs: { parentId: string; childId: string }[] = [];
    for (const a of laid) {
      if (!a.parentAgentId) continue;
      const p = laid.find((o) => o.id === a.parentAgentId);
      if (!p) continue;
      pairs.push({ parentId: p.id, childId: a.id });
      const key = `${p.id}>${a.id}`;
      if (!restRef.current.has(key)) {
        restRef.current.set(key, Math.max(60, Math.hypot(a.pos.x - p.pos.x, a.pos.y - p.pos.y)));
      }
    }
    pairsRef.current = pairs;
    // first boot only: frame the whole constellation so every bubble is on
    // screen — never touch the camera again after that
    if (!fittedRef.current && homes.size > 0) {
      fittedRef.current = true;
      const wrap = wrapRef.current;
      if (wrap) {
        const vw = Math.max(1, wrap.clientWidth);
        const vh = Math.max(1, wrap.clientHeight);
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const a of laid) {
          const hpos = homes.get(a.id) ?? a.pos;
          const pad = a.r + 90; // bubble + caption breathing room
          minX = Math.min(minX, hpos.x - pad);
          maxX = Math.max(maxX, hpos.x + pad);
          minY = Math.min(minY, hpos.y - pad);
          maxY = Math.max(maxY, hpos.y + pad);
        }
        if (minX <= maxX && minY <= maxY) {
          const fit = Math.min(vw / (maxX - minX), vh / (maxY - minY));
          const z = Math.min(1.05, Math.max(0.3, fit));
          camRef.current = {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
            zoom: z,
            targetZoom: z,
          };
        }
      }
    }
  }, [laid]);

  /* --------- render loop --------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let last = performance.now();

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const t0 = performance.now();
    const MONO = (px: number, weight = 400) =>
      `${weight} ${px}px ui-monospace, "SFMono-Regular", Menlo, monospace`;

    const draw = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      const agents = agentsRef.current;
      const cam = camRef.current;
      const selId = selectedRef.current;

      // smooth zoom
      cam.zoom += (cam.targetZoom - cam.zoom) * 0.14;

      /* --- spring physics: committed homes are truth, drops are permanent --- */
      const bodies = bodyRef.current;
      const homes = homeRef.current;
      const rests = restRef.current;
      const dragId = dragRef.current.down ? dragRef.current.nid : null;

      // 1. the dragged node is kinematic: exactly at the pointer target, zero velocity.
      const tgt = dragId ? targetRef.current.get(dragId) : undefined;
      if (dragId && tgt) {
        const db = bodies.get(dragId);
        if (db) {
          db.x = tgt.x;
          db.y = tgt.y;
          db.vx = 0;
          db.vy = 0;
          db.fx = 0;
          db.fy = 0;
        }
      }
      // 2. free nodes feel a pull toward their committed home
      for (const a of agents) {
        if (a.id === dragId) continue;
        const body = bodies.get(a.id);
        const home = homes.get(a.id);
        if (!body || !home) continue;
        const k = 2.4 * (1 + a.r / 70);
        body.fx += (home.x - body.x) * k;
        body.fy += (home.y - body.y) * k;
      }
      // 3. spring links: force lands ONLY on the free end. Rests relax toward the
      //    real geometry while idle, so a moved family accepts its new shape.
      for (const { parentId, childId } of pairsRef.current) {
        const cp = bodies.get(parentId);
        const cc = bodies.get(childId);
        if (!cp || !cc) continue;
        const key = `${parentId}>${childId}`;
        const dx = cc.x - cp.x;
        const dy = cc.y - cp.y;
        const d = Math.hypot(dx, dy) || 1;
        let rest = rests.get(key) ?? 120;
        if (!dragId) {
          rest += (d - rest) * Math.min(1, dt * 0.35);
          rests.set(key, rest);
        }
        const f = (d - rest) * 100;
        const nx = (dx / d) * f;
        const ny = (dy / d) * f;
        const pDrag = parentId === dragId;
        const cDrag = childId === dragId;
        if (pDrag && cDrag) continue;
        if (pDrag) {
          cc.fx -= nx;
          cc.fy -= ny;
        } else if (cDrag) {
          cp.fx += nx;
          cp.fy += ny;
        } else {
          cp.fx += nx;
          cp.fy += ny;
          cc.fx -= nx;
          cc.fy -= ny;
        }
      }
      // 3b. separation: bubbles never overlap. Pushes are capped per frame so the
      // map visibly breathes apart ("slow sparse"), and every push is absorbed
      // into the free nodes' committed homes — spacing becomes permanent.
      const PAD = 34;
      const MAXPUSH = 2.5;
      for (let iter = 0; iter < 2; iter += 1) {
        for (let i = 0; i < agents.length; i += 1) {
          const a = agents[i];
          if (!a) continue;
          const ba = bodies.get(a.id);
          if (!ba) continue;
          for (let k = i + 1; k < agents.length; k += 1) {
            const b = agents[k];
            if (!b) continue;
            const bb = bodies.get(b.id);
            if (!bb) continue;
            const pinA = a.id === dragId;
            const pinB = b.id === dragId;
            if (pinA && pinB) continue;
            let dx = bb.x - ba.x;
            let dy = bb.y - ba.y;
            let d = Math.hypot(dx, dy);
            const minD = a.r + b.r + PAD;
            if (d >= minD) continue;
            if (d < 0.01) {
              const ang = hash(a.id + b.id) * Math.PI * 2;
              dx = Math.cos(ang);
              dy = Math.sin(ang);
              d = 0.01;
            }
            const push = Math.min(minD - d, MAXPUSH);
            const nx = (dx / d) * push;
            const ny = (dy / d) * push;
            const ha = homes.get(a.id);
            const hb = homes.get(b.id);
            if (pinA) {
              bb.x += nx;
              bb.y += ny;
              if (hb) {
                hb.x += nx;
                hb.y += ny;
              }
            } else if (pinB) {
              ba.x -= nx;
              ba.y -= ny;
              if (ha) {
                ha.x -= nx;
                ha.y -= ny;
              }
            } else {
              ba.x -= nx / 2;
              ba.y -= ny / 2;
              bb.x += nx / 2;
              bb.y += ny / 2;
              if (ha) {
                ha.x -= nx / 2;
                ha.y -= ny / 2;
              }
              if (hb) {
                hb.x += nx / 2;
                hb.y += ny / 2;
              }
            }
          }
        }
      }
      // 4. integrate the free nodes only — snappy springs, firm damping, no wobble
      for (const a of agents) {
        if (a.id === dragId) continue;
        const body = bodies.get(a.id);
        if (!body) continue;
        const damp = Math.exp(-5 * dt);
        body.vx = (body.vx + body.fx * dt) * damp;
        body.vy = (body.vy + body.fy * dt) * damp;
        const speed = Math.hypot(body.vx, body.vy);
        if (speed > 3000) {
          body.vx = (body.vx / speed) * 3000;
          body.vy = (body.vy / speed) * 3000;
        }
        body.x += body.vx * dt;
        body.y += body.vy * dt;
        body.fx = 0;
        body.fy = 0;
      }

      /* --- render --- */
      syncTheme();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = T.canvas;
      ctx.fillRect(0, 0, w, h);

      const zoom = cam.zoom;
      const S = (p: V2) => ({
        x: w / 2 + (p.x - cam.x) * zoom,
        y: h / 2 + (p.y - cam.y) * zoom,
      });
      const SP = (a: Laid) => {
        const body = bodyRef.current.get(a.id);
        return S(body ? { x: body.x, y: body.y } : a.pos);
      };

      /* --- infinite dotted plane: anchored to world space so it pans/zooms with you --- */
      {
        const step = 64;
        const halfW = w / 2 + step;
        const halfH = h / 2 + step;
        const left = cam.x - halfW / zoom;
        const top = cam.y - halfH / zoom;
        const gx0 = Math.floor(left / step) * step;
        const gy0 = Math.floor(top / step) * step;
        const cols = Math.ceil(w / (step * zoom)) + 2;
        const rows = Math.ceil(h / (step * zoom)) + 2;
        const base = 0.24 + (zoom - 0.55) * 0.28;
        const alpha = Math.min(0.4, Math.max(0.06, base));
        ctx.fillStyle = `rgba(${T.dotRgb},${alpha.toFixed(2)})`;
        const dot = Math.max(1, Math.min(2.2, step * zoom * 0.028));
        for (let i = 0; i < cols; i += 1) {
          for (let k = 0; k < rows; k += 1) {
            const wx = gx0 + i * step;
            const wy = gy0 + k * step;
            const sp = S({ x: wx, y: wy });
            ctx.fillRect(sp.x - dot / 2, sp.y - dot / 2, dot, dot);
          }
        }
        // anchor cross at world origin — the space's fixed point while exploring
        const o = S({ x: 0, y: 0 });
        ctx.strokeStyle = `rgba(${T.dotRgb},0.55)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(o.x - 7, o.y);
        ctx.lineTo(o.x + 7, o.y);
        ctx.moveTo(o.x, o.y - 7);
        ctx.lineTo(o.x, o.y + 7);
        ctx.stroke();
      }

      /* --- edges, under everything --- */
      const byId = new Map(agents.map((a) => [a.id, a]));
      const solidEdges: { a: Laid; p: Laid; e1: V2; e2: V2 }[] = [];
      for (const a of agents) {
        const p = byId.get(a.parentAgentId ?? "");
        if (!p) continue;
        const e1 = SP(p);
        const e2 = SP(a);
        solidEdges.push({ a, p, e1, e2 });
      }
      const groups = new Map<string, Laid[]>();
      for (const a of agents) {
        if (!a.parentAgentId) continue;
        const list = groups.get(a.parentAgentId) ?? [];
        list.push(a);
        groups.set(a.parentAgentId, list);
      }
      ctx.lineCap = "round";

      // solid delegation edges — flow dashes when someone is on the clock
      for (const { a, p, e1, e2 } of solidEdges) {
        const related = p.id === selId || a.id === selId;
        if (p.busy || a.busy) {
          ctx.setLineDash([4, 11]);
          ctx.lineDashOffset = -t * 46 * (related ? 1.5 : 1);
          ctx.strokeStyle = related ? `${T.accent}dd` : `${T.accent}44`;
          ctx.lineWidth = related ? 3.2 : 2.6;
        } else {
          ctx.setLineDash([]);
          ctx.strokeStyle = related ? `rgba(${T.inkRgb},0.55)` : `rgba(${T.dotRgb},0.9)`;
          ctx.lineWidth = related ? 2.4 : 2;
        }
        ctx.beginPath();
        ctx.moveTo(e1.x, e1.y);
        ctx.lineTo(e2.x, e2.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // dashed peer mesh — the ring where siblings swap context
      ctx.setLineDash([5, 9]);
      for (const list of groups.values()) {
        for (let i = 0; i < list.length; i += 1) {
          const a = list[i];
          const b = list[(i + 1) % list.length];
          if (!a || !b || a === b) continue;
          const e1 = SP(a);
          const e2 = SP(b);
          const related = a.id === selId || b.id === selId;
          ctx.strokeStyle = related ? `${T.info}88` : `rgba(${T.dotRgb},0.68)`;
          ctx.lineWidth = related ? 2.6 : 2;
          ctx.beginPath();
          ctx.moveTo(e1.x, e1.y);
          ctx.lineTo(e2.x, e2.y);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      /* --- directional info packets: who is talking to whom --- */
      const particle = (from: V2, to: V2, frac: number, color: string, size: number) => {
        const fx = from.x + (to.x - from.x) * frac;
        const fy = from.y + (to.y - from.y) * frac;
        const trail = Math.max(0.02, frac - 0.06);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(from.x + (to.x - from.x) * trail, from.y + (to.y - from.y) * trail, size * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(fx, fy, size, 0, Math.PI * 2);
        ctx.fill();
      };
      // delegation flow, parent → child (work travels downward)
      for (const { a, p, e1, e2 } of solidEdges) {
        if (!(a.busy || p.busy)) continue;
        const speed = 0.24 + hash(a.id) * 0.12;
        for (let i = 0; i < 2; i += 1) {
          const frac = (t * speed + i * 0.5 + hash(a.id)) % 1;
          particle(e1, e2, frac, p.busy && !a.busy ? `rgba(${T.inkRgb},0.5)` : T.accent, 3);
        }
      }
      // peer route — packets stream toward whoever holds the mic
      for (const list of groups.values()) {
        for (let i = 0; i < list.length; i += 1) {
          const a = list[i];
          const b = list[(i + 1) % list.length];
          if (!a || !b || a === b) continue;
          const chatter = a.busy || b.busy || a.id === selId || b.id === selId;
          if (!chatter) continue;
          const e1 = SP(a);
          const e2 = SP(b);
          if (a.busy && !b.busy) {
            particle(e1, e2, (t * 0.3 + hash(a.id)) % 1, T.info, 2);
          } else if (b.busy && !a.busy) {
            particle(e2, e1, (t * 0.3 + hash(b.id)) % 1, T.info, 2);
          } else {
            particle(e1, e2, (t * 0.26 + hash(a.id)) % 1, T.info, 2);
            particle(e2, e1, (t * 0.26 + hash(b.id) * 0.5 + 0.37) % 1, `${T.info}99`, 1.8);
          }
        }
      }

      /* --- bubbles, biggest first so small ones stay in front visually --- */
      const order = [...agents].sort((a, b) => b.r - a.r);
      hitsRef.current = [];
      for (const a of order) {
        const p = SP(a);
        if (p.x < -150 || p.x > w + 150 || p.y < -160 || p.y > h + 150) continue;
        const rad = a.r * zoom;
        const dragged = a.id === (dragRef.current.down ? dragRef.current.nid : null);
        const sel = a.id === selId;
        const hov = a.id === (hoverRef.current ?? "");
        hitsRef.current.push({ id: a.id, x: p.x, y: p.y, s: zoom, r: rad });
        const pulse = a.blocked ? 0.5 + 0.5 * Math.sin(t * 5) : 1;

        // halo — the status read from across the room
        const haloR = rad * (a.busy ? 1.85 + 0.14 * Math.sin(t * 3.4) : 1.6);
        const g = ctx.createRadialGradient(p.x, p.y, rad * 0.85, p.x, p.y, haloR);
        g.addColorStop(0, `${haloFor(a)}${a.busy ? "5c" : "40"}`);
        g.addColorStop(0.6, `${haloFor(a)}24`);
        g.addColorStop(1, `${haloFor(a)}00`);
        ctx.globalAlpha = 0.95 * pulse;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // body
        const body = ctx.createRadialGradient(p.x - rad * 0.32, p.y - rad * 0.42, rad * 0.15, p.x, p.y, rad);
        body.addColorStop(0, T.surface);
        body.addColorStop(1, T.surface3);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = a.busy
          ? `${haloFor(a)}${Math.round(28 + 20 * Math.sin(t * 4 + hash(a.id) * 7)).toString(16).padStart(2, "0")}`
          : `${haloFor(a)}17`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();

        // ring — grabbed bubbles pop
        ctx.lineWidth = dragged || sel ? 2.6 : hov ? 2.1 : 1.5;
        ctx.strokeStyle = dragged || sel || hov ? T.ink : `${haloFor(a)}cc`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.stroke();

        // blocked: pulsing warn tension ring — the map begs you to intervene
        if (a.blocked) {
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = T.warn;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad + 6 + pulse * 3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // thinking orbs — cognitive proof while the agent burns tokens
        if (a.busy) {
          for (let i = 0; i < 3; i += 1) {
            const oa = t * (1.7 + hash(a.id) * 0.5) + (i * Math.PI * 2) / 3 + hash(a.id);
            const ox = p.x + Math.cos(oa) * (rad + 8);
            const oy = p.y + Math.sin(oa) * (rad + 8) * 0.6;
            ctx.fillStyle = i === 0 ? T.accent : T.info;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.arc(ox, oy, 2.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }

        // initials
        ctx.fillStyle = a.busy ? T.ink : T.ink3;
        ctx.font = MONO(Math.max(8, rad * 0.6), 600);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials(a.name), p.x, p.y - rad * 0.02);

        // caption, tucked under the bubble
        const labelAlpha = sel || hov ? 0.95 : 0.5;
        ctx.fillStyle = `rgba(${T.inkRgb},${labelAlpha})`;
        ctx.font = MONO(10, sel || hov ? 600 : 500);
        ctx.textBaseline = "top";
        ctx.fillText(a.name, p.x, p.y + rad + 8);
        ctx.font = MONO(9);
        const statusLabel = (a.lastRun?.status ?? a.status).replace("_", " ");
        ctx.fillStyle = a.busy ? `${T.accent}dd` : T.ink4;
        ctx.fillText(statusLabel, p.x, p.y + rad + 21);

        // hover tooltip
        if (hov && !sel) {
          const l1 = a.name;
          const l2 = `${statusLabel} · ${a.model}`;
          const tw = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + 18;
          const tx = Math.min(Math.max(p.x, tw / 2 + 8), w - tw / 2 - 8);
          const ty = p.y - rad - 48;
          ctx.fillStyle = T.tip;
          ctx.strokeStyle = T.lineStrong;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(tx - tw / 2, ty, tw, 34, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = T.ink;
          ctx.textAlign = "left";
          ctx.font = MONO(10, 500);
          ctx.fillText(l1, tx - tw / 2 + 9, ty + 7);
          ctx.fillStyle = T.ink4;
          ctx.font = MONO(9);
          ctx.fillText(l2, tx - tw / 2 + 9, ty + 20);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  /* --------- interaction: pan, zoom, node drag, select --------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pick = (x: number, y: number) => {
      let best: { id: string; d2: number } | null = null;
      for (const hit of hitsRef.current) {
        const d2 = (hit.x - x) ** 2 + (hit.y - y) ** 2;
        if (d2 < (hit.r + 10) ** 2 && (!best || d2 < best.d2)) best = { id: hit.id, d2 };
      }
      return best;
    };

    // screen px → world coords, using the live render zoom so the node tracks
    // the cursor exactly even mid-zoom-animation
    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const cam = camRef.current;
      return {
        x: cam.x + (clientX - rect.left - rect.width / 2) / cam.zoom,
        y: cam.y + (clientY - rect.top - rect.height / 2) / cam.zoom,
      };
    };
    // freeze the whole map on release: every home commits to its live body,
    // every spring rest snaps to its live length, all velocities die.
    // zero stored tension anywhere → nothing can move after a drop.
    const freezeMap = () => {
      const homes = homeRef.current;
      for (const a of agentsRef.current) {
        const b = bodyRef.current.get(a.id);
        if (!b) continue;
        homes.set(a.id, { x: b.x, y: b.y });
        b.vx = 0;
        b.vy = 0;
        b.fx = 0;
        b.fy = 0;
      }
      for (const { parentId, childId } of pairsRef.current) {
        const cp = bodyRef.current.get(parentId);
        const cc = bodyRef.current.get(childId);
        if (!cp || !cc) continue;
        restRef.current.set(
          `${parentId}>${childId}`,
          Math.max(60, Math.hypot(cc.x - cp.x, cc.y - cp.y)),
        );
      }
      targetRef.current.clear();
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
      let gx = 0;
      let gy = 0;
      if (hit) {
        // grab offset: keep the exact grab point under the cursor (no center snap)
        const wpt = toWorld(e.clientX, e.clientY);
        const b = bodyRef.current.get(hit.id);
        if (b) {
          gx = b.x - wpt.x;
          gy = b.y - wpt.y;
        }
        targetRef.current.set(hit.id, { x: (b?.x ?? wpt.x), y: (b?.y ?? wpt.y) });
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
      canvas.style.cursor = hit ? "move" : "grabbing";
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, inside: true };
      const d = dragRef.current;
      if (!d.down) {
        const hit = pick(e.clientX - rect.left, e.clientY - rect.top);
        setHoveredId(hit?.id ?? null);
        canvas.style.cursor = hit ? "pointer" : "grab";
        return;
      }
      // dragging: node target follows the pointer in world space (live zoom, so
      // it tracks 1:1); pan moves the camera. Nothing is accumulated.
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      d.moved = Math.max(d.moved, Math.hypot(dx, dy));
      if (d.nid) {
        const wpt = toWorld(e.clientX, e.clientY);
        targetRef.current.set(d.nid, { x: wpt.x + d.gx, y: wpt.y + d.gy });
      } else {
        const zoom = camRef.current.zoom;
        camRef.current.x = d.panX - dx / zoom;
        camRef.current.y = d.panY - dy / zoom;
      }
    };

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d.down) return;
      const wasDrag = d.moved >= 5;
      const nid = d.nid;
      d.down = false;
      d.nid = null;
      canvas.style.cursor = "grab";
      // any node press ends in a full freeze — the map keeps its exact shape,
      // no spring tension survives the release, so nothing recoils
      if (nid) freezeMap();
      if (!wasDrag) {
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

    const onCancel = () => {
      const nid = dragRef.current.nid;
      if (nid) freezeMap();
      dragRef.current.down = false;
      dragRef.current.nid = null;
      canvas.style.cursor = "grab";
    };

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
      mouseRef.current.inside = false;
      setHoveredId(null);
    };

    canvas.addEventListener("pointerdown", onDown);
    // window-level move/up so a drag never dies at the canvas edge
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  const resetCam = useCallback(() => {
    camRef.current = { x: 0, y: 26, zoom: 0.95, targetZoom: 0.95 };
  }, []);

  /* --------- keyboard --------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDispatchOpen(false);
        setModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function takeControl() {
    if (!selected || bubble.goal.trim().length < 8 || bubble.sending) return;
    setBubble((b) => ({ ...b, sending: true, error: null }));
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: selected.id, goal: bubble.goal.trim(), mode: "live" }),
      });
      const payload = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !payload.runId) {
        setBubble((b) => ({ ...b, sending: false, error: payload.error ?? "Dispatch failed." }));
        return;
      }
      router.push(`/runs/${payload.runId}`);
    } catch (cause) {
      setBubble((b) => ({ ...b, sending: false, error: (cause as Error).message }));
    }
  }

  const busyCount = laid.filter((a) => a.busy).length;
  const activeCount = laid.filter((a) => (a.lastRun?.status ?? a.status) === "active").length;

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-void">
      {/* ---------- floating controls, inside the canvas ---------- */}
      <div className="pointer-events-none absolute left-4 top-3 z-10 flex items-center gap-3">
        <span className="mono text-[10px] text-ink-4">
          {laid.length} agents · {busyCount} running · {activeCount} healthy
        </span>
      </div>
      <div className="absolute right-4 top-3 z-10 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={resetCam} title="Reset view">
          <Maximize size={12} /> Center
        </Button>
        <Button variant="primary" size="sm" onClick={() => setDispatchOpen(true)}>
          <Plus size={13} /> Dispatch
        </Button>
      </div>

      {/* ---------- canvas ---------- */}
      <div ref={wrapRef} className="relative min-h-0 flex-1 select-none">
        {laid.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="mono text-[11px] text-ink-4">
              no agents in this workspace yet — dispatch one to populate the map
            </p>
          </div>
        ) : null}
        <canvas ref={canvasRef} className="absolute inset-0 cursor-grab touch-none" />
        <span className="mono pointer-events-none absolute bottom-3 left-4 text-[9px] text-ink-4">
          drag void to pan · scroll to zoom · drag a bubble — connected agents lag, then settle · click for details
        </span>

        {/* ---------- details drawer ---------- */}
        {modalOpen && selected ? (
          <aside className="animate-fade-up absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col border-l border-line bg-surface/95 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]"
                  style={{
                    borderColor: `${selected.halo}88`,
                    color: selected.halo,
                    background: `${selected.halo}14`,
                  }}
                >
                  {initials(selected.name)}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink">{selected.name}</div>
                  <div className="mono mt-0.5 truncate text-[10px] text-ink-4">
                    {selected.id} · {selected.role} · {selected.model}
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
                  <p className="text-[11px] text-ink-4">No task in the log — this bubble is idle.</p>
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
                        <p className="mono mt-1 text-[9px] text-ink-4">{relativeTime(task.at)} · run {task.runId}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* stats */}
              <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
                <div className="p-3">
                  <KeyValue label="Last run">
                    {selected.lastRun ? (
                      <Link href={`/runs/${selected.lastRun.id}`} className="focus-ring text-accent hover:underline">
                        {selected.lastRun.status} · {relativeTime(selected.lastRun.at)}
                      </Link>
                    ) : (
                      <span className="text-ink-4">never</span>
                    )}
                  </KeyValue>
                  <KeyValue label="Max steps">{selected.maxSteps}</KeyValue>
                </div>
                <div className="p-3">
                  <KeyValue label="Run ceiling">
                    {selected.budgetUsd ? `$${selected.budgetUsd.toFixed(2)}` : "workspace default"}
                  </KeyValue>
                  <KeyValue label="Spent">{`$${selected.spentUsd.toFixed(4)}`}</KeyValue>
                </div>
              </div>

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
                            ? T.danger
                            : selected.spentUsd / selected.budgetUsd > 0.7
                              ? T.warn
                              : T.accent,
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
                    <div className="micro mb-2">Direct reports · solid edges</div>
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
                {peers.length > 0 ? (
                  <>
                    <Divider className="my-3" />
                    <div className="micro mb-2">Peer mesh · dashed</div>
                    <div className="flex flex-wrap gap-1.5">
                      {peers.slice(0, 6).map((peer) => (
                        <button
                          key={peer.id}
                          type="button"
                          onClick={() => setSelectedId(peer.id)}
                          className="focus-ring mono rounded-xs border border-dashed border-line px-1.5 py-0.5 text-[10px] text-ink-3 hover:border-line-strong hover:text-ink"
                        >
                          {peer.name}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>

              {/* take control */}
              <div className="p-4">
                <div className="micro mb-2 flex items-center gap-1.5">
                  <Crosshair size={11} className="text-accent" /> take control
                </div>
                <p className="mb-2 text-[11px] leading-relaxed text-ink-4">
                  Send this agent a direct order. It dispatches as a run you can watch minute-by-minute in the trace, and you can follow the whole thing in its system view.
                </p>
                <textarea
                  value={bubble.agentId === selected.id ? bubble.goal : ""}
                  onChange={(e) => setBubble({ agentId: selected.id, goal: e.target.value, sending: false, error: null })}
                  rows={2}
                  placeholder={`Direct order for ${selected.name}…`}
                  className="focus-ring w-full resize-none rounded-sm border border-line-strong bg-surface-2 px-2.5 py-2 text-[12px] leading-relaxed text-ink placeholder:text-ink-4"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button variant="primary" size="sm" onClick={takeControl} disabled={bubble.goal.trim().length < 8 || bubble.sending}>
                    {bubble.sending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    {bubble.sending ? "Dispatching" : "Pilot agent"}
                  </Button>
                </div>
                {bubble.agentId === selected.id && bubble.error ? (
                  <p className="mt-2 rounded-xs border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">{bubble.error}</p>
                ) : null}
              </div>
            </div>

            {/* view system (the live VSCode-like console) */}
            <div className="grid grid-cols-2 divide-x divide-line border-t border-line">
              <Link href={`/agents/${selected.id}/console`} className="block hover:bg-surface-2">
                <div className="p-3">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                    <Terminal size={12} className="text-accent" /> View System
                  </div>
                  <p className="mono mt-1 text-[9.5px] text-ink-4">live files · tools · chat</p>
                </div>
              </Link>
              <Link href={`/agents/${selected.id}`} className="block border-l border-line hover:bg-surface-2">
                <div className="p-3">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                    {selected.role === "orchestrator" ? (
                      <Crown size={12} className="text-accent" />
                    ) : selected.role === "security" ? (
                      <ShieldHalf size={12} className="text-audit" />
                    ) : (
                      <Boxes size={12} className="text-ink-3" />
                    )}
                    Profile
                  </div>
                  <p className="mono mt-1 text-[9.5px] text-ink-4">grants · policy · history</p>
                </div>
              </Link>
            </div>
          </aside>
        ) : null}
      </div>

      {/* ---------- dispatch modal ---------- */}
      {dispatchOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 p-4 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDispatchOpen(false);
          }}
        >
          <div className="animate-fade-up w-full max-w-lg">
            <Panel>
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div>
                  <div className="panel-title flex items-center gap-2">
                    <Play size={13} className="text-accent" /> Dispatch a new burst
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-4">
                    Pick a root or a specialist. Its bubble lights up the moment the run starts.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDispatchOpen(false)}
                  className="focus-ring rounded-xs p-1 text-ink-4 hover:bg-surface-2 hover:text-ink"
                  aria-label="Close dispatch"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="p-4">
                <DispatchPanel
                  compact
                  agents={dispatchAgents}
                  defaultAgentId={selected && selected.status === "active" ? selected.id : undefined}
                />
              </div>
            </Panel>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HaloDot({ c }: { c: string }) {
  return <span className="size-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />;
}
