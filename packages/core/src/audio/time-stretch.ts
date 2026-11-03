/**
 * Pitch-preserving time stretch (WSOLA: waveform-similarity overlap-add).
 *
 * `speed` > 1 plays faster (output is shorter), < 1 slower (output is longer),
 * without changing the pitch. Changing `playbackRate` on a buffer source does
 * both at once, which is what a retimed clip with pitch correction must avoid.
 */

const WINDOW_SECONDS = 0.04;
const SEARCH_SECONDS = 0.012;
/** Speeds outside this range sound better resampled than stretched. */
export const MIN_STRETCH_SPEED = 0.25;
export const MAX_STRETCH_SPEED = 4;

export function canPitchCorrect(speed: number): boolean {
  return Number.isFinite(speed) && speed >= MIN_STRETCH_SPEED && speed <= MAX_STRETCH_SPEED && speed !== 1;
}

function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / length);
  }
  return window;
}

/** Cross-correlation of two equal-length stretches of `signal` (sampled every `stride`). */
function correlate(
  signal: Float32Array,
  a: number,
  b: number,
  length: number,
  stride: number,
): number {
  let sum = 0;
  for (let index = 0; index < length; index += stride) {
    const left = signal[a + index];
    const right = signal[b + index];
    if (left === undefined || right === undefined) break;
    sum += left * right;
  }
  return sum;
}

/** Overlap-add one channel at the frame positions chosen from the guide channel. */
function stretchChannel(
  input: Float32Array,
  sampleRate: number,
  outputLength: number,
  positions: Int32Array,
): Float32Array {
  const windowLength = Math.max(64, 2 * Math.round((WINDOW_SECONDS * sampleRate) / 2));
  const synthesisHop = windowLength / 2;
  const window = hannWindow(windowLength);
  const output = new Float32Array(outputLength + windowLength);
  for (let frame = 0; frame < positions.length; frame += 1) {
    const start = positions[frame];
    const outStart = frame * synthesisHop;
    for (let index = 0; index < windowLength; index += 1) {
      const sample = input[start + index];
      if (sample === undefined) break;
      output[outStart + index] += sample * window[index];
    }
  }
  return output.subarray(0, outputLength);
}

/** The input position of each output frame, chosen by waveform similarity. */
function chooseFramePositions(
  guide: Float32Array,
  speed: number,
  sampleRate: number,
  outputLength: number,
): Int32Array {
  const windowLength = Math.max(64, 2 * Math.round((WINDOW_SECONDS * sampleRate) / 2));
  const synthesisHop = windowLength / 2;
  const analysisHop = synthesisHop * speed;
  const tolerance = Math.max(8, Math.round(SEARCH_SECONDS * sampleRate));
  const frames = Math.max(1, Math.ceil(outputLength / synthesisHop) + 1);
  const positions = new Int32Array(frames);
  let previous = 0;
  for (let frame = 1; frame < frames; frame += 1) {
    const nominal = Math.round(frame * analysisHop);
    // What the previous frame would have continued with.
    const target = previous + synthesisHop;
    if (target + windowLength >= guide.length || nominal >= guide.length) {
      positions[frame] = Math.min(nominal, Math.max(0, guide.length - 1));
      previous = positions[frame];
      continue;
    }
    let best = nominal;
    let bestScore = -Infinity;
    const low = Math.max(0, nominal - tolerance);
    const high = Math.min(guide.length - windowLength - 1, nominal + tolerance);
    // Coarse search on every 4th offset and sample, then refine around the winner.
    for (let candidate = low; candidate <= high; candidate += 4) {
      const score = correlate(guide, target, candidate, synthesisHop, 4);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    const refineLow = Math.max(low, best - 3);
    const refineHigh = Math.min(high, best + 3);
    for (let candidate = refineLow; candidate <= refineHigh; candidate += 1) {
      const score = correlate(guide, target, candidate, synthesisHop, 2);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    positions[frame] = best;
    previous = best;
  }
  return positions;
}

/**
 * Stretch all channels of a segment. Returns channel data of length
 * `round(inputLength / speed)`.
 */
export function timeStretch(
  channels: readonly Float32Array[],
  sampleRate: number,
  speed: number,
): Float32Array[] {
  if (channels.length === 0) return [];
  const inputLength = channels[0].length;
  const outputLength = Math.max(1, Math.round(inputLength / speed));
  // All channels share one alignment (found on the first) so stereo phase is kept.
  const guide = channels[0];
  const positions = chooseFramePositions(guide, speed, sampleRate, outputLength);
  return channels.map((channel) =>
    stretchChannel(channel, sampleRate, outputLength, positions),
  );
}
