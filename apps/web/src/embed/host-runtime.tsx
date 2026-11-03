import { createContext, useContext } from "react";
import type { Project } from "@openreel/core";
import type { EditorHostOptions, ExportedFile } from "./types";

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

export const HostRuntimeContext = createContext<HostRuntime | null>(null);

/** True when the editor is mounted by a host through `mountEditor`. */
export function useIsEmbedded(): boolean {
  return useContext(HostRuntimeContext) !== null;
}

export function useHostRuntime(): HostRuntime | null {
  return useContext(HostRuntimeContext);
}
