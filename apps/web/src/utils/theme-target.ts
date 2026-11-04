import { getHostRuntime } from "../embed/host-runtime";

declare global {
  // Set by the embeddable library entry before any editor module runs.
  // eslint-disable-next-line no-var
  var __OPENREEL_EMBEDDED__: boolean | undefined;
}

/**
 * Put the light/dark markers where the editor's styles look for them: on the
 * embedded editor root, or on the document for the standalone app. In the
 * embeddable build the host page's `<html>` is never touched.
 */
export function applyThemeAttributes(isDark: boolean): void {
  if (typeof document === "undefined") return;
  const runtime = getHostRuntime();
  const target = runtime?.root ?? (globalThis.__OPENREEL_EMBEDDED__ ? null : document.documentElement);
  if (!target) return;
  target.classList.toggle("dark", isDark);
  target.dataset.theme = isDark ? "dark" : "light";
}
