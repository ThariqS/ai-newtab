/**
 * Three-way colour scheme: follow the system, or force dark or light.
 *
 * The preference is applied as `data-theme` on `<html>` (absent means
 * "system"); styles.css resolves the tokens from there. It is persisted in
 * chrome.storage.local like every other setting, and mirrored to
 * localStorage so the next new tab can apply it before React renders.
 */
export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

/** The order the toggle cycles through. */
export const THEME_ORDER: ThemePreference[] = ["system", "dark", "light"];

export const THEME_STORAGE_KEY = "theme";
const MIRROR_KEY = "ai-homepage:theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "dark" || value === "light";
}

export function nextTheme(current: ThemePreference): ThemePreference {
  return THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
}

export function systemTheme(): ResolvedTheme {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

/** Set `data-theme` on <html> (or remove it for "system") and remember the choice locally. */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;
  try {
    localStorage.setItem(MIRROR_KEY, preference);
  } catch {
    // Storage can be unavailable (private window); the chrome.storage copy still applies on load.
  }
}

/** The locally mirrored preference, for applying before the first paint. */
export function mirroredTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(MIRROR_KEY);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

export async function loadThemePreference(): Promise<ThemePreference> {
  const result = await browser.storage.local.get(THEME_STORAGE_KEY);
  const value = result[THEME_STORAGE_KEY];
  return isThemePreference(value) ? value : "system";
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  await browser.storage.local.set({ [THEME_STORAGE_KEY]: preference });
}

/** Call `listener` whenever the resolved theme would change while following the system. */
export function onSystemThemeChange(listener: (theme: ResolvedTheme) => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const query = matchMedia("(prefers-color-scheme: dark)");
  const handler = (event: MediaQueryListEvent) => listener(event.matches ? "dark" : "light");
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}
