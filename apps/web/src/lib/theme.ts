/**
 * Color theme. People pick Light, Dark, or System (follow the device). The pick
 * is saved in the browser; with nothing saved, the site follows the device.
 *
 * `html[data-theme="dark"]` always holds the resolved result and light has no
 * attribute, so the CSS, the graph, and the backdrop never need to know about
 * System. No React in here: the layout needs THEME_SCRIPT on the server, and
 * the Settings picker needs the rest in the browser.
 */
export type ThemeChoice = "light" | "dark" | "system";

export const THEME_KEY = "relay-theme";
/** Fired on window when the pick changes in this tab. Other tabs get "storage". */
export const THEME_EVENT = "relay-theme";

/** What the page should look like for a saved pick and the device's setting. */
export function resolveTheme(saved: string | null, systemDark: boolean): "light" | "dark" {
  if (saved === "dark") return "dark";
  if (saved === "light") return "light";
  return systemDark ? "dark" : "light";
}

export function readChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

/** Set `data-theme` from the saved pick and the device's current setting. */
export function applyTheme(): void {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    /* private mode: follow the device */
  }
  const dark = resolveTheme(saved, matchMedia("(prefers-color-scheme: dark)").matches) === "dark";
  if (dark) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

export function saveChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* private mode: applies for this visit only */
  }
  applyTheme();
  window.dispatchEvent(new Event(THEME_EVENT));
}

/**
 * Runs in <head> before first paint so the page never flashes the wrong theme,
 * then keeps following the device while the pick is System, and other tabs.
 * Keep it in step with resolveTheme(); theme.test.ts runs both side by side.
 */
export const THEME_SCRIPT = `(function(){try{
var m=matchMedia("(prefers-color-scheme: dark)");
function apply(){
var s=null;try{s=localStorage.getItem("${THEME_KEY}")}catch(e){}
var d=s==="dark"||(s!=="light"&&m.matches);
if(d)document.documentElement.dataset.theme="dark";else delete document.documentElement.dataset.theme;
}
apply();
m.addEventListener("change",apply);
window.addEventListener("storage",apply);
}catch(e){}})();`;
