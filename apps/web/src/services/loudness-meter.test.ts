import { describe, expect, it } from "vitest";
import { LoudnessMeter, toDb } from "./loudness-meter";

const RATE = 48000;

function sine(seconds: number, amplitude: number, frequency = 1000, rate = RATE): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / rate);
  return out;
}

describe("LoudnessMeter", () => {
  it("reads a stereo 1 kHz sine at -23 dBFS as -23 LUFS integrated (EBU Tech 3341 case 1)", () => {
    const meter = new LoudnessMeter(RATE);
    const tone = sine(5, Math.pow(10, -23 / 20));
    // fed in buffers like a ScriptProcessor would
    for (let i = 0; i < tone.length; i += 4096) {
      const chunk = tone.subarray(i, i + 4096);
      meter.process([chunk, chunk]);
    }
    const reading = meter.read();
    expect(reading.integrated).toBeGreaterThan(-23.2);
    expect(reading.integrated).toBeLessThan(-22.8);
    expect(reading.momentary).toBeCloseTo(reading.integrated, 0);
  });

  it("gates silence: a quiet stretch does not drag the integrated value down", () => {
    const meter = new LoudnessMeter(RATE);
    const tone = sine(3, Math.pow(10, -20 / 20));
    meter.process([tone, tone]);
    const loud = meter.read().integrated;
    const silence = new Float32Array(RATE * 3);
    meter.process([silence, silence]);
    // only the few blocks that straddle the cut count, a fraction of a dB
    expect(meter.read().integrated).toBeGreaterThan(loud - 0.5);
    expect(meter.read().integrated).toBeLessThanOrEqual(loud + 0.01);
  });

  it("measures true peak at least the sample peak, near the sine's amplitude", () => {
    const meter = new LoudnessMeter(RATE);
    const tone = sine(1, 0.5, 997);
    meter.process([tone]);
    const { truePeak } = meter.read();
    expect(truePeak).toBeGreaterThan(toDb(0.5) - 0.1);
    expect(truePeak).toBeLessThan(toDb(0.5) + 0.3);
  });

  it("finds an inter-sample peak above the samples (fs/4 sine at 45 degrees)", () => {
    const meter = new LoudnessMeter(RATE);
    const n = RATE;
    const data = new Float32Array(n);
    for (let i = 0; i < n; i += 1) data[i] = Math.sin((Math.PI / 2) * i + Math.PI / 4);
    // every sample is +-0.707; the waveform between them reaches 1.0
    meter.process([data]);
    expect(meter.read().truePeak).toBeGreaterThan(-1);
  });

  it("starts empty and resets", () => {
    const meter = new LoudnessMeter(RATE);
    expect(meter.read().integrated).toBe(-Infinity);
    const tone = sine(1, 0.1);
    meter.process([tone, tone]);
    expect(meter.read().integrated).toBeGreaterThan(-40);
    meter.reset();
    expect(meter.read()).toEqual({ integrated: -Infinity, momentary: -Infinity, truePeak: -Infinity });
  });
});
