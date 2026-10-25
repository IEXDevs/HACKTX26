"use client";

import { useEffect, useState } from "react";
import GradientWaves from "@/components/ui/GradientWaves";

type Mode = "light" | "dark";

/**
 * The site's green, in waves. Light is a white page tinted by the greens of
 * the old backdrop; dark is its green, teal and blue band glowing on near-black.
 */
const PALETTE: Record<Mode, { horizon: string; wave: string; crest: string; light: boolean }> = {
  light: { horizon: "#8fd4a8", wave: "#2f9a62", crest: "#e2eee5", light: true },
  dark: { horizon: "#166b66", wave: "#2aa874", crest: "#9be8bd", light: false },
};

function themeNow(): Mode {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function SiteBackdrop() {
  // The markup does not depend on the theme, so reading it here cannot mismatch the server's.
  const [mode, setMode] = useState<Mode>(() => (typeof document === "undefined" ? "light" : themeNow()));

  useEffect(() => {
    setMode(themeNow());
    const watch = new MutationObserver(() => setMode(themeNow()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, []);

  const p = PALETTE[mode];
  return (
    <GradientWaves
      horizonColor={p.horizon}
      waveColor={p.wave}
      crestColor={p.crest}
      lightMode={p.light}
      speed={0.4}
      amplitude={2.5}
      relief={1}
      lightAngle={120}
      mouseInteraction
      swellOnClick
      // A soft full-page backdrop does not need retina pixels, which would be four times the work.
      dpr={1}
    />
  );
}
