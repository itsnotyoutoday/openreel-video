import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { resolveTimelinePlacement } from "./timeline-placement";

function projectWithTracks(
  tracks: Array<{
    id: string;
    type?: string;
    locked?: boolean;
    clips?: Array<{ id: string; startTime: number; duration: number }>;
  }>,
): Project {
  return {
    id: "project",
    name: "Placement",
    createdAt: 0,
    modifiedAt: 0,
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48_000,
      channels: 2,
    },
    mediaLibrary: { items: [] },
    timeline: {
      duration: 10,
      tracks: tracks.map((track) => ({
        id: track.id,
        name: track.id,
        type: track.type ?? "video",
        mode: "standard",
        locked: track.locked ?? false,
        hidden: false,
        muted: false,
        solo: false,
        transitions: [],
        clips: (track.clips ?? []).map((clip) => ({
          ...clip,
          mediaId: "media",
          trackId: track.id,
        })),
      })),
    },
  } as unknown as Project;
}

describe("resolveTimelinePlacement", () => {
  it("keeps an item on the requested row when the interval is clear", () => {
    const project = projectWithTracks([{ id: "target" }]);
    expect(
      resolveTimelinePlacement(project, {
        targetTrackId: "target",
        startTime: 2,
        duration: 3,
        policy: "stack-above",
      }),
    ).toEqual({ ok: true, trackId: "target", startTime: 2 });
  });

  it("reuses the nearest clear unlocked row above an overlap", () => {
    const project = projectWithTracks([
      { id: "far" },
      { id: "nearest" },
      {
        id: "target",
        clips: [{ id: "existing", startTime: 1, duration: 4 }],
      },
    ]);
    expect(
      resolveTimelinePlacement(project, {
        targetTrackId: "target",
        startTime: 2,
        duration: 2,
        policy: "stack-above",
      }),
    ).toEqual({ ok: true, trackId: "nearest", startTime: 2 });
  });

  it("creates one row above the highest row of the same kind when no existing row has room", () => {
    const project = projectWithTracks([
      {
        id: "above",
        clips: [{ id: "above-clip", startTime: 1, duration: 4 }],
      },
      {
        id: "target",
        clips: [{ id: "target-clip", startTime: 1, duration: 4 }],
      },
    ]);
    expect(
      resolveTimelinePlacement(project, {
        targetTrackId: "target",
        startTime: 2,
        duration: 2,
        policy: "stack-above",
        newTrackId: "new-track",
      }),
    ).toEqual({
      ok: true,
      trackId: "new-track",
      startTime: 2,
      createdTrack: { id: "new-track", position: 0, type: "video" },
    });
  });

  it("does not put a video on a free row of another kind, it creates a video row instead", () => {
    const project = projectWithTracks([
      { id: "titles", type: "text" },
      { id: "video", clips: [{ id: "a", startTime: 0, duration: 5 }] },
    ]);
    expect(
      resolveTimelinePlacement(project, {
        targetTrackId: "video",
        startTime: 1,
        duration: 2,
        policy: "stack-above",
        newTrackId: "new-video",
      }),
    ).toEqual({
      ok: true,
      trackId: "new-video",
      startTime: 1,
      createdTrack: { id: "new-video", position: 1, type: "video" },
    });
  });

  it("still reuses a free row of the same kind above, skipping rows of other kinds", () => {
    const project = projectWithTracks([
      { id: "video-above" },
      { id: "titles", type: "text" },
      { id: "video", clips: [{ id: "a", startTime: 0, duration: 5 }] },
    ]);
    expect(
      resolveTimelinePlacement(project, {
        targetTrackId: "video",
        startTime: 1,
        duration: 2,
        policy: "stack-above",
      }),
    ).toEqual({ ok: true, trackId: "video-above", startTime: 1 });
  });

  it("applies the same kind rule in projects that use universal tracks", () => {
    const project = projectWithTracks([
      { id: "titles", type: "text" },
      { id: "video", clips: [{ id: "a", startTime: 0, duration: 5 }] },
    ]);
    (project as { capabilities?: string[] }).capabilities = ["universal-tracks-v1"];
    expect(
      resolveTimelinePlacement(project, {
        targetTrackId: "video",
        startTime: 1,
        duration: 2,
        policy: "stack-above",
      }),
    ).toMatchObject({ ok: true, startTime: 1, createdTrack: { position: 1, type: "video" } });
  });

  it("gives an item dropped on a row of another kind a new row of its own kind above its highest row", () => {
    const project = projectWithTracks([
      { id: "titles", type: "text" },
      { id: "video", clips: [{ id: "a", startTime: 0, duration: 5 }] },
      { id: "voice", type: "audio" },
    ]);
    expect(
      resolveTimelinePlacement(project, {
        targetTrackId: "titles",
        startTime: 8,
        duration: 2,
        policy: "stack-above",
        newTrackId: "new-video",
        itemType: "video",
      }),
    ).toEqual({
      ok: true,
      trackId: "new-video",
      startTime: 8,
      createdTrack: { id: "new-video", position: 1, type: "video" },
    });
  });
});
