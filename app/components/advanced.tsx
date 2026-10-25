'use client';
import { useEffect, useState } from 'react';

// One per-viewer preference for every page. Advanced shows timing, models and breakdowns.
const key = 'relay-advanced';
export function useAdvanced() {
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    try {
      setAdvanced(localStorage.getItem(key) === '1');
    } catch {}
  }, []);
  function toggle() {
    setAdvanced(!advanced);
    try {
      localStorage.setItem(key, advanced ? '0' : '1');
    } catch {}
  }
  return [advanced, toggle] as const;
}

export function AdvancedSwitch({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <button className="simple-switch" aria-pressed={on} onClick={toggle}>
      Advanced
      <span>
        <i />
      </span>
    </button>
  );
}
