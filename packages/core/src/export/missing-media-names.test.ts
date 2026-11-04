import { describe, expect, it } from "vitest";
import { getMissingExportMedia } from "./browser-capabilities";
import type { Project } from "../types/project";

const media = (id: string, name: string, blob: unknown) => ({
  id,
  name,
  type: "video",
  fileHandle: null,
  blob,
  metadata: { duration: 3, width: 1, height: 1 },
  thumbnailUrl: null,
  waveformData: null,
});
const clip = (id: string, mediaId: string, label?: string) => ({
  id,
  mediaId,
  trackId: "t",
  startTime: 0,
  duration: 3,
  inPoint: 0,
  outPoint: 3,
  ...(label ? { metadata: { host: { label } } } : {}),
});
const project = (clips: ReturnType<typeof clip>[], items: ReturnType<typeof media>[]) =>
  ({
    timeline: { tracks: [{ id: "t", type: "video", clips }] },
    mediaLibrary: { items },
  }) as unknown as Project;

describe("getMissingExportMedia", () => {
  it("names a missing clip by the display name its host gave it, else by the media's file name", () => {
    const names = getMissingExportMedia(
      project(
        [clip("c1", "m1", "Scene 2"), clip("c2", "m2")],
        [media("m1", "a1b2c3.mp4", null), media("m2", "take.mp4", null)],
      ),
    );
    expect(names).toEqual(["Scene 2", "take.mp4"]);
  });

  it("reports nothing once every referenced media has its file", () => {
    const file = new Blob([new Uint8Array(1)]);
    expect(getMissingExportMedia(project([clip("c1", "m1", "Scene 2")], [media("m1", "a.mp4", file)]))).toEqual([]);
  });
});
