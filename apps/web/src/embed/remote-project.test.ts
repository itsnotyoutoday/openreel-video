import { describe, expect, it } from "vitest";
import type { Project } from "@openreel/core";
import { keepEditLocks } from "./remote-project";

const clip = (id: string, extra: Record<string, unknown> = {}) => ({ id, trackId: "t1", startTime: 0, duration: 1, ...extra });
const project = (tracks: Array<Record<string, unknown>>) =>
  ({ id: "p", timeline: { tracks, markers: [], subtitles: [], duration: 5 } }) as unknown as Project;

describe("keepEditLocks", () => {
  it("keeps row and clip locks the incoming project leaves out", () => {
    const current = project([
      { id: "t1", locked: true, clips: [clip("a", { locks: { move: true } }), clip("b", { locks: { trim: true } })] },
    ]);
    // a host update that knows nothing about locks: no `locked`, no `locks`
    const incoming = project([{ id: "t1", clips: [clip("a", { startTime: 2 }), clip("b"), clip("new")] }]);
    const merged = keepEditLocks(incoming, current);
    const track = merged.timeline.tracks[0];
    expect(track.locked).toBe(true);
    expect(track.clips.map((c) => c.locks)).toEqual([{ move: true }, { trim: true }, undefined]);
    expect(track.clips[0].startTime).toBe(2);
  });

  it("lets locks the incoming project states win, and returns it untouched when nothing is missing", () => {
    const current = project([{ id: "t1", locked: true, clips: [clip("a", { locks: { move: true } })] }]);
    const incoming = project([{ id: "t1", locked: false, clips: [clip("a", { locks: {} })] }]);
    const merged = keepEditLocks(incoming, current);
    expect(merged).toBe(incoming);
    expect(merged.timeline.tracks[0].locked).toBe(false);
    expect(merged.timeline.tracks[0].clips[0].locks).toEqual({});
  });
});
