"use client";

import { useAutoRefresh } from "./use-auto-refresh";

/** Re-read a server page on an interval so live ledgers keep moving. */
export function LiveRefresh({
  intervalMs = 4000,
  active = true,
}: {
  intervalMs?: number;
  active?: boolean;
}) {
  useAutoRefresh(active, intervalMs);
  return null;
}
