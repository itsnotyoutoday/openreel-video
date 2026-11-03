import { afterEach, describe, expect, it } from "vitest";
import {
  SAMPLE_RATE,
  createAudioProject,
  createRenderingEngine,
  valueAt,
} from "./test-support/render-fixtures";
import { createToneBuffer, peakBetween } from "./test-support/software-audio-context";

let restore: (() => void) | undefined;
afterEach(() => restore?.());

async function render(project: ReturnType<typeof createAudioProject>, start: number, duration: number) {
  // A constant 0.5 source, so the rendered value is 0.5 times the gain.
  const rendering = await createRenderingEngine(
    createToneBuffer(10, SAMPLE_RATE, { constant: true, amplitude: 0.5 }),
  );
  restore = rendering.restore;
  const rendered = await rendering.engine.renderAudio(project, start, duration);
  return rendered.buffer as unknown as Parameters<typeof valueAt>[0] & Parameters<typeof peakBetween>[0];
}

const clip = { startTime: 1, duration: 4, inPoint: 0, outPoint: 4 };

describe("clip fades in exported audio (rendered samples)", () => {
  it("fades a clip out over its last seconds", async () => {
    const out = await render(createAudioProject({ ...clip, fade: { fadeIn: 0, fadeOut: 2 } }), 0, 6);

    expect(valueAt(out, 2.5)).toBeCloseTo(0.5, 2); // before the fade starts at clip time 2
    expect(valueAt(out, 4)).toBeCloseTo(0.25, 2); // half way through the fade
    expect(valueAt(out, 4.9)).toBeLessThan(0.05);
    expect(peakBetween(out, 5.05, 6)).toBe(0);
  });

  it("fades a clip in over its first seconds", async () => {
    const out = await render(createAudioProject({ ...clip, fade: { fadeIn: 2, fadeOut: 0 } }), 0, 6);
    expect(valueAt(out, 1.05)).toBeLessThan(0.05);
    expect(valueAt(out, 2)).toBeCloseTo(0.25, 2);
    expect(valueAt(out, 3.5)).toBeCloseTo(0.5, 2);
  });

  it("applies both fades when they overlap", async () => {
    const out = await render(createAudioProject({ ...clip, fade: { fadeIn: 3, fadeOut: 3 } }), 0, 6);
    expect(valueAt(out, 3)).toBeCloseTo(0.5 * (2 / 3), 2);
  });

  it("applies the fade-out in a chunk that starts inside the clip", async () => {
    const project = createAudioProject({ ...clip, fade: { fadeIn: 0, fadeOut: 2 } });
    const whole = await render(project, 0, 6);
    const chunk = await render(project, 3, 3);
    for (const t of [3.2, 4, 4.5, 4.9]) {
      expect(valueAt(chunk, t - 3)).toBeCloseTo(valueAt(whole, t), 3);
    }
  });

  it("applies the fade-out in a chunk that ends before the clip does", async () => {
    const project = createAudioProject({ ...clip, startTime: 0, duration: 8, outPoint: 8, fade: { fadeIn: 0, fadeOut: 2 } });
    const early = await render(project, 0, 4);
    expect(valueAt(early, 3.9)).toBeCloseTo(0.5, 2); // the fade has not started yet
    const late = await render(project, 4, 4);
    expect(valueAt(late, 3.9)).toBeLessThan(0.05);
  });

  it("fades a clip that is also volume-keyframed", async () => {
    const project = createAudioProject({
      ...clip,
      keyframes: [
        { id: "a", time: 0, property: "volume", value: 1, easing: "linear" },
        { id: "b", time: 4, property: "volume", value: 1, easing: "linear" },
      ],
      fade: { fadeIn: 0, fadeOut: 2 },
    });
    const out = await render(project, 0, 6);
    expect(valueAt(out, 4)).toBeCloseTo(0.25, 2);
  });

  it("fades the audio of a video clip", async () => {
    const project = createAudioProject({ ...clip, fade: { fadeIn: 0, fadeOut: 2 } }, { type: "video" });
    const out = await render(project, 0, 6);
    expect(valueAt(out, 4)).toBeCloseTo(0.25, 2);
  });

  it("leaves a clip without fades at full level", async () => {
    const out = await render(createAudioProject(clip), 0, 6);
    expect(valueAt(out, 4.9)).toBeCloseTo(0.5, 2);
  });
});
