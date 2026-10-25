"use client";
import { useEffect, useRef, useState } from 'react';
import type { UsageView } from "@/lib/views";

type UsageCharts = Pick<UsageView, "overTime" | "byAgent" | "byWorkflow">;

type View = 'time' | 'agent' | 'workflow';
const views: { id: View; name: string }[] = [
  { id: 'time', name: 'Over time' },
  { id: 'agent', name: 'By agent' },
  { id: 'workflow', name: 'By workflow' },
];
// Validated categorical slots (colorblind-safe in this order); Other stays neutral.
const slotColors = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const otherColor = '#a8a59e';

export function compact(n: number) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(n);
}
function percent(part: number, total: number) {
  const p = total ? (part / total) * 100 : 0;
  return (p < 10 ? Math.round(p * 10) / 10 : Math.round(p)) + '%';
}

export function UsageChart({ charts, heading = "Tokens used", unit = "tokens" }: { charts: UsageCharts; heading?: string; unit?: string }) {
  const [view, setView] = useState<View>('time');
  const total = charts.overTime.reduce((sum, p) => sum + p.tokens, 0);
  return (
    <section className="token-chart" aria-label="Token usage">
      <div className="token-chart-head">
        <div>
          <h2>{heading}</h2>
            <strong>{unit === "$" ? `$${total.toFixed(2)}` : compact(total)}</strong>
        </div>
        <div className="tabs" role="group" aria-label="Chart view">
          {views.map((v) => (
            <button key={v.id} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
              {v.name}
            </button>
          ))}
        </div>
      </div>
      {view === 'time' && <OverTime points={charts.overTime} unit={unit} />}
      {view === 'agent' && <ByAgent shares={charts.byAgent} unit={unit} />}
      {view === 'workflow' && <ByWorkflow shares={charts.byWorkflow} unit={unit} />}
    </section>
  );
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((m) => m * power).find((m) => m >= value) || value;
}

function OverTime({ points, unit }: { points: UsageCharts['overTime']; unit: string }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const height = 220,
    pad = { l: 44, r: 12, t: 12, b: 28 };
  const max = niceMax(Math.max(...points.map((p) => p.tokens)));
  const x = (i: number) => pad.l + (i * (width - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const line = points.map((p, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(p.tokens)).join(' ');
  const area = line + ` L${x(points.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`;
  const labels = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  function pick(clientX: number, rect: DOMRect) {
    const ratio = (clientX - rect.left - pad.l) / (rect.width - pad.l - pad.r);
    setActive(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  }
  const hover = active === null ? null : points[active];
  return (
    <div className="usage-plot" ref={ref}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Tokens over time, ${points[0]?.label} to ${points.at(-1)?.label}. Peak ${compact(Math.max(...points.map((p) => p.tokens)))}.`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const step = e.key === 'ArrowRight' ? 1 : -1;
            setActive((a) => Math.max(0, Math.min(points.length - 1, (a ?? -step) + step)));
          }
        }}
        onBlur={() => setActive(null)}
      >
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line className="usage-grid" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
            <text className="usage-tick" x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {compact(t)}
            </text>
          </g>
        ))}
        {labels.map((i) => (
          <text
            key={i}
            className="usage-tick"
            x={x(i)}
            y={height - 8}
            textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
          >
            {points[i]?.label}
          </text>
        ))}
        <path className="usage-area" d={area} />
        <path className="usage-line" d={line} />
        {hover && active !== null && (
          <g>
            <line className="usage-cross" x1={x(active)} x2={x(active)} y1={pad.t} y2={y(0)} />
            <circle className="usage-dot" cx={x(active)} cy={y(hover.tokens)} r={5} />
          </g>
        )}
        <rect
          x={pad.l}
          y={0}
          width={Math.max(0, width - pad.l - pad.r)}
          height={height}
          fill="transparent"
          onPointerMove={(e) =>
            pick(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect())
          }
          onPointerLeave={() => setActive(null)}
        />
      </svg>
      {hover && active !== null && (
        <div
          className="usage-tooltip"
          style={{ left: Math.min(Math.max(x(active), 70), width - 70), top: y(hover.tokens) - 12 }}
        >
          <b>{unit === "$" ? `$${hover.tokens.toFixed(2)}` : `${hover.tokens.toLocaleString()} ${unit}`}</b>
          <span>{hover.label}</span>
        </div>
      )}
    </div>
  );
}

function arc(cx: number, cy: number, r: number, inner: number, start: number, end: number) {
  const p = (radius: number, angle: number) =>
    [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)].join(' ');
  const large = end - start > Math.PI ? 1 : 0;
  return `M${p(r, start)} A${r} ${r} 0 ${large} 1 ${p(r, end)} L${p(inner, end)} A${inner} ${inner} 0 ${large} 0 ${p(inner, start)} Z`;
}

function ByAgent({ shares, unit }: { shares: UsageCharts['byAgent']; unit: string }) {
  const [active, setActive] = useState<string | null>(null);
  // The four largest agents get named slices; the rest fold into Other.
  // Slices keep the data's stable agent order, so colors follow the agent, not its rank.
  const named = new Set(
    [...shares]
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, slotColors.length)
      .map((s) => s.id),
  );
  const rest = shares.filter((s) => !named.has(s.id));
  const slices = [
    ...shares
      .filter((s) => named.has(s.id))
      .map((s, i) => ({
        id: s.id,
        name: s.name,
        tokens: s.tokens,
        color: slotColors[i] ?? otherColor,
      })),
    ...(rest.length
      ? [
          {
            id: 'other',
            name: rest.length === 1 ? rest[0]!.name : rest.length + ' other agents',
            tokens: rest.reduce((sum, s) => sum + s.tokens, 0),
            color: otherColor,
          },
        ]
      : []),
  ].filter((s) => s.tokens > 0);
  const total = slices.reduce((sum, s) => sum + s.tokens, 0);
  let angle = 0;
  const segments = slices.map((s) => {
    const start = angle;
    angle += total ? (s.tokens / total) * Math.PI * 2 : 0;
    return { ...s, start, end: angle };
  });
  const hover = slices.find((s) => s.id === active);
  return (
    <div className="usage-donut">
      <svg
        width="200"
        height="200"
        viewBox="0 0 200 200"
        role="img"
        aria-label="Token share by agent"
      >
        {segments.map((s) => (
          <path
            key={s.id}
            d={
              s.end - s.start >= Math.PI * 2 - 1e-6
                ? arc(100, 100, 92, 60, 0, Math.PI * 2 - 1e-4)
                : arc(100, 100, 92, 60, s.start, s.end)
            }
            fill={s.color}
            className={active && active !== s.id ? 'dim' : ''}
            onPointerEnter={() => setActive(s.id)}
            onPointerLeave={() => setActive(null)}
          />
        ))}
        <text x="100" y="98" textAnchor="middle" className="usage-donut-value">
          {hover ? percent(hover.tokens, total) : compact(total)}
        </text>
        <text x="100" y="118" textAnchor="middle" className="usage-donut-label">
          {hover ? 'of tokens' : 'tokens'}
        </text>
      </svg>
      <ul className="usage-legend">
        {slices.map((s) => (
          <li
            key={s.id}
            className={active && active !== s.id ? 'dim' : ''}
            onPointerEnter={() => setActive(s.id)}
            onPointerLeave={() => setActive(null)}
          >
            <i style={{ background: s.color }} aria-hidden="true" />
            <span>{s.name}</span>
            <span className="usage-legend-tokens">{unit === "$" ? `$${s.tokens.toFixed(2)}` : compact(s.tokens)}</span>
            <b>{percent(s.tokens, total)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ByWorkflow({ shares, unit }: { shares: UsageCharts['byWorkflow']; unit: string }) {
  const sorted = [...shares].sort((a, b) => b.tokens - a.tokens);
  const top = sorted.slice(0, 5),
    rest = sorted.slice(5);
  const rows = rest.length
    ? [
        ...top,
        {
          id: 'other',
          name: rest.length + ' other workflows',
          tokens: rest.reduce((sum, r) => sum + r.tokens, 0),
        },
      ]
    : top;
  const total = rows.reduce((sum, r) => sum + r.tokens, 0);
  const max = Math.max(1, ...rows.map((r) => r.tokens));
  return (
    <ul className="usage-bars" aria-label="Token share by workflow">
      {rows.map((r) => (
        <li key={r.id} title={r.tokens.toLocaleString() + ' tokens'}>
          <span className="usage-bar-name">{r.name}</span>
          <span className="usage-bar-track" aria-hidden="true">
            <i
              className={r.id === 'other' ? 'other' : ''}
              style={{ width: (r.tokens / max) * 100 + '%' }}
            />
          </span>
          <b>{percent(r.tokens, total)}</b>
          <span className="usage-legend-tokens">{unit === "$" ? `$${r.tokens.toFixed(2)}` : compact(r.tokens)}</span>
        </li>
      ))}
    </ul>
  );
}
