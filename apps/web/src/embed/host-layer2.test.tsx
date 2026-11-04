// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryStorageProvider, type Project } from "@openreel/core";
import { setStorageProvider } from "../services/storage/storage-context";
import { stripProjectForStorage } from "../services/auto-save";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { HostInspectorTabs } from "./HostInspector";
import { HostRuntimeContext, type HostRuntime } from "./host-runtime";
import { hostLabelOf } from "./host-clips";
import { importRecordedFile } from "./host-assets";
import { insetStyle, resolveLayout, timelineRowSize } from "./layout";
import { createBridge } from "./bridge";
import { createPlaceholderController } from "./placeholders";
import type { EditorHostOptions } from "./types";

function runtimeFor(options: EditorHostOptions): HostRuntime {
  return { options, root: document.body, getProject: () => useProjectStore.getState().getFullProject() };
}

beforeEach(() => {
  setStorageProvider(createMemoryStorageProvider());
  useProjectStore.getState().createNewProject("Layer 2", { width: 1280, height: 720, frameRate: 30 });
});
afterEach(() => {
  cleanup();
  setStorageProvider(null);
  useUIStore.getState().clearSelection();
});

describe("layout", () => {
  it("is absent by default, so nothing changes", () => {
    expect(resolveLayout(undefined)).toBeUndefined();
    expect(timelineRowSize(undefined)).toBeUndefined();
    expect(insetStyle(undefined)).toBeUndefined();
    expect(timelineRowSize({ previewMinHeight: 200 })).toBeUndefined();
  });

  it("fills a preset and lets explicit fields win", () => {
    const layout = resolveLayout({ preset: "comfortable", trackHeight: 60, panels: { mediaWidth: 300 } });
    expect(layout).toMatchObject({ minVisibleTracks: 5, trackHeight: 60, previewMinHeight: 260 });
    expect(layout?.panels).toEqual({ mediaWidth: 300, inspectorWidth: 340 });
  });

  it("sizes the timeline from the tracks that must show, or as a percentage", () => {
    expect(timelineRowSize({ timelineHeight: "auto", minVisibleTracks: 4, trackHeight: 50 })).toBe("min(312px, 60%)");
    expect(timelineRowSize({ timelineHeight: 40 })).toBe("40%");
  });

  it("turns insets into padding and leaves unset sides alone", () => {
    expect(insetStyle({ insets: { bottom: 40, right: 20 } })).toEqual({ paddingBottom: 40, paddingRight: 20 });
    expect(insetStyle({ insets: {} })).toEqual({});
  });
});

describe("host recording", () => {
  const file = new File([new Uint8Array(1)], "rec.webm", { type: "video/webm" });
  it("imports the recording itself by default", async () => {
    const importFile = vi.fn(async () => ({ success: true }));
    await importRecordedFile(file, undefined, importFile);
    expect(importFile).toHaveBeenCalledWith(file);
  });
  it("lets the host take it first and hand back the file to import", async () => {
    const importFile = vi.fn(async () => ({ success: true }));
    const stored = new File([new Uint8Array(2)], "stored.webm");
    const record = vi.fn(async () => stored);
    await importRecordedFile(file, record, importFile);
    expect(record).toHaveBeenCalledWith(file);
    expect(importFile).toHaveBeenCalledWith(stored);
    await importRecordedFile(file, () => undefined, importFile);
    expect(importFile).toHaveBeenLastCalledWith(file);
  });
  it("reports a failure of the host instead of throwing", async () => {
    const result = await importRecordedFile(file, () => Promise.reject(new Error("no space")), async () => ({ success: true }));
    expect(result).toMatchObject({ success: false, error: { message: "no space" } });
  });
});

describe("host names and saved stills", () => {
  it("prefers the name the host gave a clip, and ignores blanks", () => {
    expect(hostLabelOf({ metadata: { host: { label: "Scene 2" } } })).toBe("Scene 2");
    expect(hostLabelOf({ metadata: { host: { label: "  " } } })).toBeUndefined();
    expect(hostLabelOf({ metadata: {} })).toBeUndefined();
    expect(hostLabelOf({})).toBeUndefined();
  });

  it("does not save stills that no clip uses, but keeps them in memory", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({ start: 0, duration: 2, label: "Gone" });
    await placeholders.idle();
    expect(stripProjectForStorage(useProjectStore.getState().project).mediaLibrary.items).toHaveLength(1);
    await useProjectStore.getState().removeClip(id);
    const project = useProjectStore.getState().project;
    expect(project.mediaLibrary.items).toHaveLength(1); // still there for undo
    expect(stripProjectForStorage(project as Project).mediaLibrary.items).toHaveLength(0);
  });
});

describe("inspector in replace mode", () => {
  const withRuntime = (options: EditorHostOptions) => (
    <HostRuntimeContext.Provider value={runtimeFor(options)}>
      <HostInspectorTabs>
        <div>native inspector</div>
      </HostInspectorTabs>
    </HostRuntimeContext.Provider>
  );

  it("shows only the host's tabs, one with nothing selected and another with a selection", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({ start: 0, duration: 2, label: "Pick" });
    await placeholders.idle();
    const seen: string[] = [];
    const options: EditorHostOptions = {
      hostPanels: {
        inspector: {
          mode: "replace",
          tabs: [
            { id: "project", label: "Project", when: (s) => s === null, mount: (el) => { seen.push("project"); el.textContent = "project"; return () => undefined; } },
            { id: "item", label: "Item", when: (s) => s !== null, mount: (el, api) => { seen.push("item"); el.textContent = `item ${Array.isArray(api.selection) ? api.selection.length : 1}`; return () => undefined; } },
          ],
        },
      },
    };
    render(withRuntime(options));
    expect(screen.queryByText("native inspector")).toBeNull();
    expect(screen.getByText("project")).toBeTruthy();

    act(() => useUIStore.getState().select({ type: "clip", id }));
    expect(screen.getByText("item 1")).toBeTruthy();
    expect(seen).toEqual(["project", "item"]);
  });

  it("without the option the editor's own inspector shows, as upstream", () => {
    render(withRuntime({}));
    expect(screen.getByText("native inspector")).toBeTruthy();
    cleanup();
    render(withRuntime({ hostPanels: { inspector: { mode: "tabs" } } }));
    expect(screen.getByText("native inspector")).toBeTruthy();
  });
});

describe("timeline.viewport on the bridge", () => {
  it("publishes the zoom and applies a viewport the host sets", async () => {
    const { bridge, dispose } = createBridge(undefined);
    useTimelineStore.getState().setZoom(120);
    expect(bridge.get("timeline.viewport")).toMatchObject({ zoom: 120 });
    await bridge.set("timeline.viewport", { zoom: 77, scrollLeft: 0, scrollTop: 0 });
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(77);
    dispose();
  });
});
