import type { Project } from "@openreel/core";
import { StrictMode, Suspense, lazy, useEffect, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import {
  extendToolSchema,
  registerTool,
  unregisterTool,
  type HostToolDefinition,
  type ToolSchemaExtension,
} from "@openreel/agent";
import { PortalContainerProvider } from "@openreel/ui";
import { ToastContainer } from "../components/Toast";
import { createHtmlGuard, HtmlGuardBoundary } from "./html-guard";
import { AstryxProvider } from "../components/astryx/AstryxProvider";
import { EditorInterface } from "../components/editor/EditorInterface";
import { autoSaveManager } from "../services/auto-save";
import {
  forgetKnownRevisions,
  loadProjectFromProvider,
} from "../services/storage/project-persistence";
import { setStorageProvider } from "../services/storage/storage-context";
import {
  disposeProjectAutoSave,
  useProjectStore,
} from "../stores/project-store";
import { projectManager } from "../services/project-manager";
import { createEmptyProject } from "../stores/project/project-helpers";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { useNotificationStore } from "../stores/notification-store";
import "./embed.css";
import { createThemeController, validateTheme } from "./theme";
import {
  getHostRuntime,
  HostRuntimeContext,
  setHostRuntime,
  type HostRuntime,
} from "./host-runtime";
import type { EditorEvents, EditorHostOptions, MountedEditor } from "./types";
import type { EditorTheme } from "./theme";
import { initHostAi } from "./host-ai";
import { createBridge } from "./bridge";
import { removeClipOp, replaceClipMedia, updateClip } from "./clip-ops";
import { getKnownRevision } from "../services/storage/project-persistence";
import { createPlaceholderController } from "./placeholders";
import { ReadOnlyBanner } from "./ReadOnlyBanner";
import { useLockedHint } from "../components/editor/timeline/clip-groups";
import { requestExport, requestInspectorTab, useHostState, wireStateEvents } from "./host-state";
import { applyRemoteProject } from "./remote-project";
import { renderAudio, renderStill } from "./export-render";
import { setHostMarkers, useHostMarkers } from "./host-markers";

const SearchModal = lazy(() =>
  import("../components/editor/SearchModal").then((m) => ({ default: m.SearchModal })),
);
const ScriptViewDialog = lazy(() =>
  import("../components/editor/ScriptViewDialog").then((m) => ({ default: m.ScriptViewDialog })),
);

let mounted: MountedEditor | null = null;

const CHANGE_DEBOUNCE_MS = 250;

/** Call a host callback; its failure is logged, never thrown into the editor. */
function callHost(name: string, fn: () => unknown): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.catch((error: unknown) => {
        console.error(`[OpenReel] events.${name} failed:`, error);
      });
    }
  } catch (error) {
    console.error(`[OpenReel] events.${name} failed:`, error);
  }
}

/** Forward editor activity to the host's callbacks; returns the cleanup. */
function wireEvents(events: EditorEvents | undefined): () => void {
  if (!events) return () => undefined;
  const cleanups: Array<() => void> = [];

  const { onSave, onChange, onSelectionChange } = events;
  if (onSave) {
    cleanups.push(
      projectManager.on("projectSaved", (data) => {
        const { project, revision } = data as { project: Project; revision?: string };
        callHost("onSave", () => onSave({ project, revision }));
      }),
    );
  }
  if (onChange) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useProjectStore.subscribe(
      (state) => state.project,
      () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          callHost("onChange", () =>
            onChange({ project: useProjectStore.getState().getFullProject() }),
          );
        }, CHANGE_DEBOUNCE_MS);
      },
    );
    cleanups.push(() => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    });
  }
  if (onSelectionChange) {
    cleanups.push(
      useUIStore.subscribe(
        (state) => state.selectedItems,
        (items) => {
          callHost("onSelectionChange", () =>
            onSelectionChange(
              items.map(({ id, trackId, type }) => ({ id, trackId, type })),
            ),
          );
        },
      ),
    );
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}

async function runGroupAction(type: string, params: Record<string, unknown>): Promise<void> {
  const result = await useProjectStore.getState().executeAction({
    type,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params,
  } as never);
  if (!result.success) throw new Error(result.error?.message ?? `${type} failed`);
}

/**
 * A freshly opened project shows a black preview until something moves the
 * playhead. Nudge it (to a hair past 0 and back) once the media has had time to
 * attach, so the first frame is drawn without play or seek. Skipped while
 * playing or when the person already moved the playhead.
 */
export function renderFirstFrame(): void {
  for (const delay of [300, 1200, 3000]) {
    setTimeout(() => {
      const timeline = useTimelineStore.getState();
      if (timeline.playbackState === "playing" || timeline.playheadPosition !== 0) return;
      timeline.seekTo(0.001);
      // a separate tick: set back in the same one, the preview would see no change and not redraw
      setTimeout(() => {
        const now = useTimelineStore.getState();
        if (now.playbackState !== "playing" && now.playheadPosition === 0.001) now.seekTo(0);
      }, 80);
    }, delay);
  }
}

async function openStoredProject(id: string): Promise<void> {
  const project = await loadProjectFromProvider(id);
  if (!project) throw new Error(`Project "${id}" was not found in storage`);
  useProjectStore.getState().loadProject(project);
  renderFirstFrame();
}

function createNew(options: EditorHostOptions["newProject"]): void {
  useProjectStore
    .getState()
    .createNewProject(
      options?.name ?? getHostRuntime()?.options.labels?.untitledProject,
      options?.settings,
    );
}

/** Renders the editor once the requested project is open. */
function EmbeddedEditor({
  runtime,
  onError,
}: {
  runtime: HostRuntime;
  onError: (error: unknown) => void;
}): ReactElement | null {
  const [ready, setReady] = useState(false);
  const activeModal = useUIStore((state) => state.activeModal);
  const closeModal = useUIStore((state) => state.closeModal);

  // Ctrl/Cmd+K opens search, but only for keys pressed inside the editor.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        useUIStore.getState().openModal("search");
      }
    };
    runtime.root.addEventListener("keydown", onKeyDown);
    return () => runtime.root.removeEventListener("keydown", onKeyDown);
  }, [runtime]);

  useEffect(() => {
    let cancelled = false;
    const { projectId, newProject } = runtime.options;
    const open = projectId
      ? openStoredProject(projectId)
      : Promise.resolve(createNew(newProject));
    open
      .then(() => {
        if (!cancelled) {
          setReady(true);
          renderFirstFrame();
        }
      })
      .catch((error: unknown) => {
        console.error("[OpenReel] Could not open the project:", error);
        onError(error);
        if (!cancelled) {
          createNew(newProject);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, onError]);

  if (!ready) return null;
  return (
    <>
      <EditorInterface />
      <ReadOnlyBanner />
      <Suspense fallback={null}>
        {activeModal === "scriptView" && <ScriptViewDialog isOpen onClose={closeModal} />}
        {activeModal === "search" && <SearchModal isOpen onClose={closeModal} />}
      </Suspense>
    </>
  );
}

/**
 * Mount the editor into `container`. The editor owns the elements it renders
 * and nothing outside `container`; it does not read or write the URL. Only one
 * editor can be mounted per page, because the editor's state lives in module
 * level stores; a second call throws until the first is unmounted.
 */
export function mountEditor(
  container: HTMLElement,
  options: EditorHostOptions = {},
): MountedEditor {
  if (mounted) {
    throw new Error(
      "An OpenReel editor is already mounted; unmount it before mounting another.",
    );
  }

  validateTheme(options.theme);

  // Register agent tools first: a bad definition throws before anything is
  // rendered, and the tools registered so far are removed again.
  const toolRemovers: Array<() => void> = [];
  const ownedTools = new Set<string>();
  const addTool = (tool: HostToolDefinition): (() => void) => {
    const remove = registerTool(tool);
    ownedTools.add(tool.name);
    const undo = () => {
      ownedTools.delete(tool.name);
      remove();
    };
    toolRemovers.push(undo);
    return undo;
  };
  try {
    for (const tool of options.tools ?? []) addTool(tool);
    for (const [name, extension] of Object.entries(options.toolExtensions ?? {})) {
      toolRemovers.push(extendToolSchema(name, extension));
    }
  } catch (error) {
    toolRemovers.splice(0).reverse().forEach((remove) => remove());
    throw error;
  }

  const element = document.createElement("div");
  element.setAttribute("data-openreel-root", "");
  element.style.cssText = "width:100%;height:100%;position:relative;outline:none;";
  // Focusable so keyboard shortcuts (scoped to this element) receive key events
  // after a click anywhere in the editor.
  element.tabIndex = -1;
  container.appendChild(element);

  const themeListeners = new Set<(theme: EditorTheme) => void>();
  const usageTotals = { model: "", inputTokens: 0, outputTokens: 0, calls: 0 };
  let publishUsage: (() => void) | null = null;
  const runtimeOptions: EditorHostOptions = options.ai
    ? {
        ...options,
        ai: {
          ...options.ai,
          onUsage(usage) {
            usageTotals.model = usage.model;
            usageTotals.inputTokens += usage.inputTokens ?? 0;
            usageTotals.outputTokens += usage.outputTokens ?? 0;
            usageTotals.calls += 1;
            publishUsage?.();
            options.ai?.onUsage?.(usage);
          },
        },
      }
    : options;
  const runtime: HostRuntime = {
    options: runtimeOptions,
    root: element,
    getProject: () => useProjectStore.getState().getFullProject(),
    onThemeChange(cb) {
      themeListeners.add(cb);
      return () => themeListeners.delete(cb);
    },
  };
  const placeholders = createPlaceholderController();
  setHostRuntime(runtime);
  const theme = createThemeController(element);
  theme.apply(options.theme);
  const unwireEvents = wireEvents(options.events);
  const bridgeController = createBridge(options.bridge);
  const syncMeta = () => {
    const current = useProjectStore.getState().project;
    bridgeController.patch("project.meta", {
      id: current.id,
      name: current.name,
      revision: getKnownRevision(current.id) ?? null,
      readOnly: useHostState.getState().readOnly,
    });
  };
  const stateEvents = wireStateEvents({
    ...options.events,
    onDirtyChange(dirty) {
      bridgeController.patch("project.meta", { dirty, saved: !dirty });
      options.events?.onDirtyChange?.(dirty);
    },
  });
  syncMeta();
  const unwireMeta = [
    useProjectStore.subscribe((state) => `${state.project.id}\u0000${state.project.name}`, syncMeta),
    projectManager.on("projectSaved", syncMeta),
    useHostState.subscribe(syncMeta),
  ];
  publishUsage = () => bridgeController.publish("ai.usage", { ...usageTotals });
  const applyReadOnly = () => {
    const executor = useProjectStore.getState().actionExecutor;
    executor.setReadOnly(useHostState.getState().readOnly);
    element.toggleAttribute("data-readonly", useHostState.getState().readOnly);
    const beforeEdit = options.beforeEdit;
    executor.setBeforeEditGuard(
      beforeEdit
        ? (op) => {
            const verdict = beforeEdit({ type: op.type, params: op.params });
            if (verdict && verdict.ok === false) {
              useNotificationStore.getState().addNotification({ type: "warning", title: verdict.reason, duration: 5000 });
              return { ok: false, reason: verdict.reason };
            }
            return undefined;
          }
        : null,
    );
    const onLockedAction = options.events?.onLockedAction;
    executor.setLockedActionListener((event) => {
      useLockedHint.getState().show(event.groupId, event.action);
      if (!onLockedAction) return;
      try {
        onLockedAction(event as Parameters<typeof onLockedAction>[0]);
      } catch (error) {
        console.error("[OpenReel] events.onLockedAction failed:", error);
      }
    });
  };
  useHostState.setState({ readOnly: Boolean(options.readOnly) });
  applyReadOnly();
  // The store makes a fresh executor when a project is opened or created.
  const unwireReadOnly = [
    useProjectStore.subscribe((state) => state.actionExecutor, applyReadOnly),
    useHostState.subscribe(applyReadOnly),
  ];
  const unwireAi = initHostAi(runtime.options.ai);
  if (options.storage) setStorageProvider(options.storage);

  const htmlGuard = createHtmlGuard();
  const root = createRoot(element);
  element.focus({ preventScroll: true });
  root.render(
    <StrictMode>
      <HostRuntimeContext.Provider value={runtime}>
        <HtmlGuardBoundary guard={htmlGuard}>
          <AstryxProvider>
            <PortalContainerProvider container={element}>
              <EmbeddedEditor runtime={runtime} onError={(error) => stateEvents.reportError(error, "open")} />
              <ToastContainer />
            </PortalContainerProvider>
          </AstryxProvider>
        </HtmlGuardBoundary>
      </HostRuntimeContext.Provider>
    </StrictMode>,
  );

  let unmounted = false;
  const handle: MountedEditor = {
    root: element,
    bridge: bridgeController.bridge,
    unmount() {
      if (unmounted) return;
      unmounted = true;
      root.unmount();
      // Astryx's root theme removes the attributes it set on <html>.
      htmlGuard.restore();
      element.remove();
      unwireEvents();
      stateEvents.dispose();
      unwireReadOnly.forEach((off) => off());
      useHostState.setState({ readOnly: false });
      useProjectStore.getState().actionExecutor.setReadOnly(false);
      unwireAi();
      unwireMeta.forEach((off) => off());
      bridgeController.dispose();
      theme.dispose();
      toolRemovers.splice(0).reverse().forEach((remove) => remove());
      disposeProjectAutoSave();
      autoSaveManager.stop();
      useTimelineStore.getState().stop();
      useUIStore.getState().clearSelection();
      useHostMarkers.setState({ markers: [] });
      useProjectStore.setState({
        project: createEmptyProject(),
        hasOpenProject: false,
      });
      forgetKnownRevisions();
      const provider = options.storage;
      setStorageProvider(null);
      setHostRuntime(null);
      mounted = null;
      void Promise.resolve(provider?.dispose?.()).catch((error: unknown) => {
        console.error("[OpenReel] Storage dispose failed:", error);
      });
    },
    setTheme(next) {
      theme.apply(next);
      for (const listener of [...themeListeners]) {
        try {
          listener(next ?? {});
        } catch (error) {
          console.error("[OpenReel] A host theme listener failed:", error);
        }
      }
    },
    addTool,
    removeTool(name) {
      if (!ownedTools.has(name)) return false;
      ownedTools.delete(name);
      return unregisterTool(name);
    },
    extendTool(toolName: string, extension: ToolSchemaExtension) {
      const remove = extendToolSchema(toolName, extension);
      toolRemovers.push(remove);
      return remove;
    },
    async openProject(id) {
      try {
        await openStoredProject(id);
      } catch (error) {
        stateEvents.reportError(error, "openProject");
        throw error;
      }
    },
    createProject: createNew,
    async saveProject() {
      try {
        return await projectManager.saveToProvider(useProjectStore.getState().getFullProject());
      } catch (error) {
        stateEvents.reportError(error, "saveProject");
        throw error;
      }
    },
    getProject: () => useProjectStore.getState().getFullProject(),
    async importFile(file) {
      const result = await useProjectStore.getState().importMedia(file);
      if (!result.success) {
        throw new Error(result.error?.message ?? "Import failed");
      }
    },
    async applyRemoteProject(project, remoteOptions) {
      try {
        const depth = useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();
        const executor = useProjectStore.getState().actionExecutor;
        await applyRemoteProject(project, remoteOptions);
        if (remoteOptions?.history === false && useProjectStore.getState().actionExecutor === executor) {
          executor.getHistory().truncateUndo(depth);
        }
        stateEvents.markClean();
      } catch (error) {
        stateEvents.reportError(error, "applyRemoteProject");
        throw error;
      }
    },
    seek: (seconds) => useTimelineStore.getState().seekTo(seconds),
    play: () => useTimelineStore.getState().play(),
    pause: () => useTimelineStore.getState().pause(),
    setZoom: (pixelsPerSecond) => useTimelineStore.getState().setZoom(pixelsPerSecond),
    async undo() {
      await useProjectStore.getState().undo();
    },
    async redo() {
      await useProjectStore.getState().redo();
    },
    getSelection: () =>
      useUIStore.getState().selectedItems.map(({ id, trackId, type }) => ({ id, trackId, type })),
    getPlayhead: () => useTimelineStore.getState().playheadPosition,
    focus: () => element.focus({ preventScroll: true }),
    setReadOnly: (readOnly) => useHostState.setState({ readOnly }),
    openExport: () => requestExport(),
    async save() {
      useHostState.setState({ saving: true });
      try {
        const result = await handle.saveProject();
        useHostState.setState({ savedAt: Date.now() });
        return result;
      } finally {
        useHostState.setState({ saving: false });
      }
    },
    getSaveState() {
      const { saving, savedAt } = useHostState.getState();
      const current = useProjectStore.getState().project;
      return { dirty: stateEvents.isDirty(), saving, savedAt, revision: getKnownRevision(current.id) };
    },
    openInspectorTab: (id) => requestInspectorTab(id),
    updateClip: (id, patch) => updateClip(id, patch),
    replaceClipMedia: (clipId, media, opts) => replaceClipMedia(clipId, media, opts),
    removeClip: (id, opts) => removeClipOp(id, opts),
    async setClipGroups(groups, opts) {
      const apply = () => runGroupAction("project/setClipGroups", { groups: groups.map((group) => ({ ...group })) });
      if (opts?.history === false) await handle.batchHostSetup(apply);
      else await apply();
    },
    getClipGroups: () => [...(useProjectStore.getState().project.clipGroups ?? [])],
    async setClipGroup(clipIds, groupId) {
      for (const clipId of clipIds) await runGroupAction("clip/setGroup", { clipId, groupId: groupId ?? undefined });
    },
    moveGroup: (groupId, delta) => runGroupAction("clip/moveGroup", { groupId, delta }),
    removeGroup: (groupId) => runGroupAction("clip/removeGroup", { groupId }),
    addPlaceholderClip: (placeholder) => placeholders.add(placeholder),
    updatePlaceholder: (id, patch, opts) => {
      if (opts?.history === false) void handle.batchHostSetup(() => placeholders.update(id, patch));
      else placeholders.update(id, patch);
    },
    replacePlaceholder: (id, mediaId) => placeholders.replace(id, mediaId),
    getClipMetadata: (id) => placeholders.getMetadata(id),
    setClipMetadata: (id, patch, opts) => {
      if (opts?.history === false) void handle.batchHostSetup(() => placeholders.setMetadata(id, patch));
      else placeholders.setMetadata(id, patch);
    },
    async batchHostSetup(fn) {
      const executor = useProjectStore.getState().actionExecutor;
      const history = executor.getHistory();
      const depth = history.getUndoStackSize();
      const wasDirty = stateEvents.isDirty();
      try {
        return await fn();
      } finally {
        await placeholders.idle();
        // the editor may have swapped its executor (a project was opened): only trim the one we measured
        if (useProjectStore.getState().actionExecutor === executor) history.truncateUndo(depth);
        if (!wasDirty) stateEvents.markClean();
      }
    },
    selectClip(id) {
      const { project } = useProjectStore.getState();
      const track = project.timeline.tracks.find((t) => t.clips.some((c) => c.id === id));
      if (!track) throw new Error(`No timeline clip "${id}"`);
      useUIStore.getState().select({ type: "clip", id, trackId: track.id });
    },
    renderStill: (atSeconds) => renderStill(atSeconds),
    renderAudio: () => renderAudio(),
    async setTrackLocked(trackId, locked) {
      const result = await useProjectStore.getState().lockTrack(trackId, Boolean(locked));
      if (!result.success) throw new Error(result.error?.message ?? "track/lock failed");
    },
    setClipLocks: (clipId, locks) =>
      runGroupAction("clip/setLocks", { clipId, locks: locks ? { move: Boolean(locks.move), trim: Boolean(locks.trim) } : undefined }),
    setMarkers: (markers) => setHostMarkers(markers),
    getMarkers: () => useHostMarkers.getState().markers.map((marker) => ({ ...marker })),
    async importAsset(assetId) {
      if (!options.media) {
        throw new Error("No media source was passed to mountEditor");
      }
      const blob = await options.media.resolve(assetId);
      const file =
        blob instanceof File
          ? blob
          : new File([blob], assetId, { type: blob.type });
      await handle.importFile(file);
    },
  };

  mounted = handle;
  return handle;
}
