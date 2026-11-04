import { describe, expect, it } from "vitest";
import { ActionExecutor } from "./action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";
import type { ClipLocks } from "../types/timeline";

const clip = (id: string, start: number, locks?: ClipLocks, groupId?: string) => ({
  id,
  mediaId: "m1",
  trackId: "t1",
  startTime: start,
  duration: 2,
  inPoint: 0,
  outPoint: 2,
  effects: [],
  audioEffects: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  volume: 1,
  keyframes: [],
  ...(locks ? { locks } : {}),
  ...(groupId ? { groupId } : {}),
});

function makeProject(): Project {
  const track = (id: string, name: string, clips: unknown[], locked = false) => ({
    id,
    type: "video",
    name,
    clips,
    transitions: [],
    locked,
    hidden: false,
    muted: false,
    solo: false,
  });
  return {
    id: "p1",
    name: "Locks",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    clipGroups: [{ id: "g1", locked: false }],
    timeline: {
      duration: 20,
      tracks: [
        // a: move-locked, b: trim-locked, c: free (after a), g: free group member after b
        track("t1", "Video", [clip("a", 0, { move: true }), clip("b", 4, { trim: true }), clip("c", 8)]),
        track("t2", "Video 2", [{ ...clip("g", 0, { move: true }, "g1"), trackId: "t2" }]),
        track("t3", "Video 3", [{ ...clip("z", 0), trackId: "t3" }], true),
      ],
      subtitles: [],
      markers: [],
    },
    mediaLibrary: {
      items: [
        { id: "m1", name: "m1", type: "image", fileHandle: null, blob: null, metadata: { duration: 0, width: 1, height: 1 }, thumbnailUrl: null, waveformData: null },
      ],
    },
  } as unknown as Project;
}

const act = (type: string, params: Record<string, unknown>): Action =>
  ({ id: `a-${type}-${Math.random()}`, type, params, timestamp: Date.now() }) as unknown as Action;

describe("edit locks", () => {
  it("refuses moving a move-locked clip and trimming a trim-locked one, with CLIP_LOCKED", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const before = JSON.stringify(project.timeline);
    const refused: Array<[string, Record<string, unknown>]> = [
      ["clip/move", { clipId: "a", startTime: 12 }],
      ["clip/move", { clipId: "a", startTime: 0, trackId: "t2" }],
      ["clip/trim", { clipId: "b", outPoint: 1 }],
      ["clip/split", { clipId: "b", time: 5 }],
      ["clip/restoreTiming", { clipId: "b", startTime: 4, duration: 1, inPoint: 0, outPoint: 1 }],
      ["clip/restoreTiming", { clipId: "a", startTime: 1, duration: 2, inPoint: 0, outPoint: 2 }],
      ["clip/moveGroup", { groupId: "g1", delta: 1 }],
    ];
    for (const [type, params] of refused) {
      const result = await executor.execute(act(type, params), project);
      expect(result.success, `${type} ${JSON.stringify(params)}`).toBe(false);
      expect(result.error?.code).toBe("CLIP_LOCKED");
    }
    expect(JSON.stringify(project.timeline)).toBe(before);
  });

  it("allows the edits a lock does not cover", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    // a is only move-locked: trimming its end is fine; b is only trim-locked: moving it is fine
    expect((await executor.execute(act("clip/trim", { clipId: "a", outPoint: 1.5 }), project)).success).toBe(true);
    expect((await executor.execute(act("clip/move", { clipId: "b", startTime: 14 }), project)).success).toBe(true);
    // a move to the same place is not a move
    expect((await executor.execute(act("clip/move", { clipId: "a", startTime: 0 }), project)).success).toBe(true);
  });

  it("refuses a ripple delete that would shift a move-locked clip", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const row = project.timeline.tracks[0] as unknown as { clips: Array<ReturnType<typeof clip>> };
    // first (0-2), then the move-locked a (2-4), which a ripple delete of first would shift left
    row.clips = [clip("first", 0), { ...clip("a", 2), locks: { move: true } }, ...row.clips.slice(1)];
    const result = await executor.execute(act("clip/rippleDelete", { clipId: "first" }), project);
    expect(result.error?.code).toBe("CLIP_LOCKED");
  });

  it("refuses timing edits on a locked row that the validator does not cover", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const result = await executor.execute(
      act("clip/restoreTiming", { clipId: "z", startTime: 3, duration: 2, inPoint: 0, outPoint: 2 }),
      project,
    );
    expect(result.error?.code).toBe("TRACK_LOCKED");
  });

  it("lets the host change its own clip with hostEdit, and clip/setLocks sets and clears locks undoably", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const host = await executor.execute(
      act("clip/restoreTiming", { clipId: "b", startTime: 4, duration: 3, inPoint: 0, outPoint: 3, hostEdit: true }),
      project,
    );
    expect(host.success).toBe(true);

    expect((await executor.execute(act("clip/setLocks", { clipId: "c", locks: { move: true } }), project)).success).toBe(true);
    expect(project.timeline.tracks[0].clips.find((c) => c.id === "c")?.locks).toEqual({ move: true });
    expect((await executor.execute(act("clip/move", { clipId: "c", startTime: 15 }), project)).error?.code).toBe("CLIP_LOCKED");
    await executor.undo(project);
    expect(project.timeline.tracks[0].clips.find((c) => c.id === "c")?.locks).toBeUndefined();
    expect((await executor.execute(act("clip/setLocks", { clipId: "c", locks: "yes" }), project)).success).toBe(false);
  });

  it("keeps locks on both halves of a split", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    expect((await executor.execute(act("clip/split", { clipId: "a", time: 1 }), project)).success).toBe(true);
    const halves = project.timeline.tracks[0].clips.filter((c) => c.startTime < 2);
    expect(halves).toHaveLength(2);
    for (const half of halves) expect(half.locks).toEqual({ move: true });
  });

  it("names a row added without a name by its kind, never 'Track N' and never a used label", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    await executor.execute(act("track/add", { trackType: "video", mode: "standard", trackId: "n1" }), project);
    await executor.execute(act("track/add", { trackType: "audio", trackId: "n2" }), project);
    await executor.execute(act("track/add", { trackType: "video", mode: "standard", trackId: "n3" }), project);
    const names = Object.fromEntries(project.timeline.tracks.map((t) => [t.id, t.name]));
    expect(names.n1).toBe("Video 4");
    expect(names.n2).toBe("Audio 1");
    expect(names.n3).toBe("Video 5");
  });
});
