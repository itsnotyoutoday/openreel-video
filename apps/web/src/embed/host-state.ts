import { create } from "zustand";
import { projectManager } from "../services/project-manager";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { getHostRuntime, isHostChromeHidden, useHostRuntime } from "./host-runtime";
import type { EditorEvents, HostChromeItem, HostLabelKey } from "./types";

/** State the host controls that the editor's UI reads. */
export const useHostState = create<{
  readOnly: boolean;
  /** Bumped by `editor.openExport()`; the Toolbar (which owns the export dialog and targets) reacts. */
  exportRequest: number;
  /** Set by `editor.openInspectorTab(id)`; the host inspector reacts. */
  inspectorRequest: { id: string; n: number; at: number } | null;
  saving: boolean;
  savedAt: number | null;
}>(() => ({ readOnly: false, exportRequest: 0, inspectorRequest: null, saving: false, savedAt: null }));

/** True while the host has put the editor in read-only mode. */
export function useReadOnly(): boolean {
  return useHostState((state) => state.readOnly);
}

/** True when the host asked to hide this piece of chrome (always false outside an embedded mount). */
export function useChromeHidden(item: HostChromeItem): boolean {
  return useHostRuntime()?.options.hostChrome?.hide?.includes(item) ?? false;
}

/** Non-hook variant for services. */
export function isChromeHidden(item: HostChromeItem): boolean {
  return isHostChromeHidden(item);
}

/** The host's wording for `key`, or `fallback`. */
export function useHostLabel(key: HostLabelKey, fallback: string): string {
  return useHostRuntime()?.options.labels?.[key] ?? fallback;
}

/** True when the Media panel's Import button belongs to the host. */
export function useHostImport(): boolean {
  return useHostRuntime()?.options.hostChrome?.importAction === "host";
}

/**
 * Ask the host to import media. Returns false when the host did not take over
 * (the editor then opens its own picker).
 */
export function requestHostImport(): boolean {
  const runtime = getHostRuntime();
  if (runtime?.options.hostChrome?.importAction !== "host") return false;
  const handler = runtime.options.hostActions?.import ?? runtime.options.events?.onImportRequest;
  if (!handler) return false;
  try {
    handler();
  } catch (error) {
    console.error("[OpenReel] The host's import action failed:", error);
  }
  return true;
}

/** Hand files dropped on the Media panel to the host. Returns false when the host did not take over. */
export function handOverDroppedFiles(files: readonly File[]): boolean {
  const runtime = getHostRuntime();
  const handler = runtime?.options.events?.onFilesDropped;
  if (runtime?.options.hostChrome?.importAction !== "host" || !handler) return false;
  try {
    handler(files);
  } catch (error) {
    console.error("[OpenReel] events.onFilesDropped failed:", error);
  }
  return true;
}

function call(name: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    console.error(`[OpenReel] events.${name} failed:`, error);
  }
}

const PLAYHEAD_THROTTLE_MS = 100;
const DIRTY_DEBOUNCE_MS = 120;

export interface StateEvents {
  /** Whether there are changes since the project was loaded, saved or replaced. */
  isDirty(): boolean;
  /** Treat the project as it is now as the clean, saved state. */
  markClean(): void;
  /** Report a failure to `events.onError`. */
  reportError(error: unknown, source: string): void;
  dispose(): void;
}

/**
 * Forward state changes to the host: dirty state, playhead, history. The dirty
 * baseline is the project's `modifiedAt` when it was loaded, saved or
 * replaced, so nothing counts as an unsaved change until someone edits.
 */
export function wireStateEvents(events: EditorEvents | undefined): StateEvents {
  const cleanups: Array<() => void> = [];
  /**
   * What counts as an unsaved change: the cut, the overlays, the groups, the settings and the
   * media list. A bumped `modifiedAt` alone (an export, a regenerated thumbnail, a probe) is not.
   */
  const signature = (): string => {
    const p = useProjectStore.getState().project;
    return JSON.stringify([
      p.name,
      p.settings,
      p.timeline,
      p.textClips,
      p.shapeClips,
      p.svgClips,
      p.stickerClips,
      p.adjustmentLayers,
      p.clipGroups,
      p.mediaLibrary.items.map((item) => [item.id, item.name, item.type, item.metadata]),
    ]);
  };
  let baseline = signature();
  let baselineId = useProjectStore.getState().project.id;
  let evaluateTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  const setDirty = (next: boolean) => {
    if (next === dirty) return;
    dirty = next;
    const handler = events?.onDirtyChange;
    if (handler) call("onDirtyChange", () => handler(next));
  };

  const markClean = () => {
    if (evaluateTimer) clearTimeout(evaluateTimer);
    evaluateTimer = null;
    baseline = signature();
    baselineId = useProjectStore.getState().project.id;
    setDirty(false);
  };

  if (events?.onDirtyChange) {
    const handler = events.onDirtyChange;
    call("onDirtyChange", () => handler(false));
    cleanups.push(
      useProjectStore.subscribe(
        (state) => state.project,
        (project) => {
          if (project.id !== baselineId) {
            markClean();
            return;
          }
          // compare the content shortly after the last change, not on every drag step
          if (evaluateTimer) clearTimeout(evaluateTimer);
          evaluateTimer = setTimeout(() => {
            evaluateTimer = null;
            setDirty(signature() !== baseline);
          }, DIRTY_DEBOUNCE_MS);
        },
      ),
      projectManager.on("projectSaved", markClean),
    );
  }

  if (events?.onPlayheadChange) {
    const handler = events.onPlayheadChange;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = useTimelineStore.getState().playheadPosition;
    let lastSent = 0;
    cleanups.push(
      useTimelineStore.subscribe(
        (state) => state.playheadPosition,
        (position) => {
          last = position;
          if (timer) return;
          const wait = Math.max(0, PLAYHEAD_THROTTLE_MS - (Date.now() - lastSent));
          timer = setTimeout(() => {
            timer = null;
            lastSent = Date.now();
            call("onPlayheadChange", () => handler(last));
          }, wait);
        },
      ),
      () => {
        if (timer) clearTimeout(timer);
      },
    );
  }

  if (events?.onHistoryChange) {
    const handler = events.onHistoryChange;
    let sent: { canUndo: boolean; canRedo: boolean } | null = null;
    const report = () => {
      const store = useProjectStore.getState();
      const next = { canUndo: store.canUndo(), canRedo: store.canRedo() };
      if (sent && sent.canUndo === next.canUndo && sent.canRedo === next.canRedo) return;
      sent = next;
      call("onHistoryChange", () => handler(next));
    };
    report();
    cleanups.push(
      useProjectStore.subscribe((state) => state.project, report),
      useProjectStore.subscribe((state) => state.actionExecutor, report),
    );
  }

  return {
    isDirty: () => signature() !== baseline,
    markClean,
    reportError(error, source) {
      const handler = events?.onError;
      if (!handler) return;
      const message = error instanceof Error ? error.message : String(error);
      call("onError", () => handler({ message, source }));
    },
    dispose: () => {
      if (evaluateTimer) clearTimeout(evaluateTimer);
      cleanups.forEach((cleanup) => cleanup());
    },
  };
}

let requestCounter = 0;

/** Ask the host inspector to open a tab; it opens as soon as the tab applies to the selection. */
export function requestInspectorTab(id: string): void {
  requestCounter += 1;
  useHostState.setState({ inspectorRequest: { id, n: requestCounter, at: Date.now() } });
}

/** Ask the editor to start an export: the primary export target, or the export dialog. */
export function requestExport(): void {
  useHostState.setState((state) => ({ exportRequest: state.exportRequest + 1 }));
}
