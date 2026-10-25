"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "@/components/icons";
import { readChoice, saveChoice, THEME_EVENT, type ThemeChoice } from "@/lib/theme";

const CHOICES: Array<{ value: ThemeChoice; label: string; hint: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", hint: "Paper surfaces, daylight canvas", Icon: Sun },
  { value: "dark", label: "Dark", hint: "Low light, same green marks", Icon: Moon },
  { value: "system", label: "System", hint: "Matches your device, day and night", Icon: Monitor },
];

/** Light / dark / system picker for Settings. */
export function AppearanceControl() {
  // Unknown until the browser's saved pick is read, so nothing is marked early.
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    const sync = () => setChoice(readChoice());
    sync();
    window.addEventListener(THEME_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(THEME_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <div className="appearance-picks" role="group" aria-label="Color theme">
      {CHOICES.map(({ value, label, hint, Icon }) => (
        <button
          key={value}
          type="button"
          className="appearance-pick"
          aria-pressed={choice === value}
          onClick={() => saveChoice(value)}
        >
          <Icon size={18} aria-hidden />
          <b>{label}</b>
          <small>{hint}</small>
        </button>
      ))}
    </div>
  );
}
