import { describe, expect, it } from "vitest";
import type { MediaItem } from "@openreel/core";
import { needsWaveform } from "./waveform-hydration";

const item = (patch: Partial<MediaItem> & { hasAudio?: boolean }): MediaItem =>
  ({
    id: "m",
    name: "m.wav",
    type: "audio",
    fileHandle: null,
    blob: new Blob(["x"]),
    thumbnailUrl: null,
    waveformData: null,
    ...patch,
    metadata: { duration: 1, width: 0, height: 0, frameRate: 0, codec: "", sampleRate: 8000, channels: 1, fileSize: 1, hasAudio: patch.hasAudio },
  }) as MediaItem;

describe("needsWaveform", () => {
  it("is true for sound whose peaks were dropped (a reopened or host-loaded project)", () => {
    expect(needsWaveform(item({}))).toBe(true);
    expect(needsWaveform(item({ type: "video", hasAudio: true }))).toBe(true);
  });

  it("is false with peaks, without bytes, for images, silent video and missing media", () => {
    expect(needsWaveform(item({ waveformData: new Float32Array([0.2]) }))).toBe(false);
    expect(needsWaveform(item({ blob: null }))).toBe(false);
    expect(needsWaveform(item({ type: "image" }))).toBe(false);
    expect(needsWaveform(item({ type: "video", hasAudio: false }))).toBe(false);
    expect(needsWaveform(item({ isPlaceholder: true }))).toBe(false);
    expect(needsWaveform(undefined)).toBe(false);
  });
});
