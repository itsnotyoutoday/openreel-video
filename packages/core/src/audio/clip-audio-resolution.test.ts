import { describe, expect, it } from "vitest";
import type { Clip, Timeline, Track } from "../types/timeline";
import {
  resolveAudibleAudioTarget,
  resolveClipAudioEffects,
  resolveClipVolumeAutomation,
} from "./clip-audio-resolution";

const createClip = (overrides: Partial<Clip>): Clip => ({
  id: "clip",
  mediaId: "media-1",
  trackId: "video-track",
  startTime: 0,
  duration: 10,
  inPoint: 0,
  outPoint: 10,
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
  ...overrides,
});

const createTrack = (overrides: Partial<Track>): Track => ({
  id: "track",
  type: "video",
  name: "Track",
  clips: [],
  transitions: [],
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  ...overrides,
});

const createSeparatedAudioTimeline = (): {
  timeline: Timeline;
  videoClip: Clip;
  audioClip: Clip;
} => {
  const noiseEffect = {
    id: "noise-1",
    type: "noiseReduction",
    enabled: true,
    params: { reduction: 0.8 },
  };
  const duckingPoints = [
    { time: 0, value: 1, curve: "linear" as const },
    { time: 1, value: 0.35, curve: "linear" as const },
  ];
  const videoClip = createClip({
    id: "video-clip",
    trackId: "video-track",
    volume: 0,
    audioEffects: [noiseEffect],
    automation: { volume: duckingPoints },
  });
  const audioClip = createClip({
    id: "audio-clip",
    trackId: "audio-track",
    volume: 1,
  });
  const timeline: Timeline = {
    tracks: [
      createTrack({ id: "video-track", type: "video", clips: [videoClip] }),
      createTrack({ id: "audio-track", type: "audio", clips: [audioClip] }),
    ],
    subtitles: [],
    duration: 10,
    markers: [],
  };

  return { timeline, videoClip, audioClip };
};

describe("clip audio resolution", () => {
  it("resolves noise reduction effects from a linked separated video clip", () => {
    const { timeline, audioClip } = createSeparatedAudioTimeline();

    expect(resolveClipAudioEffects(audioClip, timeline)).toEqual([
      expect.objectContaining({ id: "noise-1" }),
    ]);
  });

  it("resolves ducking automation from a linked separated video clip", () => {
    const { timeline, audioClip } = createSeparatedAudioTimeline();

    expect(resolveClipVolumeAutomation(audioClip, timeline)).toEqual([
      expect.objectContaining({ value: 1 }),
      expect.objectContaining({ value: 0.35 }),
    ]);
  });

  it("uses the audible linked audio clip as the target for silent separated video", () => {
    const { timeline, videoClip, audioClip } = createSeparatedAudioTimeline();

    expect(resolveAudibleAudioTarget(videoClip, timeline).id).toBe(audioClip.id);
  });

  it("maps volume keyframes to automation points and ignores other properties", () => {
    const { timeline, audioClip } = createSeparatedAudioTimeline();
    const keyed = createClip({
      id: "keyed",
      trackId: "audio-track",
      keyframes: [
        { id: "k1", time: 0, property: "volume", value: 1, easing: "linear" },
        { id: "k2", time: 3, property: "opacity", value: 0.5, easing: "linear" },
        { id: "k3", time: 2, property: "volume", value: 0.1, easing: "linear" },
      ],
    });

    expect(resolveClipVolumeAutomation(keyed, timeline)).toEqual([
      { time: 0, value: 1 },
      { time: 2, value: 0.1 },
    ]);
    expect(resolveClipVolumeAutomation(audioClip, timeline)).toHaveLength(2);
  });

  it("prefers explicit automation over volume keyframes", () => {
    const { timeline } = createSeparatedAudioTimeline();
    const clip = createClip({
      id: "both",
      trackId: "audio-track",
      automation: { volume: [{ time: 0, value: 0.5 }] },
      keyframes: [
        { id: "k1", time: 0, property: "volume", value: 0.9, easing: "linear" },
      ],
    });

    expect(resolveClipVolumeAutomation(clip, timeline)).toEqual([
      { time: 0, value: 0.5 },
    ]);
  });

  it("falls back to volume keyframes on a linked clip", () => {
    const { timeline, videoClip, audioClip } = createSeparatedAudioTimeline();
    const keyedVideo: Clip = {
      ...videoClip,
      automation: undefined,
      keyframes: [
        { id: "k1", time: 0, property: "volume", value: 1, easing: "linear" },
        { id: "k2", time: 1, property: "volume", value: 0.2, easing: "linear" },
      ],
    };
    const linkedTimeline: Timeline = {
      ...timeline,
      tracks: [
        createTrack({ id: "video-track", type: "video", clips: [keyedVideo] }),
        createTrack({ id: "audio-track", type: "audio", clips: [audioClip] }),
      ],
    };

    expect(resolveClipVolumeAutomation(audioClip, linkedTimeline)).toEqual([
      { time: 0, value: 1 },
      { time: 1, value: 0.2 },
    ]);
  });
});