import { describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "../action-executor";
import type { Action } from "../../types/actions";
import type { Project } from "../../types/project";

const clip = (id: string, start: number, groupId?: string) => ({
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
  ...(groupId ? { groupId } : {}),
});

function makeProject(locked = true): Project {
  return {
    id: "p1",
    name: "Groups",
    createdAt: 0,
    modifiedAt: 0,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    clipGroups: [{ id: "g1", locked, label: "Scene 1", color: "#c2410c" }],
    timeline: {
      duration: 12,
      tracks: [
        {
          id: "t1",
          type: "video",
          name: "V1",
          // a, b, c form the group; d is free
          clips: [clip("a", 0, "g1"), clip("b", 2, "g1"), clip("c", 4, "g1"), clip("d", 8)],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
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

const clipsOf = (project: Project) => project.timeline.tracks[0].clips;

describe("locked clip groups", () => {
  it("refuses the edits that would break the chain and tells the listener what was attempted", async () => {
    const executor = new ActionExecutor();
    const listener = vi.fn();
    executor.setLockedActionListener(listener);
    const project = makeProject();
    const before = JSON.stringify(project.timeline);

    const attempts: Array<[string, Record<string, unknown>, string]> = [
      ["clip/move", { clipId: "b", startTime: 5 }, "move"],
      ["clip/split", { clipId: "b", time: 3 }, "split"],
      ["clip/remove", { clipId: "b" }, "delete"],
      ["clip/rippleDelete", { clipId: "b" }, "delete"],
      ["clip/trim", { clipId: "b", inPoint: 0.5 }, "trim"], // inside boundary (start of a middle clip)
      ["clip/trim", { clipId: "b", outPoint: 1.5 }, "trim"], // inside boundary (end of a middle clip)
      ["clip/trim", { clipId: "a", outPoint: 1.5 }, "trim"], // inside boundary (end of the first clip)
      ["clip/trim", { clipId: "c", inPoint: 0.5 }, "trim"], // inside boundary (start of the last clip)
      ["clip/slip", { clipId: "b", delta: 0.5 }, "retime"],
      ["clip/setSpeed", { clipId: "b", speed: 2 }, "retime"],
      ["clip/closeGapBefore", { clipId: "c" }, "retime"],
    ];
    for (const [type, params, kind] of attempts) {
      const result = await executor.execute(act(type, params), project);
      expect(result.success, `${type} ${JSON.stringify(params)}`).toBe(false);
      expect(result.error?.code).toBe("GROUP_LOCKED");
      expect(result.error?.details).toMatchObject({ groupId: "g1", action: kind });
    }
    expect(listener).toHaveBeenCalledTimes(attempts.length);
    expect(listener).toHaveBeenLastCalledWith({ groupId: "g1", action: "retime" });
    expect(JSON.stringify(project.timeline)).toBe(before);
  });

  it("allows the outer ends, per-clip effects, volume and colour, and edits to clips outside the group", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();

    expect((await executor.execute(act("clip/trim", { clipId: "a", inPoint: 0.5 }), project)).success).toBe(true); // outer start
    expect((await executor.execute(act("clip/trim", { clipId: "c", outPoint: 1.5 }), project)).success).toBe(true); // outer end
    expect((await executor.execute(act("clip/setBlendMode", { clipId: "b", blendMode: "multiply" }), project)).success).toBe(true);
    expect((await executor.execute(act("clip/setBlendOpacity", { clipId: "b", opacity: 50 }), project)).success).toBe(true);
    expect((await executor.execute(act("clip/move", { clipId: "d", startTime: 9 }), project)).success).toBe(true);
    expect((await executor.execute(act("clip/split", { clipId: "d", time: 10 }), project)).success).toBe(true);
    expect(clipsOf(project).find((c) => c.id === "b")?.blendMode).toBe("multiply");
  });

  it("moves and removes the whole group as a unit, with undo", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();

    expect((await executor.execute(act("clip/moveGroup", { groupId: "g1", delta: 1 }), project)).success).toBe(true);
    expect(clipsOf(project).filter((c) => c.groupId === "g1").map((c) => c.startTime)).toEqual([1, 3, 5]);
    await executor.undo(project);
    expect(clipsOf(project).filter((c) => c.groupId === "g1").map((c) => c.startTime)).toEqual([0, 2, 4]);

    const tooFar = await executor.execute(act("clip/moveGroup", { groupId: "g1", delta: -1 }), project);
    expect(tooFar.success).toBe(false);

    expect((await executor.execute(act("clip/removeGroup", { groupId: "g1" }), project)).success).toBe(true);
    expect(clipsOf(project).map((c) => c.id)).toEqual(["d"]);
    await executor.undo(project);
    expect(clipsOf(project).map((c) => c.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("lets everything through once the group is unlocked or the clip has no group, and undoes group changes", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    const unlock = await executor.execute(
      act("project/setClipGroups", { groups: [{ id: "g1", locked: false, label: "Scene 1" }] }),
      project,
    );
    expect(unlock.success).toBe(true);
    expect((await executor.execute(act("clip/split", { clipId: "b", time: 3 }), project)).success).toBe(true);

    await executor.undo(project); // the split
    await executor.undo(project); // the unlock
    expect(project.clipGroups?.[0].locked).toBe(true);
    expect((await executor.execute(act("clip/split", { clipId: "b", time: 3 }), project)).success).toBe(false);

    const ungrouped = await executor.execute(act("clip/setGroup", { clipId: "b" }), project);
    expect(ungrouped.success).toBe(true);
    expect(clipsOf(project).find((c) => c.id === "b")?.groupId).toBeUndefined();
    expect((await executor.execute(act("clip/split", { clipId: "b", time: 3 }), project)).success).toBe(true);
  });

  it("rejects malformed group definitions", async () => {
    const executor = new ActionExecutor();
    const project = makeProject();
    expect((await executor.execute(act("project/setClipGroups", { groups: "no" }), project)).success).toBe(false);
    expect((await executor.execute(act("clip/moveGroup", { groupId: "nope", delta: 1 }), project)).success).toBe(false);
  });
});

describe("beforeEdit guard", () => {
  it("lets edits through by default and refuses the ones the host vetoes, with its own message", async () => {
    const executor = new ActionExecutor();
    const project = makeProject(false);
    expect((await executor.execute(act("clip/move", { clipId: "d", startTime: 9 }), project)).success).toBe(true);

    const seen: string[] = [];
    executor.setBeforeEditGuard((op) => {
      seen.push(op.type);
      if (op.type === "clip/split") return { ok: false, reason: "Splitting is not allowed in this cut" };
    });
    const vetoed = await executor.execute(act("clip/split", { clipId: "d", time: 10 }), project);
    expect(vetoed.success).toBe(false);
    expect(vetoed.error).toMatchObject({ code: "HOST_VETO", message: "Splitting is not allowed in this cut" });
    expect(clipsOf(project).map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect((await executor.execute(act("clip/move", { clipId: "d", startTime: 10 }), project)).success).toBe(true);
    expect(seen).toEqual(["clip/split", "clip/move"]);

    // undo is never asked, and a guard that throws does not stop editing
    seen.length = 0;
    await executor.undo(project);
    expect(seen).toEqual([]);
    executor.setBeforeEditGuard(() => {
      throw new Error("boom");
    });
    expect((await executor.execute(act("clip/move", { clipId: "d", startTime: 11 }), project)).success).toBe(true);
  });
});

describe("groups that list their members (the shape a host's server state has)", () => {
  // three consecutive video clips with a linked caption clip and voice clip under each
  const series = () => {
    const project = makeProject(false);
    const track = (id: string, type: string, clips: ReturnType<typeof clip>[]) => ({
      id,
      type,
      name: id,
      clips: clips.map((c) => ({ ...c, trackId: id })),
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    });
    const tracks = [
      track("video", "video", [clip("v1", 0), clip("v2", 2), clip("v3", 4)]),
      track("captions", "text", [clip("c1", 0), clip("c2", 2), clip("c3", 4)]),
      track("voice", "audio", [clip("a1", 0), clip("a2", 2), clip("a3", 4)]),
      track("other", "video", [clip("free", 9)]),
    ];
    (project.timeline as unknown as { tracks: unknown[] }).tracks = tracks;
    (project as unknown as { clipGroups: unknown[] }).clipGroups = [];
    return project;
  };
  const all = (project: Project) => project.timeline.tracks.flatMap((t) => t.clips);
  const members = ["v1", "v2", "v3", "c1", "c2", "c3", "a1", "a2", "a3"];

  it("one setClipGroups call defines the group and gives every listed clip its groupId", async () => {
    const executor = new ActionExecutor();
    const project = series();
    const result = await executor.execute(
      act("project/setClipGroups", { groups: [{ id: "series", locked: true, label: "Scenes 2-4", clipIds: members }] }),
      project,
    );
    expect(result.success).toBe(true);
    expect(all(project).filter((c) => c.groupId === "series").map((c) => c.id).sort()).toEqual([...members].sort());
    expect(all(project).find((c) => c.id === "free")?.groupId).toBeUndefined();
    // membership lives on the clips, not on the stored group
    expect(project.clipGroups).toEqual([{ id: "series", locked: true, label: "Scenes 2-4" }]);
  });

  it("dragging any member moves the whole series, captions and voice included; single moves are refused", async () => {
    const executor = new ActionExecutor();
    const project = series();
    await executor.execute(act("project/setClipGroups", { groups: [{ id: "series", locked: true, clipIds: members }] }), project);

    expect((await executor.execute(act("clip/move", { clipId: "v2", startTime: 5 }), project)).error?.code).toBe("GROUP_LOCKED");
    expect((await executor.execute(act("clip/moveGroup", { groupId: "series", delta: 1.5 }), project)).success).toBe(true);
    expect(all(project).filter((c) => c.groupId === "series").map((c) => c.startTime).sort((a, b) => a - b)).toEqual([1.5, 1.5, 1.5, 3.5, 3.5, 3.5, 5.5, 5.5, 5.5]);
    expect(all(project).find((c) => c.id === "free")?.startTime).toBe(9);
  });

  it("a later call replaces the membership, and undo restores the earlier one", async () => {
    const executor = new ActionExecutor();
    const project = series();
    await executor.execute(act("project/setClipGroups", { groups: [{ id: "series", locked: true, clipIds: members }] }), project);
    await executor.execute(act("project/setClipGroups", { groups: [{ id: "series", locked: true, clipIds: ["v1", "v2"] }] }), project);
    expect(all(project).filter((c) => c.groupId === "series").map((c) => c.id).sort()).toEqual(["v1", "v2"]);
    await executor.undo(project);
    expect(all(project).filter((c) => c.groupId === "series")).toHaveLength(9);
  });
});
