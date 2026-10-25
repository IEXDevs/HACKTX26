import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Check, LoaderCircle, X } from "@/components/icons";

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

export type Tone =
  | "accent"
  | "ok"
  | "warn"
  | "danger"
  | "info"
  | "audit"
  | "muted";

const toneText: Record<Tone, string> = {
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-info",
  audit: "text-audit",
  muted: "text-ink-3",
};

const toneBg: Record<Tone, string> = {
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  audit: "bg-audit",
  muted: "bg-ink-3",
};

const toneSoft: Record<Tone, string> = {
  accent: "border-accent/30 bg-accent/10 text-accent",
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/30 bg-danger/10 text-danger",
  info: "border-info/30 bg-info/10 text-info",
  audit: "border-audit/30 bg-audit/10 text-audit",
  muted: "border-line bg-surface-2 text-ink-3",
};

const STATUS_TONES: Record<string, Tone> = {
  running: "accent",
  thinking: "accent",
  working: "accent",
  succeeded: "ok",
  done: "ok",
  approved: "ok",
  connected: "ok",
  active: "ok",
  passed: "ok",
  fixed: "ok",
  queued: "info",
  pending: "warn",
  awaiting_approval: "warn",
  blocked: "warn",
  degraded: "warn",
  paused: "warn",
  draft: "muted",
  idle: "muted",
  disconnected: "muted",
  skipped: "muted",
  archived: "muted",
  failed: "danger",
  denied: "danger",
  halted: "danger",
  cancelled: "danger",
  expired: "danger",
  open: "danger",
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "info",
  info: "muted",
};

export function toneFor(status: string): Tone {
  return STATUS_TONES[status] ?? "muted";
}

/** A small glyph for a state: check, cross, "!" or a spinning arc. No colored dots. */
export function StatusDot({
  status,
  tone,
  className,
}: {
  status?: string;
  tone?: Tone;
  className?: string;
}) {
  const resolved = tone ?? (status ? toneFor(status) : "muted");
  const live = status === "running" || status === "thinking" || status === "working";
  if (live) return <LoaderCircle size={12} className={cn("shrink-0 animate-spin", toneText[resolved], className)} />;
  if (resolved === "ok") return <Check size={12} strokeWidth={2.2} className={cn("shrink-0", toneText.ok, className)} />;
  if (resolved === "danger") return <X size={12} strokeWidth={2.2} className={cn("shrink-0", toneText.danger, className)} />;
  if (resolved === "warn")
    return (
      <span aria-hidden className={cn("shrink-0 text-[11px] font-bold leading-none", toneText.warn, className)}>
        !
      </span>
    );
  return null;
}

/** A calm state label: soft pill, sentence case, an optional glyph. */
export function StatusBadge({
  status,
  label,
  tone,
  className,
}: {
  status?: string;
  label?: string;
  tone?: Tone;
  className?: string;
}) {
  const resolved = tone ?? (status ? toneFor(status) : "muted");
  const text = label ?? status?.replaceAll("_", " ") ?? "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium",
        toneSoft[resolved],
        "border-transparent",
        className,
      )}
    >
      <StatusDot status={status} tone={resolved} />
      {text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Typography helpers                                                         */
/* -------------------------------------------------------------------------- */

export function MicroLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("micro", className)}>{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="min-w-0">
        {eyebrow ? <MicroLabel className="mb-2">{eyebrow}</MicroLabel> : null}
        <h1 className="text-[22px] font-medium leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

export function Panel({
  children,
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div className={cn("panel", className)} {...props}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Metrics                                                                    */
/* -------------------------------------------------------------------------- */

export function Meter({
  value,
  tone = "accent",
  className,
  label,
}: {
  /** 0..1 */
  value: number;
  tone?: Tone;
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      className={cn("h-1 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-label={label}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", toneBg[tone])}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                       */
/* -------------------------------------------------------------------------- */

export function Tag({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.02em]",
        toneSoft[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/* -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink hover:bg-accent/90 border border-accent/60 shadow-[0_0_0_1px_rgba(198,242,78,0.12)]",
  secondary:
    "bg-surface-2 text-ink border border-line-strong hover:bg-surface-3 hover:border-line-strong",
  ghost: "bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink border border-transparent",
  outline:
    "bg-transparent text-ink border border-line-strong hover:border-accent/50 hover:text-accent",
  danger:
    "bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[11px] gap-1.5 rounded-xs",
  md: "h-8 px-3 text-[12px] gap-2 rounded-sm",
};

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    "focus-ring inline-flex select-none items-center justify-center font-medium transition-colors disabled:pointer-events-none disabled:opacity-45",
    buttonVariants[variant],
    buttonSizes[size],
    className,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={buttonClass(variant, size, className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-line", className)} />;
}

export function KeyValue({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", className)}>
      <span className="text-[11px] text-ink-3">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] text-ink-2">{children}</span>
    </div>
  );
}