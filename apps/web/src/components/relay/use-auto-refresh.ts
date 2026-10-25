"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the server page every `ms` while `active`, so live work stays current without a reload. */
export function useAutoRefresh(active: boolean, ms: number): void {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), ms);
    return () => clearInterval(timer);
  }, [active, ms, router]);
}
