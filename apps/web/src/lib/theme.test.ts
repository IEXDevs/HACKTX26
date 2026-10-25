import { describe, expect, it } from "vitest";
import { resolveTheme, THEME_KEY, THEME_SCRIPT } from "./theme";

describe("theme resolution", () => {
  it("follows the device unless a pick is saved", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    // Anything unrecognised counts as no pick.
    expect(resolveTheme("sepia", true)).toBe("dark");
  });

  it("keeps an explicit pick whatever the device says", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

/** Runs THEME_SCRIPT against a stand-in browser and returns the page's theme afterwards. */
function runScript(env: { saved?: string; systemDark: boolean; storageBroken?: boolean }) {
  const dataset: Record<string, string> = {};
  const media = {
    matches: env.systemDark,
    listeners: [] as Array<() => void>,
    addEventListener(_type: string, fn: () => void) {
      this.listeners.push(fn);
    },
  };
  const windowListeners: Record<string, () => void> = {};
  let saved = env.saved ?? null;
  new Function("document", "localStorage", "matchMedia", "window", THEME_SCRIPT)(
    { documentElement: { dataset } },
    {
      getItem(key: string) {
        if (env.storageBroken) throw new Error("blocked");
        return key === THEME_KEY ? saved : null;
      },
    },
    () => media,
    { addEventListener: (type: string, fn: () => void) => (windowListeners[type] = fn) },
  );
  return {
    theme: () => dataset.theme ?? "light",
    deviceChanges(dark: boolean) {
      media.matches = dark;
      media.listeners.forEach((fn) => fn());
    },
    saves(value: string) {
      saved = value;
      windowListeners.storage?.();
    },
  };
}

describe("pre-paint theme script", () => {
  it("agrees with resolveTheme for every saved pick and device setting", () => {
    for (const saved of [undefined, "light", "dark", "system", "sepia"]) {
      for (const systemDark of [true, false]) {
        const page = runScript({ saved, systemDark });
        expect(page.theme(), `saved=${saved} systemDark=${systemDark}`).toBe(resolveTheme(saved ?? null, systemDark));
      }
    }
  });

  it("defaults to the device when nothing is saved, and follows it live", () => {
    const page = runScript({ systemDark: false });
    expect(page.theme()).toBe("light");
    page.deviceChanges(true);
    expect(page.theme()).toBe("dark");
    page.deviceChanges(false);
    expect(page.theme()).toBe("light");
  });

  it("ignores device changes once a pick is saved", () => {
    const page = runScript({ saved: "light", systemDark: false });
    page.deviceChanges(true);
    expect(page.theme()).toBe("light");
  });

  it("follows a pick changed in another tab", () => {
    const page = runScript({ systemDark: false });
    page.saves("dark");
    expect(page.theme()).toBe("dark");
    page.saves("system");
    expect(page.theme()).toBe("light");
  });

  it("still follows the device when the browser blocks storage", () => {
    expect(runScript({ systemDark: true, storageBroken: true }).theme()).toBe("dark");
    expect(runScript({ systemDark: false, storageBroken: true }).theme()).toBe("light");
  });
});
