import { afterEach, describe, expect, it } from "vitest";
import {
  SAMPLE_RATE,
  createAudioProject,
  createRenderingEngine,
  valueAt,
} from "./test-support/render-fixtures";
import { createToneBuffer } from "./test-support/software-audio-context";

let restore: (() => void) | undefined;
afterEach(() => restore?.());

const keyframe = (time: number, value: number, property = "volume") => ({
  id: `k-${property}-${time}`,
  time,
  property,
  value,
  easing: "linear",
});

async function render(project: ReturnType<typeof createAudioProject>, start: number, duration: number) {
  // A constant 0.5 source, so the rendered value is 0.5 times the gain.
  const rendering = await createRenderingEngine(
    createToneBuffer(10, SAMPLE_RATE, { constant: true, amplitude: 0.5 }),
  );
  restore = rendering.restore;
  const rendered = await rendering.engine.renderAudio(project, start, duration);
  return rendered.buffer as unknown as Parameters<typeof valueAt>[0];
}

describe("volume keyframes in exported audio (rendered samples)", () => {
  const clip = {
    startTime: 1,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    keyframes: [keyframe(0, 0), keyframe(2, 1), keyframe(4, 0.2)],
  };

  it("follows the keyframed gain over the clip", async () => {
    const out = await render(createAudioProject(clip), 0, 6);

    expect(valueAt(out, 1.0)).toBeCloseTo(0, 2);
    expect(valueAt(out, 2.0)).toBeCloseTo(0.25, 2); // halfway up to 1.0 at clip time 2
    expect(valueAt(out, 3.0)).toBeCloseTo(0.5, 2);
    expect(valueAt(out, 4.0)).toBeCloseTo(0.5 * 0.6, 2); // between 1.0 and 0.2
    expect(valueAt(out, 4.95)).toBeCloseTo(0.5 * 0.2, 1);
  });

  it("ignores keyframes of other properties", async () => {
    const withOpacity = createAudioProject({
      ...clip,
      keyframes: [keyframe(0, 0.1, "opacity"), keyframe(2, 0.9, "opacity")],
      volume: 0.8,
    });
    const out = await render(withOpacity, 0, 6);
    expect(valueAt(out, 2)).toBeCloseTo(0.4, 2); // clip volume 0.8 * source 0.5
  });

  it("renders a chunk that starts inside the clip like the same span of a full render", async () => {
    const project = createAudioProject(clip);
    const whole = await render(project, 0, 6);
    const chunk = await render(project, 3, 3);
    for (const t of [3.1, 3.9, 4.5, 4.9]) {
      expect(valueAt(chunk, t - 3)).toBeCloseTo(valueAt(whole, t), 3);
    }
  });

  it("combines keyframes with the fade envelope", async () => {
    const faded = createAudioProject({ ...clip, keyframes: [keyframe(0, 1), keyframe(4, 1)], fade: { fadeIn: 0, fadeOut: 2 } });
    const out = await render(faded, 0, 6);
    expect(valueAt(out, 2)).toBeCloseTo(0.5, 2);
    expect(valueAt(out, 4)).toBeCloseTo(0.25, 2); // halfway through a 2 s fade-out
  });

  it("uses the keyframes of a linked clip when the audio is separated from the video", async () => {
    const project = createAudioProject({
      id: "audio-clip",
      startTime: 1,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      keyframes: [],
    });
    const videoTrack = {
      id: "video-track",
      type: "video",
      name: "Video",
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
      clips: [
        {
          id: "video-clip",
          mediaId: "media-1",
          trackId: "video-track",
          startTime: 1,
          duration: 4,
          inPoint: 0,
          outPoint: 4,
          effects: [],
          audioEffects: [],
          transform: {},
          volume: 1,
          keyframes: [keyframe(0, 0), keyframe(4, 1)],
        },
      ],
    };
    (project.timeline.tracks as unknown[]).push(videoTrack);
    const resolved = await import("./clip-audio-resolution");
    const audioClip = project.timeline.tracks[0].clips[0];
    expect(resolved.resolveClipVolumeAutomation(audioClip, project.timeline)).toEqual([
      { time: 0, value: 0 },
      { time: 4, value: 1 },
    ]);
  });
});
