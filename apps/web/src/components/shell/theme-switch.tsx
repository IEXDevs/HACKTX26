"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "@/components/icons";

function readDark(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

const THEME_EVENT = "relay-theme";

function writeTheme(dark: boolean) {
  if (dark) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem("relay-theme", dark ? "dark" : "light");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(readDark());
    sync();
    window.addEventListener(THEME_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(THEME_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  function setTheme(next: boolean) {
    writeTheme(next);
  }
  return { dark, setTheme, toggle: () => setTheme(!dark) };
}

/** Compact control for the sidebar. */
export function ThemeSwitch() {
  const { dark, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle} title={dark ? "Light theme" : "Dark theme"}>
      {dark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
      <span>{dark ? "Light theme" : "Dark theme"}</span>
    </button>
  );
}

/** Light / dark picker for Settings. */
export function AppearanceControl() {
  const { dark, setTheme } = useTheme();
  return (
    <div className="appearance-picks" role="group" aria-label="Color theme">
      <button
        type="button"
        className="appearance-pick"
        aria-pressed={!dark}
        onClick={() => setTheme(false)}
      >
        <Sun size={18} aria-hidden />
        <b>Light</b>
        <small>Paper surfaces, daylight canvas</small>
      </button>
      <button
        type="button"
        className="appearance-pick"
        aria-pressed={dark}
        onClick={() => setTheme(true)}
      >
        <Moon size={18} aria-hidden />
        <b>Dark</b>
        <small>Low light, same green marks</small>
      </button>
    </div>
  );
}
