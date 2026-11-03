import { createContext, useContext } from "react";
import type { EditorHostOptions } from "./types";

/**
 * What the running editor knows about its host. `null` outside an embedded
 * mount: the standalone app never sets it, so every consumer must treat the
 * absence as "behave exactly as before".
 */
export interface HostRuntime {
  readonly options: EditorHostOptions;
  /** The element the editor is mounted into. */
  readonly root: HTMLElement;
}

let current: HostRuntime | null = null;

export function setHostRuntime(runtime: HostRuntime | null): void {
  current = runtime;
}

/** The embedding host's runtime, or `null` in the standalone app. */
export function getHostRuntime(): HostRuntime | null {
  return current;
}

export const HostRuntimeContext = createContext<HostRuntime | null>(null);

/** True when the editor is mounted by a host through `mountEditor`. */
export function useIsEmbedded(): boolean {
  return useContext(HostRuntimeContext) !== null;
}

export function useHostRuntime(): HostRuntime | null {
  return useContext(HostRuntimeContext);
}
