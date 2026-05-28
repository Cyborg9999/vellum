export type ThemeMode = "system" | "dark" | "light" | "gray";
export type ResolvedTheme = "dark" | "light" | "gray";

const STORAGE_KEY = "vellum.themeMode";
const EVENT_NAME = "vellum-theme-change";

let mediaListenerInstalled = false;

export function getThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (
      stored === "system" ||
      stored === "dark" ||
      stored === "light" ||
      stored === "gray"
    ) {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return "system";
}

export function getResolvedTheme(mode = getThemeMode()): ResolvedTheme {
  if (mode === "light" || mode === "dark" || mode === "gray") return mode;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const resolved = getResolvedTheme(mode);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme =
    resolved === "dark" ? "dark" : "light";
  window.dispatchEvent(
    new CustomEvent(EVENT_NAME, { detail: { mode, resolved } })
  );
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  applyThemeMode(mode);
}

export function initTheme(): void {
  applyThemeMode(getThemeMode());
  if (mediaListenerInstalled || typeof window === "undefined") return;
  mediaListenerInstalled = true;
  window
    .matchMedia("(prefers-color-scheme: light)")
    .addEventListener("change", () => {
      if (getThemeMode() === "system") applyThemeMode("system");
    });
}

export function subscribeTheme(
  listener: (state: { mode: ThemeMode; resolved: ResolvedTheme }) => void
): () => void {
  const onTheme = (e: Event) => {
    const detail = (e as CustomEvent).detail as
      | { mode: ThemeMode; resolved: ResolvedTheme }
      | undefined;
    listener({
      mode: detail?.mode ?? getThemeMode(),
      resolved: detail?.resolved ?? getResolvedTheme(),
    });
  };
  window.addEventListener(EVENT_NAME, onTheme);
  return () => window.removeEventListener(EVENT_NAME, onTheme);
}
