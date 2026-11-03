import { StrictMode, Suspense, lazy, useEffect, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { AstryxProvider } from "../components/astryx/AstryxProvider";
import { EditorInterface } from "../components/editor/EditorInterface";
import { autoSaveManager } from "../services/auto-save";
import {
  loadProjectFromProvider,
  saveProjectToProvider,
  forgetKnownRevisions,
} from "../services/storage/project-persistence";
import { setStorageProvider } from "../services/storage/storage-context";
import {
  disposeProjectAutoSave,
  useProjectStore,
} from "../stores/project-store";
import { createEmptyProject } from "../stores/project/project-helpers";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import {
  HostRuntimeContext,
  setHostRuntime,
  type HostRuntime,
} from "./host-runtime";
import type { EditorHostOptions, MountedEditor } from "./types";

const SearchModal = lazy(() =>
  import("../components/editor/SearchModal").then((m) => ({ default: m.SearchModal })),
);
const ScriptViewDialog = lazy(() =>
  import("../components/editor/ScriptViewDialog").then((m) => ({ default: m.ScriptViewDialog })),
);

let mounted: MountedEditor | null = null;

async function openStoredProject(id: string): Promise<void> {
  const project = await loadProjectFromProvider(id);
  if (!project) throw new Error(`Project "${id}" was not found in storage`);
  useProjectStore.getState().loadProject(project);
}

function createNew(options: EditorHostOptions["newProject"]): void {
  useProjectStore
    .getState()
    .createNewProject(options?.name, options?.settings);
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
        if (!cancelled) setReady(true);
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

  const element = document.createElement("div");
  element.setAttribute("data-openreel-root", "");
  element.style.cssText = "width:100%;height:100%;position:relative;outline:none;";
  // Focusable so keyboard shortcuts (scoped to this element) receive key events
  // after a click anywhere in the editor.
  element.tabIndex = -1;
  container.appendChild(element);

  const runtime: HostRuntime = { options, root: element };
  setHostRuntime(runtime);
  if (options.storage) setStorageProvider(options.storage);

  const root = createRoot(element);
  element.focus({ preventScroll: true });
  root.render(
    <StrictMode>
      <HostRuntimeContext.Provider value={runtime}>
        <AstryxProvider>
          <EmbeddedEditor runtime={runtime} onError={() => undefined} />
        </AstryxProvider>
      </HostRuntimeContext.Provider>
    </StrictMode>,
  );

  let unmounted = false;
  const handle: MountedEditor = {
    root: element,
    unmount() {
      if (unmounted) return;
      unmounted = true;
      root.unmount();
      element.remove();
      disposeProjectAutoSave();
      autoSaveManager.stop();
      useTimelineStore.getState().stop();
      useUIStore.getState().clearSelection();
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
    openProject: openStoredProject,
    createProject: createNew,
    async saveProject() {
      return saveProjectToProvider(useProjectStore.getState().getFullProject());
    },
    getProject: () => useProjectStore.getState().getFullProject(),
    async importFile(file) {
      const result = await useProjectStore.getState().importMedia(file);
      if (!result.success) {
        throw new Error(result.error?.message ?? "Import failed");
      }
    },
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
