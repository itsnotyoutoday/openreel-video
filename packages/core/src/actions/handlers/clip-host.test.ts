import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../action-executor";
import type { Action } from "../../types/actions";
import type { Project } from "../../types/project";

function makeProject(): Project {
  const clip = {
    id: "c1",
    mediaId: "m1",
    trackId: "t1",
    startTime: 2,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    volume: 1,
    keyframes: [],
  };
  const media = (id: string, duration: number) => ({
    id,
    name: id,
    type: "image",
    fileHandle: null,
    blob: null,
    metadata: { duration, width: 1, height: 1 },
    thumbnailUrl: null,
    waveformData: null,
  });
  return {
    id: "p1",
    name: "Test",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: {
      duration: 6,
      tracks: [
        {
          id: "t1",
          type: "video",
          name: "V1",
          clips: [clip],
          transitions: [{ id: "tr1", clipAId: "c1", clipBId: "c2", type: "crossfade", duration: 0.5 }],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      subtitles: [],
      markers: [],
    },
    mediaLibrary: { items: [media("m1", 0), media("m2", 0)] },
  } as unknown as Project;
}

const act = (type: string, params: Record<string, unknown>): Action =>
  ({ id: `a-${type}-${Math.random()}`, type, params, timestamp: Date.now() }) as unknown as Action;

describe("clip/setMetadata", () => {
  it("sets host metadata and restores the previous value on undo and redo", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();

    const result = await executor.execute(
      act("clip/setMetadata", { clipId: "c1", metadata: { host: { shotId: "s9" } } }),
      project,
    );
    expect(result.success).toBe(true);
    expect(project.timeline.tracks[0].clips[0].metadata).toEqual({ host: { shotId: "s9" } });

    await executor.undo(project);
    expect(project.timeline.tracks[0].clips[0].metadata).toBeUndefined();

    await executor.redo(project);
    expect(project.timeline.tracks[0].clips[0].metadata).toEqual({ host: { shotId: "s9" } });
  });

  it("keeps host metadata on both halves of a split and on a duplicate", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(
      act("clip/setMetadata", { clipId: "c1", metadata: { host: { shotId: "s9" } } }),
      project,
    );

    await executor.execute(act("clip/split", { clipId: "c1", time: 4 }), project);
    const clips = project.timeline.tracks[0].clips;
    expect(clips).toHaveLength(2);
    for (const clip of clips) expect(clip.metadata?.host).toEqual({ shotId: "s9" });

    await executor.execute(
      act("clip/add", {
        trackId: "t1",
        mediaId: "m1",
        startTime: 10,
        sourceClip: clips[0],
      }),
      project,
    );
    expect(project.timeline.tracks[0].clips.at(-1)?.metadata?.host).toEqual({ shotId: "s9" });
  });

  it("rejects non-object metadata", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const result = await executor.execute(
      act("clip/setMetadata", { clipId: "c1", metadata: "nope" }),
      project,
    );
    expect(result.success).toBe(false);
  });
});

describe("clip/replaceMedia", () => {
  it("swaps the media but keeps position, duration, transitions and metadata, and undoes cleanly", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(
      act("clip/setMetadata", {
        clipId: "c1",
        metadata: { host: { shotId: "s9" }, placeholder: { pattern: "bars", label: "Shot 9" } },
      }),
      project,
    );

    const result = await executor.execute(
      act("clip/replaceMedia", {
        clipId: "c1",
        mediaId: "m2",
        metadata: { host: { shotId: "s9" } },
      }),
      project,
    );
    expect(result.success).toBe(true);
    const clip = project.timeline.tracks[0].clips[0];
    expect(clip).toMatchObject({ mediaId: "m2", startTime: 2, duration: 4, inPoint: 0, outPoint: 4 });
    expect(clip.metadata).toEqual({ host: { shotId: "s9" } });
    expect(project.timeline.tracks[0].transitions).toHaveLength(1);

    await executor.undo(project);
    const restored = project.timeline.tracks[0].clips[0];
    expect(restored.mediaId).toBe("m1");
    expect(restored.metadata?.placeholder?.label).toBe("Shot 9");
  });

  it("rejects unknown media", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const result = await executor.execute(
      act("clip/replaceMedia", { clipId: "c1", mediaId: "missing" }),
      project,
    );
    expect(result.success).toBe(false);
  });
});
