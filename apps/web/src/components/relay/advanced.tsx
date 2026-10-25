"use client";

import { useEffect, useState } from "react";

// One per-viewer preference for every page. Advanced shows timing, models and breakdowns.
const key = "relay-advanced";

export function useAdvanced() {
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        setAdvanced(localStorage.getItem(key) === "1");
      } catch {}
    };
    read();
    // Keep every switch on the page in step.
    window.addEventListener(key, read);
    return () => window.removeEventListener(key, read);
  }, []);
  function toggle() {
    try {
      localStorage.setItem(key, advanced ? "0" : "1");
    } catch {}
    window.dispatchEvent(new Event(key));
    setAdvanced(!advanced);
  }
  return [advanced, toggle] as const;
}

export function AdvancedSwitch({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <button type="button" className="switch" aria-pressed={on} onClick={toggle}>
      Advanced
      <span>
        <i />
      </span>
    </button>
  );
}
