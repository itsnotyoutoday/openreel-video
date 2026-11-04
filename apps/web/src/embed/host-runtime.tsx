import { createContext, useContext } from "react";
import type { Project } from "@openreel/core";
import type { EditorHostOptions, ExportedFile } from "./types";
import type { EditorTheme } from "./theme";

/**
 * What the running editor knows about its host. `null` outside an embedded
 * mount: the standalone app never sets it, so every consumer must treat the
 * absence as "behave exactly as before".
 */
export interface HostRuntime {
  readonly options: EditorHostOptions;
  /** The element the editor is mounted into. */
  readonly root: HTMLElement;
  /** The open project, including title and graphics clips. */
  readonly getProject: () => Project;
  /** Subscribe to host theme changes (`setTheme`); returns the unsubscribe. */
  readonly onThemeChange?: (cb: (theme: EditorTheme) => void) => () => void;
}

let current: HostRuntime | null = null;

export function setHostRuntime(runtime: HostRuntime | null): void {
  current = runtime;
}

/** The embedding host's runtime, or `null` in the standalone app. */
export function getHostRuntime(): HostRuntime | null {
  return current;
}

/**
 * Delivers a finished export to the host's `events.onExport`, or `null` when
 * the host did not ask for exports (the editor then downloads as usual).
 */
export function getHostExportHandler():
  | ((file: Omit<ExportedFile, "project">) => Promise<void>)
  | null {
  const runtime = current;
  const onExport = runtime?.options.events?.onExport;
  if (!runtime || !onExport) return null;
  return async (file) => {
    await onExport({ ...file, project: runtime.getProject() });
  };
}

/**
 * Tell the host an export is starting while placeholder clips remain. They
 * export as their still or card for their duration; the host may warn.
 */
export function warnHostAboutPlaceholders(): void {
  const runtime = current;
  const warn = runtime?.options.events?.onExportWarning;
  if (!runtime || !warn) return;
  let count = 0;
  for (const track of runtime.getProject().timeline.tracks) {
    for (const clip of track.clips) if (clip.metadata?.placeholder) count += 1;
  }
  if (count === 0) return;
  try {
    warn(count);
  } catch (error) {
    console.error("[OpenReel] events.onExportWarning failed:", error);
  }
}

/** True when the host asked to hide this piece of chrome (false outside an embedded mount). */
export function isHostChromeHidden(item: import("./types").HostChromeItem): boolean {
  return current?.options.hostChrome?.hide?.includes(item) ?? false;
}

export const HostRuntimeContext = createContext<HostRuntime | null>(null);

/** True when the editor is mounted by a host through `mountEditor`. */
export function useIsEmbedded(): boolean {
  return useContext(HostRuntimeContext) !== null;
}

export function useHostRuntime(): HostRuntime | null {
  return useContext(HostRuntimeContext);
}
