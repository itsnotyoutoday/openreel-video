// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createMemoryStorageProvider } from "@openreel/core";
import { setStorageProvider } from "../services/storage/storage-context";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { HostInspectorTabs } from "./HostInspector";
import { HostRuntimeContext, type HostRuntime } from "./host-runtime";
import { mergeHostMetadata, hostClipInfo } from "./host-clips";
import { createPlaceholderController } from "./placeholders";
import { useHostClipMenuItems } from "./use-host-menu";
import type { EditorHostOptions, HostClipInfo } from "./types";
import type { ReactNode } from "react";

function runtimeFor(options: EditorHostOptions): HostRuntime {
  return {
    options,
    root: document.body,
    getProject: () => useProjectStore.getState().getFullProject(),
    onThemeChange: () => () => undefined,
  };
}

function withRuntime(options: EditorHostOptions | null) {
  return ({ children }: { children: ReactNode }) => (
    <HostRuntimeContext.Provider value={options ? runtimeFor(options) : null}>
      {children}
    </HostRuntimeContext.Provider>
  );
}

beforeEach(() => {
  setStorageProvider(createMemoryStorageProvider());
  useProjectStore.getState().createNewProject("Host panels", { width: 1280, height: 720, frameRate: 30 });
});

afterEach(() => {
  cleanup();
  setStorageProvider(null);
  useUIStore.getState().clearSelection();
});

describe("placeholder clips", () => {
  it("adds a first-class timeline clip with host metadata and hides its still from the media list", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({
      start: 1,
      duration: 3,
      label: "Shot 4",
      pattern: "hatch",
      progress: 0.25,
      metadata: { shotId: "s4" },
    });
    expect(placeholders.getMetadata(id)).toEqual({ shotId: "s4" }); // before the clip exists
    await placeholders.idle();

    const project = useProjectStore.getState().project;
    const clip = project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    expect(clip).toMatchObject({ startTime: 1, duration: 3 });
    expect(clip?.metadata?.placeholder).toEqual({ label: "Shot 4", pattern: "hatch", progress: 0.25 });
    expect(clip?.metadata?.host).toEqual({ shotId: "s4" });
    expect(hostClipInfo(project, id)).toMatchObject({ type: "placeholder", label: "Shot 4", start: 1, duration: 3 });
    const media = project.mediaLibrary.items.find((m) => m.id === clip?.mediaId);
    expect(media).toMatchObject({ type: "image", hostGenerated: true });
  });

  it("updates label, progress and duration, and keeps host metadata through split and undo", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({ start: 0, duration: 4, label: "A", metadata: { shotId: "s1" } });
    await placeholders.idle();

    placeholders.update(id, { label: "B", progress: 0.5, duration: 6, metadata: { note: "x" } });
    await placeholders.idle();
    let clip = useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    expect(clip?.duration).toBe(6);
    expect(clip?.metadata?.placeholder).toMatchObject({ label: "B", progress: 0.5 });
    expect(clip?.metadata?.host).toEqual({ shotId: "s1", note: "x" });

    await useProjectStore.getState().splitClip(id, 2);
    const clips = useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips);
    expect(clips).toHaveLength(2);
    for (const half of clips) {
      expect(half.metadata?.host).toEqual({ shotId: "s1", note: "x" });
      expect(half.metadata?.placeholder?.label).toBe("B");
    }

    await useProjectStore.getState().undo();
    await useProjectStore.getState().undo();
    clip = useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    expect(clip?.metadata?.host).toBeDefined();
  });

  it("swaps for real media keeping position, duration and host metadata", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({ start: 2, duration: 4, label: "Later", metadata: { shotId: "s9" } });
    await placeholders.idle();

    const real = new File([new Uint8Array([1, 2, 3])], "real.png", { type: "image/png" });
    const library = useProjectStore.getState().project.mediaLibrary;
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: {
          ...library,
          items: [
            ...library.items,
            {
              id: "real",
              name: "real.png",
              type: "image",
              fileHandle: null,
              blob: real,
              metadata: { duration: 0, width: 10, height: 10, frameRate: 0, codec: "", sampleRate: 0, channels: 0, fileSize: 3 },
              thumbnailUrl: null,
              waveformData: null,
            },
          ],
        },
      },
    }));

    placeholders.replace(id, "real");
    await placeholders.idle();
    const clip = useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    expect(clip).toMatchObject({ mediaId: "real", startTime: 2, duration: 4 });
    expect(clip?.metadata?.placeholder).toBeUndefined();
    expect(clip?.metadata?.host).toEqual({ shotId: "s9" });
    expect(hostClipInfo(useProjectStore.getState().project, id)?.type).toBe("image");
  });

  it("survives a save and load round trip", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({ start: 0, duration: 2, label: "Persist", metadata: { shotId: "s2" } });
    await placeholders.idle();
    const saved = JSON.parse(JSON.stringify(useProjectStore.getState().getFullProject()));
    useProjectStore.getState().loadProject(saved);
    const clip = useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    expect(clip?.metadata?.host).toEqual({ shotId: "s2" });
    expect(clip?.metadata?.placeholder?.label).toBe("Persist");
  });
});

describe("host clip metadata", () => {
  it("merges a patch, removes undefined keys, and is one undo step", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({ start: 0, duration: 2, metadata: { a: 1, b: 2 } });
    await placeholders.idle();

    await mergeHostMetadata(id, { b: undefined, c: 3 });
    expect(placeholders.getMetadata(id)).toEqual({ a: 1, c: 3 });
    await useProjectStore.getState().undo();
    expect(placeholders.getMetadata(id)).toEqual({ a: 1, b: 2 });
  });
});

describe("clip context menu items", () => {
  it("adds the host's items in their own group", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({ start: 0, duration: 2, label: "Menu" });
    await placeholders.idle();
    const onSelect = vi.fn();
    const clipContextMenu = vi.fn((clip: HostClipInfo) => [
      { id: "edit", label: `Edit ${clip.label}`, onSelect },
      { id: "gone", label: "Remove", danger: true, disabled: true, onSelect },
    ]);

    const { result } = renderHook(() => useHostClipMenuItems(id, 1), {
      wrapper: withRuntime({ hostPanels: { clipContextMenu } }),
    });
    expect(result.current[0]).toEqual({ type: "divider" });
    const section = result.current[1];
    if (section.type !== "section") throw new Error("expected a section");
    expect(section.items).toHaveLength(2);
    const first = section.items[0];
    if (first.type === "divider" || first.type === "section") throw new Error("expected an item");
    expect(first.label).toBe("Edit Menu");
    first.onClick?.();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id, type: "placeholder" }));
  });

  it("adds nothing without the option, and survives a host that throws", () => {
    const none = renderHook(() => useHostClipMenuItems("x", 1), { wrapper: withRuntime({}) });
    expect(none.result.current).toEqual([]);
    const outside = renderHook(() => useHostClipMenuItems("x", 1), { wrapper: withRuntime(null) });
    expect(outside.result.current).toEqual([]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = renderHook(() => useHostClipMenuItems("x", 1), {
      wrapper: withRuntime({ hostPanels: { clipContextMenu: () => { throw new Error("boom"); } } }),
    });
    expect(bad.result.current).toEqual([]);
    error.mockRestore();
  });
});

describe("inspector tabs", () => {
  it("renders the editor's inspector unchanged when the host adds no tabs", () => {
    render(
      <HostInspectorTabs>
        <div>native inspector</div>
      </HostInspectorTabs>,
      { wrapper: withRuntime({}) },
    );
    expect(screen.getByText("native inspector")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("shows a host tab for a matching clip, mounts it once, and reports clip changes", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({ start: 0, duration: 2, label: "Inspect", metadata: { shotId: "s1" } });
    const other = placeholders.add({ start: 2, duration: 2, label: "Other" });
    await placeholders.idle();

    const seen: Array<HostClipInfo | null> = [];
    const mount = vi.fn((el: HTMLElement, api: { clip: HostClipInfo; onClipChange(cb: (c: HostClipInfo | null) => void): () => void; updateMetadata(p: Record<string, unknown>): void }) => {
      el.textContent = `scene ${api.clip.label}`;
      const off = api.onClipChange((clip) => seen.push(clip));
      (el as HTMLElement & { api?: typeof api }).api = api;
      return off;
    });
    const options: EditorHostOptions = {
      hostPanels: {
        inspectorTabs: [
          { id: "scene", label: "Scene", when: (selection) => Boolean(selection) && !Array.isArray(selection) && !("join" in (selection as object)) && (selection as { type: string }).type === "placeholder", mount },
          { id: "never", label: "Never", when: () => false, mount: () => () => undefined },
        ],
      },
    };
    render(
      <HostInspectorTabs>
        <div>native inspector</div>
      </HostInspectorTabs>,
      { wrapper: withRuntime(options) },
    );
    expect(screen.queryByRole("tablist")).toBeNull(); // nothing selected

    act(() => useUIStore.getState().select({ type: "clip", id }));
    expect(screen.getByRole("tab", { name: "Scene" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Never" })).toBeNull();
    expect(mount).not.toHaveBeenCalled(); // not shown yet

    fireEvent.click(screen.getByRole("tab", { name: "Scene" }));
    expect(mount).toHaveBeenCalledTimes(1);
    expect(screen.getByText("scene Inspect")).toBeTruthy();

    act(() => useUIStore.getState().select({ type: "clip", id: other }));
    expect(seen.at(-1)?.id).toBe(other);
    expect(mount).toHaveBeenCalledTimes(1); // stays mounted across clips

    await act(async () => {
      await mergeHostMetadata(other, { note: "hello" });
    });
    expect(seen.at(-1)?.metadata).toEqual({ note: "hello" });

    act(() => useUIStore.getState().clearSelection());
    expect(seen.at(-1)).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("moves between tabs with the arrow keys", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({ start: 0, duration: 2, label: "Keys" });
    await placeholders.idle();
    render(
      <HostInspectorTabs>
        <div>native inspector</div>
      </HostInspectorTabs>,
      {
        wrapper: withRuntime({
          hostPanels: { inspectorTabs: [{ id: "a", label: "A", mount: () => () => undefined }] },
        }),
      },
    );
    act(() => useUIStore.getState().select({ type: "clip", id }));
    const properties = screen.getByRole("tab", { name: "Properties" });
    expect(properties.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "A" }).getAttribute("aria-selected")).toBe("true");
  });
});
