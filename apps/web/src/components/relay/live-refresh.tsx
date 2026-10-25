"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-read a server page on an interval so live ledgers keep moving. */
export function LiveRefresh({
  intervalMs = 4000,
  active = true,
}: {
  intervalMs?: number;
  active?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}
