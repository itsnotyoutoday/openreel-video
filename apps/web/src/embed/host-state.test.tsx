// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { createMemoryStorageProvider, type Project } from "@openreel/core";
import { setStorageProvider } from "../services/storage/storage-context";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { ProjectSwitcher } from "../components/editor/ProjectSwitcher";
import { HostRuntimeContext, setHostRuntime, type HostRuntime } from "./host-runtime";
import {
  handOverDroppedFiles,
  requestHostImport,
  useChromeHidden,
  useHostLabel,
  useHostState,
  wireStateEvents,
} from "./host-state";
import { applyRemoteProject } from "./remote-project";
import { createPlaceholderController } from "./placeholders";
import type { EditorHostOptions } from "./types";
import type { ReactNode } from "react";

function runtimeFor(options: EditorHostOptions): HostRuntime {
  return {
    options,
    root: document.body,
    getProject: () => useProjectStore.getState().getFullProject(),
  };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  setStorageProvider(createMemoryStorageProvider());
  useProjectStore.getState().createNewProject("State", { width: 1280, height: 720, frameRate: 30 });
});

afterEach(() => {
  cleanup();
  setHostRuntime(null);
  setStorageProvider(null);
  useHostState.setState({ readOnly: false });
  useProjectStore.getState().actionExecutor.setReadOnly(false);
  useUIStore.getState().clearSelection();
  vi.useRealTimers();
});

describe("dirty state", () => {
  it("starts clean, turns dirty on an edit, and is clean again after a save or a different project loads", async () => {
    const onDirtyChange = vi.fn();
    const state = wireStateEvents({ onDirtyChange });
    expect(onDirtyChange.mock.calls).toEqual([[false]]);

    await useProjectStore.getState().addTrack("video");
    expect(state.isDirty()).toBe(true); // live, without waiting for the debounce
    await vi.waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    state.markClean();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await useProjectStore.getState().addTrack("audio");
    await vi.waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    // opening another project is not an unsaved change
    useProjectStore.getState().createNewProject("Another");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    state.dispose();
  });

  it("reports history availability and throttles playhead changes", async () => {
    const onHistoryChange = vi.fn();
    const onPlayheadChange = vi.fn();
    vi.useFakeTimers();
    const state = wireStateEvents({ onHistoryChange, onPlayheadChange });
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canUndo: false, canRedo: false });

    vi.useRealTimers();
    await useProjectStore.getState().addTrack("video");
    expect(onHistoryChange).toHaveBeenLastCalledWith({ canUndo: true, canRedo: false });

    vi.useFakeTimers();
    useTimelineStore.getState().seekTo(1);
    useTimelineStore.getState().seekTo(2);
    useTimelineStore.getState().seekTo(3);
    vi.advanceTimersByTime(150);
    expect(onPlayheadChange).toHaveBeenCalledTimes(1);
    expect(onPlayheadChange).toHaveBeenCalledWith(3);
    state.dispose();
  });
});

describe("what is not an unsaved change", () => {
  it("stays clean when only modifiedAt moves (an export, a thumbnail), and after a save", async () => {
    const onDirtyChange = vi.fn();
    const state = wireStateEvents({ onDirtyChange });
    await useProjectStore.getState().addTrack("video");
    await vi.waitFor(() => expect(state.isDirty()).toBe(true));
    state.markClean();
    onDirtyChange.mockClear();

    // what an export run or a regenerated thumbnail does: bump the timestamp, change nothing
    useProjectStore.setState((s) => ({ project: { ...s.project, modifiedAt: s.project.modifiedAt + 5000 } }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(state.isDirty()).toBe(false);
    expect(onDirtyChange).not.toHaveBeenCalled();

    // a real edit afterwards still counts
    await useProjectStore.getState().addTrack("audio");
    await vi.waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    state.dispose();
  });
});

describe("applyRemoteProject", () => {
  it("replaces the cut as one undo step and keeps selection, playhead and zoom", async () => {
    const placeholders = createPlaceholderController();
    const keep = placeholders.add({ start: 0, duration: 2, label: "Keep" });
    const drop = placeholders.add({ start: 2, duration: 2, label: "Drop" });
    await placeholders.idle();
    useUIStore.getState().selectMultiple([
      { type: "clip", id: keep },
      { type: "clip", id: drop },
    ]);
    useTimelineStore.getState().seekTo(1.5);
    useTimelineStore.getState().setZoom(80);

    const before = useProjectStore.getState().getFullProject();
    const remote: Project = JSON.parse(JSON.stringify(before));
    const mutable = remote.timeline as { tracks: Project["timeline"]["tracks"] };
    mutable.tracks = remote.timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((c) => c.id !== drop),
    }));

    // history entries are ordered by millisecond timestamps: keep the remote change strictly later
    await new Promise((resolve) => setTimeout(resolve, 5));
    await applyRemoteProject(remote, { revision: "7" });
    const after = useProjectStore.getState().project;
    expect(after.timeline.tracks.flatMap((t) => t.clips).map((c) => c.id)).toEqual([keep]);
    // media the editor already holds keeps its bytes
    expect(after.mediaLibrary.items.every((item) => item.blob instanceof Blob)).toBe(true);
    expect(useUIStore.getState().selectedItems.map((i) => i.id)).toEqual([keep]);
    expect(useTimelineStore.getState().playheadPosition).toBe(1.5);
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(80);

    await useProjectStore.getState().undo();
    expect(
      useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips).map((c) => c.id).sort(),
    ).toEqual([keep, drop].sort());
  });

  it("still applies while the editor is read only", async () => {
    useProjectStore.getState().actionExecutor.setReadOnly(true);
    const remote = JSON.parse(JSON.stringify(useProjectStore.getState().getFullProject())) as Project;
    await applyRemoteProject({ ...remote, name: "From the host" });
    expect(useProjectStore.getState().project.name).toBe("From the host");
    expect(useProjectStore.getState().actionExecutor.isReadOnly()).toBe(true);
  });
});

describe("read-only mode", () => {
  it("refuses edits, undo and media import, and allows them again afterwards", async () => {
    useProjectStore.getState().actionExecutor.setReadOnly(true);
    const refused = await useProjectStore.getState().addTrack("video");
    expect(refused.success).toBe(false);
    expect(refused.error?.code).toBe("READ_ONLY");
    const imported = await useProjectStore.getState().importMedia(new File([new Uint8Array(1)], "a.png", { type: "image/png" }));
    expect(imported.success).toBe(false);
    expect(imported.error?.code).toBe("READ_ONLY");

    useProjectStore.getState().actionExecutor.setReadOnly(false);
    expect((await useProjectStore.getState().addTrack("video")).success).toBe(true);
  });
});

describe("host chrome", () => {
  const wrapper = (options: EditorHostOptions) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return <HostRuntimeContext.Provider value={runtimeFor(options)}>{children}</HostRuntimeContext.Provider>;
    };

  it("hides only what the host lists, and nothing without the option", () => {
    const hidden = renderHook(() => useChromeHidden("projectMenu"), {
      wrapper: wrapper({ hostChrome: { hide: ["projectMenu", "projectJson"] } }),
    });
    expect(hidden.result.current).toBe(true);
    const other = renderHook(() => useChromeHidden("newProject"), {
      wrapper: wrapper({ hostChrome: { hide: ["projectMenu"] } }),
    });
    expect(other.result.current).toBe(false);
    const none = renderHook(() => useChromeHidden("projectMenu"), { wrapper: wrapper({}) });
    expect(none.result.current).toBe(false);
    const outside = renderHook(() => useChromeHidden("projectMenu"));
    expect(outside.result.current).toBe(false);
  });

  it("renders no project menu when the host hides it", async () => {
    const hidden = render(
      <HostRuntimeContext.Provider value={runtimeFor({ hostChrome: { hide: ["projectMenu"] } })}>
        <ProjectSwitcher />
      </HostRuntimeContext.Provider>,
    );
    await flush();
    expect(hidden.queryByRole("button", { name: "State" })).toBeNull();
    hidden.unmount();
    const shown = render(
      <HostRuntimeContext.Provider value={runtimeFor({})}>
        <ProjectSwitcher />
      </HostRuntimeContext.Provider>,
    );
    await flush();
    expect(shown.getByRole("button", { name: "State" })).toBeTruthy();
  });

  it("asks the host to import instead of opening the file picker, and hands over dropped files", () => {
    const onImportRequest = vi.fn();
    const onFilesDropped = vi.fn();
    setHostRuntime(runtimeFor({ hostChrome: { importAction: "host" }, events: { onImportRequest, onFilesDropped } }));
    expect(requestHostImport()).toBe(true);
    expect(onImportRequest).toHaveBeenCalledTimes(1);
    const file = new File([new Uint8Array(1)], "a.png");
    expect(handOverDroppedFiles([file])).toBe(true);
    expect(onFilesDropped).toHaveBeenCalledWith([file]);

    const action = vi.fn();
    setHostRuntime(runtimeFor({ hostChrome: { importAction: "host" }, hostActions: { import: action } }));
    expect(requestHostImport()).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);

    // not taken over: the editor's own picker stays
    setHostRuntime(runtimeFor({ events: { onImportRequest } }));
    expect(requestHostImport()).toBe(false);
    expect(handOverDroppedFiles([file])).toBe(false);
    setHostRuntime(null);
    expect(requestHostImport()).toBe(false);
  });

  it("uses the host's labels and falls back to the editor's words", () => {
    const labelled = renderHook(() => useHostLabel("import", "Import"), {
      wrapper: wrapper({ labels: { import: "Library" } }),
    });
    expect(labelled.result.current).toBe("Library");
    const plain = renderHook(() => useHostLabel("import", "Import"), { wrapper: wrapper({}) });
    expect(plain.result.current).toBe("Import");
  });
});
