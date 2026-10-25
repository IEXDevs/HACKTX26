/**
 * Provider marks drawn in the middle of each node, in a single color.
 *
 * These are simple stand-ins drawn with canvas strokes, not the official logo
 * files. To use official artwork, replace a provider's function with a Path2D
 * built from its SVG path data; every function draws into a box of `size`
 * centered on (x, y).
 */
type Mark = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => void;

/** Meta: a soft infinity loop. */
const meta: Mark = (ctx, x, y, size) => {
  const a = size * 0.5;
  ctx.beginPath();
  for (let i = 0; i <= 96; i += 1) {
    const t = (i / 96) * Math.PI * 2;
    const d = 1 + Math.sin(t) ** 2;
    const px = x + (a * Math.cos(t)) / d;
    const py = y + (a * 1.25 * Math.sin(t) * Math.cos(t)) / d;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.lineWidth = size * 0.14;
  ctx.stroke();
};

/** Anthropic: a bold, open "A". */
const anthropic: Mark = (ctx, x, y, size) => {
  const s = size * 0.5;
  ctx.lineWidth = size * 0.15;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.78, y + s * 0.8);
  ctx.lineTo(x - s * 0.08, y - s * 0.8);
  ctx.lineTo(x + s * 0.08, y - s * 0.8);
  ctx.lineTo(x + s * 0.78, y + s * 0.8);
  ctx.moveTo(x - s * 0.4, y + s * 0.22);
  ctx.lineTo(x + s * 0.4, y + s * 0.22);
  ctx.stroke();
};

/** OpenAI: six interlocking petals. */
const openai: Mark = (ctx, x, y, size) => {
  const r = size * 0.18;
  ctx.lineWidth = size * 0.09;
  for (let i = 0; i < 6; i += 1) {
    const angle = (i * Math.PI) / 3;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.roundRect(-r, -size * 0.46, r * 2, size * 0.46, r);
    ctx.stroke();
    ctx.restore();
  }
};

/** Google: a "G". */
const google: Mark = (ctx, x, y, size) => {
  const r = size * 0.4;
  ctx.lineWidth = size * 0.15;
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI * 0.22, Math.PI * 1.72);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + size * 0.02, y);
  ctx.stroke();
};

/** Self-hosted: a server stack. */
const selfhost: Mark = (ctx, x, y, size) => {
  const w = size * 0.78;
  const h = size * 0.22;
  ctx.lineWidth = size * 0.09;
  for (let i = -1; i <= 1; i += 1) {
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y + i * h * 1.25 - h / 2, w, h, h * 0.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w * 0.3, y + i * h * 1.25, size * 0.03, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** Unknown provider: a four-point spark. */
const unknown: Mark = (ctx, x, y, size) => {
  const s = size * 0.42;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
};

const MARKS: Record<string, Mark> = { meta, anthropic, openai, google, selfhost };

export function drawModelMark(
  ctx: CanvasRenderingContext2D,
  provider: string,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  (MARKS[provider] ?? unknown)(ctx, x, y, size);
  ctx.restore();
}
