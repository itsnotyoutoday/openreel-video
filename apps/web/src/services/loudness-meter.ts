/**
 * Loudness per ITU-R BS.1770-4 / EBU R128: K-weighted mean square over 400 ms
 * blocks every 100 ms, gated at -70 LUFS absolute and -10 LU relative for the
 * integrated value, and true peak from 4x oversampling. Fed with the samples
 * of the preview mix; pure (no Web Audio) so it can be tested.
 */

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The two K-weighting stages (shelf, then high-pass) for a sample rate, as in libebur128. */
export function kWeightingFilters(sampleRate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const gain = 3.999843853973347;
  let q = 0.7071752369554196;
  let k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = Math.pow(10, gain / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  let a0 = 1 + k / q + k * k;
  const shelf: Biquad = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  f0 = 38.13547087602444;
  q = 0.5003270373238773;
  k = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + k / q + k * k;
  const highPass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
  return [shelf, highPass];
}

const TAPS = 12;
const PHASES = 4;
/** Windowed-sinc polyphase interpolator: PHASES points between samples, TAPS taps each. */
const INTERPOLATOR: number[][] = Array.from({ length: PHASES }, (_, phase) =>
  Array.from({ length: TAPS }, (_, tap) => {
    const d = tap - TAPS / 2 + phase / PHASES;
    if (d === 0) return 1;
    if (Math.abs(d) >= TAPS / 2) return 0;
    const sinc = Math.sin(Math.PI * d) / (Math.PI * d);
    const window = 0.5 * (1 + Math.cos((Math.PI * d) / (TAPS / 2)));
    return sinc * window;
  }),
);

/** dB of a linear amplitude (-Infinity for silence). */
export const toDb = (amplitude: number): number => (amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity);
const powerToLufs = (power: number): number => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);

interface ChannelState {
  // K-weighting filter memory (direct form I)
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  u1: number;
  u2: number;
  z1: number;
  z2: number;
  /** Last TAPS raw samples, newest last, for the true-peak interpolator. */
  history: number[];
  /** Sum of squared K-weighted samples in the current 100 ms step. */
  stepSum: number;
}

export interface LoudnessReading {
  /** Integrated loudness since the last reset, LUFS (-Infinity before the first loud block). */
  readonly integrated: number;
  /** Momentary loudness (the last 400 ms), LUFS. */
  readonly momentary: number;
  /** Highest true peak since the last reset, dBTP. */
  readonly truePeak: number;
}

export class LoudnessMeter {
  private readonly filters: [Biquad, Biquad];
  private readonly stepSize: number;
  private channels: ChannelState[] = [];
  private stepCount = 0;
  /** Channel-summed mean square of the last four 100 ms steps. */
  private steps: number[] = [];
  /** Power of every 400 ms block above the absolute gate. */
  private blocks: number[] = [];
  private momentaryPower = 0;
  private peak = 0;

  constructor(readonly sampleRate: number) {
    this.filters = kWeightingFilters(sampleRate);
    this.stepSize = Math.max(1, Math.round(sampleRate / 10));
  }

  reset(): void {
    this.channels = [];
    this.stepCount = 0;
    this.steps = [];
    this.blocks = [];
    this.momentaryPower = 0;
    this.peak = 0;
  }

  /** Feed one buffer per channel (all the same length); left and right weigh 1. */
  process(channelData: readonly Float32Array[]): void {
    if (channelData.length === 0) return;
    while (this.channels.length < channelData.length) {
      this.channels.push({ x1: 0, x2: 0, y1: 0, y2: 0, u1: 0, u2: 0, z1: 0, z2: 0, history: new Array(TAPS).fill(0), stepSum: 0 });
    }
    const [shelf, hp] = this.filters;
    const length = channelData[0].length;
    for (let i = 0; i < length; i += 1) {
      for (let c = 0; c < channelData.length; c += 1) {
        const x = channelData[c][i] ?? 0;
        const s = this.channels[c];
        // shelf
        const y = shelf.b0 * x + shelf.b1 * s.x1 + shelf.b2 * s.x2 - shelf.a1 * s.y1 - shelf.a2 * s.y2;
        s.x2 = s.x1;
        s.x1 = x;
        s.y2 = s.y1;
        s.y1 = y;
        // high-pass
        const z = hp.b0 * y + hp.b1 * s.u1 + hp.b2 * s.u2 - hp.a1 * s.z1 - hp.a2 * s.z2;
        s.u2 = s.u1;
        s.u1 = y;
        s.z2 = s.z1;
        s.z1 = z;
        s.stepSum += z * z;
        // true peak: the sample itself and the points between it and the previous ones
        s.history.shift();
        s.history.push(x);
        const sample = Math.abs(x);
        if (sample > this.peak) this.peak = sample;
        for (let p = 1; p < PHASES; p += 1) {
          const taps = INTERPOLATOR[p];
          let v = 0;
          for (let t = 0; t < TAPS; t += 1) v += taps[t] * s.history[TAPS - 1 - t];
          const a = Math.abs(v);
          if (a > this.peak) this.peak = a;
        }
      }
      this.stepCount += 1;
      if (this.stepCount >= this.stepSize) this.closeStep();
    }
  }

  private closeStep(): void {
    let power = 0;
    for (const channel of this.channels) {
      power += channel.stepSum / this.stepCount;
      channel.stepSum = 0;
    }
    this.stepCount = 0;
    this.steps.push(power);
    if (this.steps.length > 4) this.steps.shift();
    if (this.steps.length < 4) return;
    const block = (this.steps[0] + this.steps[1] + this.steps[2] + this.steps[3]) / 4;
    this.momentaryPower = block;
    if (powerToLufs(block) > -70) this.blocks.push(block);
  }

  read(): LoudnessReading {
    let integrated = -Infinity;
    if (this.blocks.length > 0) {
      const mean = this.blocks.reduce((sum, b) => sum + b, 0) / this.blocks.length;
      const relative = powerToLufs(mean) - 10;
      const gated = this.blocks.filter((b) => powerToLufs(b) > relative);
      if (gated.length > 0) integrated = powerToLufs(gated.reduce((sum, b) => sum + b, 0) / gated.length);
    }
    return { integrated, momentary: powerToLufs(this.momentaryPower), truePeak: toDb(this.peak) };
  }
}
