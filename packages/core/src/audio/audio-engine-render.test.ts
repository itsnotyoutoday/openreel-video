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
  const rendering = await createRenderingEngine();
  restore = rendering.restore;
  const rendered = await rendering.engine.renderAudio(project, start, duration);
  return rendered.buffer as unknown as Parameters<typeof valueAt>[0] & Parameters<typeof peakBetween>[0];
}

describe("exported audio of retimed clips (rendered samples)", () => {
  it("plays a 0.5x clip for its whole timeline span, reading the source at half speed", async () => {
    // 8 s of timeline at 0.5x consumes 4 s of source starting at 1 s.
    const project = createAudioProject({ startTime: 1, duration: 8, inPoint: 1, outPoint: 5, speed: 0.5, pitchCorrection: false });
    const out = await render(project, 0, 10);

    expect(peakBetween(out, 0, 0.9)).toBe(0);
    for (const t of [1.5, 3, 5, 8, 8.9]) {
      const sourceSeconds = 1 + (t - 1) * 0.5;
      expect(valueAt(out, t)).toBeCloseTo(sourceSeconds / 10, 2);
    }
    expect(peakBetween(out, 9.05, 10)).toBe(0);
  });

  it("plays a 2x clip for its whole timeline span", async () => {
    const project = createAudioProject({ startTime: 0, duration: 4, inPoint: 0, outPoint: 8, speed: 2, pitchCorrection: false });
    const out = await render(project, 0, 6);

    for (const t of [0.5, 2, 3.9]) expect(valueAt(out, t)).toBeCloseTo((t * 2) / 10, 2);
    expect(peakBetween(out, 4.05, 6)).toBe(0);
  });

  it("renders the same samples whether a retimed clip is exported in one piece or in chunks", async () => {
    const project = createAudioProject({ startTime: 2, duration: 8, inPoint: 0, outPoint: 4, speed: 0.5, pitchCorrection: false });
    const whole = await render(project, 0, 12);
    const first = await render(project, 0, 5);
    const second = await render(project, 5, 7);

    for (const t of [2.5, 4.9]) expect(valueAt(first, t)).toBeCloseTo(valueAt(whole, t), 4);
    for (const t of [5.5, 9, 9.9]) {
      expect(valueAt(second, t - 5)).toBeCloseTo(valueAt(whole, t), 4);
      expect(valueAt(second, t - 5)).toBeGreaterThan(0);
    }
    expect(SAMPLE_RATE).toBe(8000);
  });
});

function frequencyOf(buffer: { getChannelData(c: number): Float32Array; sampleRate: number }, from: number, to: number): number {
  const data = buffer.getChannelData(0);
  const start = Math.floor(from * buffer.sampleRate);
  const end = Math.floor(to * buffer.sampleRate);
  let crossings = 0;
  for (let index = start + 1; index < end; index += 1) {
    if (data[index - 1] < 0 && data[index] >= 0) crossings += 1;
  }
  return crossings / (to - from);
}

async function renderTone(project: ReturnType<typeof createAudioProject>, start: number, duration: number) {
  const rendering = await createRenderingEngine(createToneBuffer(10, SAMPLE_RATE, { frequency: 440 }));
  restore = rendering.restore;
  const rendered = await rendering.engine.renderAudio(project, start, duration);
  return rendered.buffer as unknown as Parameters<typeof frequencyOf>[0] & Parameters<typeof peakBetween>[0];
}

describe("pitch of retimed clips", () => {
  it("keeps the original pitch at 2x and 0.5x by default, over the whole clip", async () => {
    for (const speed of [2, 0.5]) {
      const duration = 4 / speed;
      const project = createAudioProject({ startTime: 0, duration, inPoint: 0, outPoint: 4, speed });
      const out = await renderTone(project, 0, duration + 1);
      expect(frequencyOf(out, 0.3, duration - 0.3)).toBeGreaterThan(440 * 0.96);
      expect(frequencyOf(out, 0.3, duration - 0.3)).toBeLessThan(440 * 1.04);
      expect(peakBetween(out, duration - 0.2, duration - 0.05)).toBeGreaterThan(0.2);
      expect(peakBetween(out, duration + 0.05, duration + 1)).toBe(0);
    }
  });

  it("shifts the pitch with the speed when pitch correction is off", async () => {
    const project = createAudioProject({ startTime: 0, duration: 2, inPoint: 0, outPoint: 4, speed: 2, pitchCorrection: false });
    const out = await renderTone(project, 0, 3);
    expect(frequencyOf(out, 0.3, 1.7)).toBeGreaterThan(880 * 0.97);
    expect(frequencyOf(out, 0.3, 1.7)).toBeLessThan(880 * 1.03);
  });

  it("does not change unretimed clips", async () => {
    const project = createAudioProject({ startTime: 0, duration: 2, inPoint: 0, outPoint: 2 });
    const out = await renderTone(project, 0, 2);
    expect(frequencyOf(out, 0.2, 1.8)).toBeGreaterThan(440 * 0.99);
    expect(frequencyOf(out, 0.2, 1.8)).toBeLessThan(440 * 1.01);
  });

  it("renders a pitch-corrected clip identically (within alignment) in one piece or chunks", async () => {
    const project = createAudioProject({ startTime: 1, duration: 6, inPoint: 0, outPoint: 3, speed: 0.5 });
    const second = await renderTone(project, 4, 4);
    expect(frequencyOf(second, 0.2, 2.8)).toBeGreaterThan(440 * 0.96);
    expect(frequencyOf(second, 0.2, 2.8)).toBeLessThan(440 * 1.04);
    expect(peakBetween(second, 0.2, 2.8)).toBeGreaterThan(0.3);
  });
});
