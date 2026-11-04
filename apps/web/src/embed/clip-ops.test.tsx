// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createMemoryStorageProvider } from "@openreel/core";
import { setStorageProvider } from "../services/storage/storage-context";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { HostInspectorTabs } from "./HostInspector";
import { HostRuntimeContext, type HostRuntime } from "./host-runtime";
import { removeClipOp, replaceClipMedia, updateClip } from "./clip-ops";
import { createPlaceholderController } from "./placeholders";
import type { EditorHostOptions, HostSelection } from "./types";

const clips = () => useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips);
const clip = (id: string) => clips().find((c) => c.id === id);
// history entries are ordered by millisecond timestamps
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => {
  setStorageProvider(createMemoryStorageProvider());
  useProjectStore.getState().createNewProject("Clip ops", { width: 1280, height: 720, frameRate: 30 });
});
afterEach(() => {
  cleanup();
  setStorageProvider(null);
  useUIStore.getState().clearSelection();
});

async function twoClips() {
  const placeholders = createPlaceholderController();
  const a = placeholders.add({ start: 0, duration: 2, label: "A", metadata: { shotId: "a" } });
  await placeholders.idle();
  const trackId = useProjectStore.getState().project.timeline.tracks[0].id;
  const b = placeholders.add({ trackId, start: 2, duration: 2, label: "B" });
  await placeholders.idle();
  return { a, b, trackId };
}

describe("updateClip", () => {
  it("changes volume, fades and the display name in one undo step", async () => {
    const { a } = await twoClips();
    await tick();
    await updateClip(a, { volume: 0.5, fadeIn: 0.3, fadeOut: 0.6, name: "Scene 2" });
    expect(clip(a)).toMatchObject({ volume: 0.5, fade: { fadeIn: 0.3, fadeOut: 0.6 } });
    expect(clip(a)?.metadata?.host).toMatchObject({ label: "Scene 2", shotId: "a" });

    // one undo takes all three changes back
    await useProjectStore.getState().undo();
    expect(clip(a)?.volume).toBe(1);
    expect(clip(a)?.fade ?? { fadeIn: 0, fadeOut: 0 }).toEqual({ fadeIn: 0, fadeOut: 0 });
    expect(clip(a)?.metadata?.host).toEqual({ shotId: "a" });
  });

  it("rejects bad numbers and unknown clips without changing anything", async () => {
    const { a } = await twoClips();
    await expect(updateClip(a, { volume: -1 })).rejects.toThrow(/volume/);
    await expect(updateClip(a, { fadeIn: Number.NaN })).rejects.toThrow(/fadeIn/);
    await expect(updateClip("nope", { volume: 1 })).rejects.toThrow(/No timeline clip/);
    expect(clip(a)?.volume).toBe(1);
  });
});

describe("replaceClipMedia", () => {
  it("keeps position, duration and metadata, shortens to a shorter media, and takes the media's length on request", async () => {
    const { a } = await twoClips();
    const addMedia = (id: string, duration: number) =>
      useProjectStore.setState((state) => ({
        project: {
          ...state.project,
          mediaLibrary: {
            ...state.project.mediaLibrary,
            items: [
              ...state.project.mediaLibrary.items,
              { id, name: id, type: "video", fileHandle: null, blob: null, metadata: { duration, width: 1, height: 1, frameRate: 30, codec: "", sampleRate: 0, channels: 0, fileSize: 1 }, thumbnailUrl: null, waveformData: null },
            ],
          },
        },
      }));
    addMedia("long", 10);
    addMedia("short", 1);

    await replaceClipMedia(a, "long");
    expect(clip(a)).toMatchObject({ mediaId: "long", startTime: 0, duration: 2 });
    expect(clip(a)?.metadata?.placeholder).toBeUndefined();
    expect(clip(a)?.metadata?.host).toEqual({ shotId: "a" });

    await tick();
    await replaceClipMedia(a, "short");
    expect(clip(a)?.duration).toBe(1);
    await tick();
    await replaceClipMedia(a, "long", { duration: "media" });
    expect(clip(a)?.duration).toBe(10);

    await tick();
    await useProjectStore.getState().undo();
    expect(clip(a)?.mediaId).toBe("short");
    await expect(replaceClipMedia(a, "missing")).rejects.toThrow(/No media item/);
  });
});

describe("removeClip", () => {
  it("removes a clip, or closes the gap after it with ripple", async () => {
    const { a, b } = await twoClips();
    await removeClipOp(a, { ripple: true });
    expect(clip(a)).toBeUndefined();
    expect(clip(b)?.startTime).toBe(0);

    const second = await twoClips();
    await removeClipOp(second.a);
    expect(clip(second.a)).toBeUndefined();
    expect(clip(second.b)?.startTime).toBe(2);
    await expect(removeClipOp("nope")).rejects.toThrow(/No timeline clip/);
  });
});

describe("inspector selections", () => {
  function runtimeFor(options: EditorHostOptions): HostRuntime {
    return { options, root: document.body, getProject: () => useProjectStore.getState().getFullProject() };
  }

  it("gives tabs null, a clip, an array of clips, or a join, and lets them replace the inspector", async () => {
    const { a, b, trackId } = await twoClips();
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          tracks: state.project.timeline.tracks.map((t) =>
            t.id === trackId ? { ...t, transitions: [{ id: "tr1", clipAId: a, clipBId: b, type: "crossfade", duration: 0.5, params: {} }] } : t,
          ),
        },
      },
    }));
    const seen: HostSelection[] = [];
    const options: EditorHostOptions = {
      hostPanels: {
        inspector: {
          mode: "replace",
          tabs: [{ id: "all", label: "All", mount: (el, api) => { api.onSelectionChange((s) => seen.push(s)); el.textContent = "host column"; return () => undefined; } }],
        },
      },
    };
    render(
      <HostRuntimeContext.Provider value={runtimeFor(options)}>
        <HostInspectorTabs>
          <div>native inspector</div>
        </HostInspectorTabs>
      </HostRuntimeContext.Provider>,
    );
    expect(screen.getByText("host column")).toBeTruthy();
    expect(screen.queryByText("native inspector")).toBeNull();

    act(() => useUIStore.getState().select({ type: "clip", id: a, trackId }));
    act(() => useUIStore.getState().selectMultiple([{ type: "clip", id: a, trackId }, { type: "clip", id: b, trackId }]));
    act(() => useUIStore.getState().select({ type: "transition", id: "tr1", trackId }));
    act(() => useUIStore.getState().clearSelection());

    expect(seen).toHaveLength(4);
    expect(seen[0]).toMatchObject({ id: a, type: "placeholder" });
    expect(Array.isArray(seen[1]) && (seen[1] as unknown[]).length).toBe(2);
    expect(seen[2]).toEqual({ join: { between: [a, b] } });
    expect(seen[3]).toBeNull();
  });
});
