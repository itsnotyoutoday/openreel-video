import { getHostRuntime } from "../embed/host-runtime";

/**
 * Read a CSS custom property for canvas drawing, where Tailwind classes cannot
 * reach. Resolves against the embedded editor root when there is one, else the
 * document, and returns `fallback` when the token is not defined (for example
 * in tests).
 */
export function readCssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const element = getHostRuntime()?.root ?? document.documentElement;
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value || fallback;
}
