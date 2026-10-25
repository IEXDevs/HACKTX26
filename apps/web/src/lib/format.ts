export function usd(value: number, opts?: { precise?: boolean }): string {
  if (!Number.isFinite(value)) return "$—";
  if (opts?.precise || (value > 0 && value < 0.01)) {
    return `$${value.toFixed(4)}`;
  }
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

const currencyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Dollars to the cent with grouping, e.g. "$1,234.50". */
export function money(value: number): string {
  return currencyFormat.format(value);
}

export function tokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

const RELATIVE_UNITS: Array<[number, Intl.RelativeTimeFormatUnit]> = [
  [1000 * 60 * 60 * 24 * 365, "year"],
  [1000 * 60 * 60 * 24 * 30, "month"],
  [1000 * 60 * 60 * 24, "day"],
  [1000 * 60 * 60, "hour"],
  [1000 * 60, "minute"],
  [1000, "second"],
];

// Built once: constructing an Intl formatter per call is costly in long lists.
const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

export function relativeTime(date: Date | number | string | null | undefined): string {
  if (!date) return "—";
  const ms = typeof date === "number" ? date : new Date(date).getTime();
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const future = diff < 0;

  for (const [size, unit] of RELATIVE_UNITS) {
    if (abs >= size || unit === "second") {
      const value = Math.round(diff / size);
      return relativeFormat.format(future ? -Math.abs(value) : -value, unit);
    }
  }
  return "now";
}

export function clockTime(date: Date | number | string | null | undefined): string {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
