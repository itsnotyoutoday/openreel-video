import "../../../test/install-local-storage-mock";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaItem, Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { HostRuntimeContext, type HostRuntime } from "../../../embed/host-runtime";
import { EffectsPanel } from "./EffectsTransitionsPanel";
import {
  PREVIEW_MODE_STORAGE_KEY,
  SAMPLE_PREVIEW,
  clipFrameUrl,
  resolvePreviewThumb,
} from "./effect-preview-media";

function media(id: string, thumbnailUrl: string): MediaItem {
  return {
    id,
    name: id,
    type: "video",
    fileHandle: null,
    blob: null,
    metadata: { duration: 4, width: 10, height: 10, frameRate: 30, codec: "", sampleRate: 0, channels: 0, fileSize: 1 },
    thumbnailUrl,
    waveformData: null,
  };
}

function projectWithTwoClips(): Project {
  const base = createEmptyProject("Previews");
  const clip = (id: string, mediaId: string, start: number) => ({
    id,
    mediaId,
    trackId: "t1",
    startTime: start,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    effects: [],
    audioEffects: [],
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
    volume: 1,
    keyframes: [],
  });
  return {
    ...base,
    mediaLibrary: { items: [media("m1", "poster-one.jpg"), media("m2", "poster-two.jpg")] },
    timeline: {
      ...base.timeline,
      tracks: [
        {
          id: "t1",
          type: "video",
          name: "V1",
          clips: [clip("c1", "m1", 0), clip("c2", "m2", 4)],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  } as Project;
}

const cardImage = (): string | null =>
  document.querySelector<HTMLImageElement>("[data-effect-preview] img")?.getAttribute("src") ?? null;

describe("effect preview media", () => {
  beforeEach(() => {
    window.localStorage.removeItem(PREVIEW_MODE_STORAGE_KEY);
    useUIStore.getState().clearSelection();
    useProjectStore.setState({ hasOpenProject: true, project: projectWithTwoClips() });
  });
  afterEach(() => {
    cleanup();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({ hasOpenProject: false, project: createEmptyProject("Reset") });
  });

  it("previews on the built-in sample, not on the first timeline clip", () => {
    render(<EffectsPanel />);
    expect(cardImage()).toBe(SAMPLE_PREVIEW.a);
    expect(screen.getByRole("button", { name: "Sample" })).toHaveAttribute("aria-pressed", "true");
  });

  it("follows the selection when set to Selected clip, and remembers the choice", () => {
    render(<EffectsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Selected clip" }));
    expect(cardImage()).toBe(SAMPLE_PREVIEW.a); // nothing selected: sample, never clip one
    expect(window.localStorage.getItem(PREVIEW_MODE_STORAGE_KEY)).toBe("clip");

    act(() => useUIStore.getState().select({ type: "clip", id: "c2" }));
    expect(cardImage()).toBe("poster-two.jpg");
    act(() => useUIStore.getState().select({ type: "clip", id: "c1" }));
    expect(cardImage()).toBe("poster-one.jpg");
    act(() => useUIStore.getState().clearSelection());
    expect(cardImage()).toBe(SAMPLE_PREVIEW.a);
  });

  it("uses the host's stills for the sample", () => {
    const runtime: HostRuntime = {
      options: { effectPreviewMedia: { still: "host-a.jpg", stillB: "host-b.jpg" } },
      root: document.body,
      getProject: () => useProjectStore.getState().project,
    };
    render(
      <HostRuntimeContext.Provider value={runtime}>
        <EffectsPanel />
      </HostRuntimeContext.Provider>,
    );
    expect(cardImage()).toBe("host-a.jpg");
  });
});

describe("resolvePreviewThumb", () => {
  it("picks the filmstrip frame nearest the playhead, and the neighbour clip for the incoming side", () => {
    const project = projectWithTwoClips();
    const items = project.mediaLibrary.items.map((item) =>
      item.id === "m1"
        ? { ...item, filmstripThumbnails: [{ timestamp: 0, url: "f0" }, { timestamp: 3, url: "f3" }] }
        : item,
    );
    const withStrip = { ...project, mediaLibrary: { items } } as Project;
    expect(clipFrameUrl(withStrip, "c1", 2.8)).toBe("f3");
    expect(clipFrameUrl(withStrip, "c1", 10)).toBe("poster-one.jpg"); // playhead off the clip: poster
    const thumb = resolvePreviewThumb({ mode: "clip", project: withStrip, selectedClipIds: ["c1"], playhead: 0.1 });
    expect(thumb).toEqual({ a: "f0", b: "poster-two.jpg" });
  });

  it("falls back to the sample when the selected clip has no image", () => {
    const project = projectWithTwoClips();
    const bare = {
      ...project,
      mediaLibrary: { items: project.mediaLibrary.items.map((m) => ({ ...m, thumbnailUrl: null })) },
    } as Project;
    expect(resolvePreviewThumb({ mode: "clip", project: bare, selectedClipIds: ["c1"], playhead: 0 })).toEqual(SAMPLE_PREVIEW);
  });
});
