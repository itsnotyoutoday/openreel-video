import { useLayoutEffect, type ReactElement, type ReactNode } from "react";
import { useThemeStore } from "../stores/theme-store";

/**
 * The attributes Astryx's root `Theme` writes to `<html>`. A host page may use
 * the same names, so an embedded editor puts them back as it found them.
 */
const ATTRIBUTES = ["data-theme", "data-astryx-theme"] as const;
type Snapshot = Record<(typeof ATTRIBUTES)[number], string | null>;

export interface HtmlGuard {
  /** Remember the current attributes. */
  take(): void;
  /** Put the remembered attributes back. */
  restore(): void;
}

export function createHtmlGuard(): HtmlGuard {
  const read = (): Snapshot => ({
    "data-theme": document.documentElement.getAttribute("data-theme"),
    "data-astryx-theme": document.documentElement.getAttribute("data-astryx-theme"),
  });
  let snapshot = read();
  return {
    take() {
      snapshot = read();
    },
    restore() {
      for (const name of ATTRIBUTES) {
        const value = snapshot[name];
        if (value === null) document.documentElement.removeAttribute(name);
        else document.documentElement.setAttribute(name, value);
      }
    },
  };
}

/**
 * Wrap the Astryx provider. The attributes are read while rendering, before
 * the commit in which the provider's layout effect clears and rewrites them on
 * `<html>`; this component's layout effect runs after that and puts the host's
 * values back, so they never show.
 */
export function HtmlGuardBoundary({
  guard,
  children,
}: {
  guard: HtmlGuard;
  children: ReactNode;
}): ReactElement {
  const mode = useThemeStore((state) => state.mode);
  // Read while rendering (before the commit). The html attributes are at the
  // host's values here because the previous commit restored them.
  guard.take();
  useLayoutEffect(() => {
    guard.restore();
  }, [guard, mode]);
  return <>{children}</>;
}
