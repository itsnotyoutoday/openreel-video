import { describe, expect, it } from "vitest";
import { canPitchCorrect, timeStretch } from "./time-stretch";

const RATE = 16000;

function sine(seconds: number, frequency: number, channels = 1): Float32Array[] {
  return Array.from({ length: channels }, () => {
    const data = new Float32Array(Math.round(seconds * RATE));
    for (let index = 0; index < data.length; index += 1) {
      data[index] = 0.5 * Math.sin((2 * Math.PI * frequency * index) / RATE);
    }
    return data;
  });
}

/** Frequency estimated from rising zero crossings in the middle of a signal. */
function frequencyOf(data: Float32Array): number {
  const from = Math.floor(data.length * 0.25);
  const to = Math.floor(data.length * 0.75);
  let crossings = 0;
  for (let index = from + 1; index < to; index += 1) {
    if (data[index - 1] < 0 && data[index] >= 0) crossings += 1;
  }
  return crossings / ((to - from) / RATE);
}

function rms(data: Float32Array): number {
  const from = Math.floor(data.length * 0.25);
  const to = Math.floor(data.length * 0.75);
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += data[index] * data[index];
  return Math.sqrt(sum / (to - from));
}

describe("timeStretch", () => {
  it.each([0.5, 0.75, 1.5, 2, 3])("changes the length by 1/%sx and keeps the pitch", (speed) => {
    const [out] = timeStretch(sine(2, 440), RATE, speed);
    expect(out.length).toBe(Math.round((2 * RATE) / speed));
    expect(frequencyOf(out)).toBeGreaterThan(440 * 0.97);
    expect(frequencyOf(out)).toBeLessThan(440 * 1.03);
  });

  it("keeps the level of the signal", () => {
    const input = sine(2, 440)[0];
    const [out] = timeStretch([input], RATE, 2);
    expect(rms(out)).toBeGreaterThan(rms(input) * 0.9);
    expect(rms(out)).toBeLessThan(rms(input) * 1.1);
  });

  it("stretches every channel with the same alignment", () => {
    const left = sine(1, 330)[0];
    const [outLeft, outRight] = timeStretch([left, left.slice()], RATE, 0.5);
    expect(outRight).toEqual(outLeft);
  });

  it("handles segments shorter than a window", () => {
    const [out] = timeStretch([new Float32Array(10).fill(0.5)], RATE, 2);
    expect(out.length).toBe(5);
  });

  it("only offers pitch correction for speeds that stretch well", () => {
    expect(canPitchCorrect(1)).toBe(false);
    expect(canPitchCorrect(0.5)).toBe(true);
    expect(canPitchCorrect(4)).toBe(true);
    expect(canPitchCorrect(8)).toBe(false);
    expect(canPitchCorrect(0.1)).toBe(false);
    expect(canPitchCorrect(Number.NaN)).toBe(false);
  });
});
