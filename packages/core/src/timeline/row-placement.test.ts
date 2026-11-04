import { describe, expect, it } from "vitest";
import { ActionExecutor } from "../actions/action-executor";
import type { Action } from "../types/actions";
import type { Project } from "../types/project";
import { createEmptyRow, nextRowName, normalizeLoadedOverlaps } from "./row-placement";
import { resolveTimelinePlacement } from "./timeline-placement";

const clip = (id: string, trackId: string, start: number, duration = 2, groupId?: string) => ({
  id,
  mediaId: "m1",
  trackId,
  startTime: start,
  duration,
  inPoint: 0,
  outPoint: duration,
  effects: [],
  audioEffects: [],
  transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, anchor: { x: 0.5, y: 0.5 }, opacity: 1 },
  volume: 1,
  keyframes: [],
  ...(groupId ? { groupId } : {}),
});

const row = (id: string, type: string, name: string, clips: ReturnType<typeof clip>[]) => ({
  id,
  type,
  name,
  clips,
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
});

function project(tracks: ReturnType<typeof row>[], extra: Record<string, unknown> = {}): Project {
  return {
    id: "p",
    name: "P",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    timeline: { duration: 20, tracks, subtitles: [], markers: [] },
    mediaLibrary: { items: [] },
    ...extra,
  } as unknown as Project;
}

const act = (type: string, params: Record<string, unknown>): Action =>
  ({ id: `a-${type}-${Math.random()}`, type, params, timestamp: Date.now() }) as unknown as Action;

const typeOf = (p: Project, clipId: string) =>
  p.timeline.tracks.find((t) => t.clips.some((c) => c.id === clipId))?.type;

describe("a clip never lands on a free row of another kind", () => {
  it("makes a new row of the target's kind even when the project carries the universal-tracks flag", () => {
    const p = project(
      [row("text", "text", "Text 1", []), row("video", "video", "Video 1", [clip("x", "video", 0, 4)])],
      { capabilities: { universalTracks: true } },
    );
    const placement = resolveTimelinePlacement(p, { targetTrackId: "video", startTime: 1, duration: 2, policy: "stack-above", newTrackId: "new" });
    if (!placement.ok) throw new Error("placement failed");
    expect(placement.createdTrack).toMatchObject({ id: "new", type: "video" });
  });

  it("reuses a free row of the same kind", () => {
    const p = project([row("v2", "video", "Video 2", []), row("v1", "video", "Video 1", [clip("x", "v1", 0, 4)])]);
    const placement = resolveTimelinePlacement(p, { targetTrackId: "v1", startTime: 1, duration: 2, policy: "stack-above", newTrackId: "new" });
    if (!placement.ok) throw new Error("placement failed");
    expect(placement.createdTrack).toBeUndefined();
    expect(placement.trackId).toBe("v2");
  });
});

describe("clip/moveGroup onto an occupied span", () => {
  const grouped = () =>
    project(
      [
        row("text", "text", "Text 1", []),
        row("v2", "video", "Video 2", [clip("o", "v2", 10, 6)]),
        row("v1", "video", "Video 1", [clip("a", "v1", 0, 2, "g"), clip("b", "v1", 2, 2, "g"), clip("c", "v1", 4, 2, "g")]),
      ],
      { clipGroups: [{ id: "g", locked: true }] },
    );

  it("keeps all members together on ONE new video row, never the Text row, and undo restores", async () => {
    const executor = new ActionExecutor();
    const p = grouped();
    const result = await executor.execute(
      act("clip/moveGroup", { groupId: "g", delta: 10, fromTrackId: "v1", targetTrackId: "v2" }),
      p,
    );
    expect(result.success).toBe(true);
    const rows = p.timeline.tracks;
    const home = rows.find((t) => t.clips.some((c) => c.id === "a"));
    expect(home?.type).toBe("video");
    expect(home?.id).not.toBe("v2");
    expect(home?.clips.map((c) => c.id).sort()).toEqual(["a", "b", "c"]);
    expect(home?.clips.every((c) => c.trackId === home.id)).toBe(true);
    expect(rows.find((t) => t.id === "text")?.clips).toHaveLength(0);
    expect(rows[rows.findIndex((t) => t.id === "v2") - 1].id).toBe(home?.id); // directly above the target row
    expect(rows.map((t) => t.name)).toContain("Video 3");

    await executor.undo(p);
    expect(p.timeline.tracks.map((t) => t.id)).toEqual(["text", "v2", "v1"]);
    expect(typeOf(p, "a")).toBe("video");
    expect(p.timeline.tracks.find((t) => t.id === "v1")?.clips.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("moves to the target row when the span is free there", async () => {
    const executor = new ActionExecutor();
    const p = grouped();
    await executor.execute(act("clip/moveGroup", { groupId: "g", delta: 1, fromTrackId: "v1", targetTrackId: "v2" }), p);
    expect(p.timeline.tracks.find((t) => t.id === "v2")?.clips.map((c) => c.id).sort()).toEqual(["a", "b", "c", "o"]);
  });

  it("never moves to a target row of another kind", async () => {
    const executor = new ActionExecutor();
    const p = grouped();
    await executor.execute(act("clip/moveGroup", { groupId: "g", delta: 1, fromTrackId: "v1", targetTrackId: "text" }), p);
    expect(p.timeline.tracks.find((t) => t.id === "text")?.clips).toHaveLength(0);
    expect(typeOf(p, "a")).toBe("video");
  });
});

describe("normalizeLoadedOverlaps", () => {
  it("moves a later overlapping clip to a new row of the SAME kind, directly above, with a stable name", () => {
    const p = project([
      row("text", "text", "Text 1", []),
      row("v1", "video", "Video 1", [clip("a", "v1", 0, 4), clip("b", "v1", 2, 4)]),
    ]);
    const out = normalizeLoadedOverlaps(p);
    const ids = out.timeline.tracks.map((t) => t.id);
    expect(ids).toHaveLength(3);
    const overflow = out.timeline.tracks[1];
    expect(overflow.type).toBe("video");
    expect(overflow.name).toBe("Video 2");
    expect(overflow.clips.map((c) => [c.id, c.trackId])).toEqual([["b", overflow.id]]);
    expect(out.timeline.tracks.find((t) => t.id === "text")?.clips).toHaveLength(0);
    expect(out.timeline.tracks[2].clips.map((c) => c.id)).toEqual(["a"]);
  });

  it("returns the very same project when nothing overlaps", () => {
    const p = project([row("v1", "video", "Video 1", [clip("a", "v1", 0, 2), clip("b", "v1", 2, 2)])]);
    expect(normalizeLoadedOverlaps(p)).toBe(p);
  });

  it("numbers a new row above every row of its kind, a bare 'Video' counting as 1, never reusing a label", () => {
    const named = (type: string, name: string) => ({ type, name }) as never;
    expect(nextRowName([named("text", "Text"), named("video", "Video")], "video")).toBe("Video 2");
    expect(nextRowName([named("video", "Video 2"), named("video", "Video")], "video")).toBe("Video 3");
    // an emptied or renamed row in between never leads to a duplicate
    expect(nextRowName([named("video", "Video 3"), named("video", "Video")], "video")).toBe("Video 4");
    expect(nextRowName([named("video", "Video"), named("audio", "Voice"), named("audio", "Music")], "audio")).toBe("Audio 3");
  });

  it("names rows like the editor does", () => {
    expect(createEmptyRow([], "text").name).toBe("Text 1");
    expect(createEmptyRow([{ type: "video" } as never], "video").name).toBe("Video 2");
  });
});
