/**
 * A small deterministic software implementation of the parts of
 * OfflineAudioContext that AudioEngine uses, so tests can render a timeline and
 * look at real samples instead of mocking scheduling calls.
 *
 * Supported: buffer sources (start offset/duration, playbackRate), gain nodes
 * with AudioParam automation (setValueAtTime, linear/exponential ramps,
 * setValueCurveAtTime, cancelScheduledValues), a pass-through stereo panner and
 * the destination mix. It follows the Web Audio spec for how `start(when,
 * offset, duration)` treats `duration` (in source seconds, not affected by
 * playbackRate).
 */

type ParamEvent =
  | { type: "set"; time: number; value: number }
  | { type: "linear"; time: number; value: number }
  | { type: "exponential"; time: number; value: number }
  | { type: "curve"; time: number; duration: number; values: Float32Array };

export class SoftwareAudioParam {
  private events: ParamEvent[] = [];
  value: number;

  constructor(initial: number) {
    this.value = initial;
  }

  private add(event: ParamEvent): this {
    this.events.push(event);
    this.events.sort((a, b) => a.time - b.time);
    return this;
  }

  setValueAtTime(value: number, time: number): this {
    return this.add({ type: "set", time, value });
  }

  linearRampToValueAtTime(value: number, time: number): this {
    return this.add({ type: "linear", time, value });
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    return this.add({ type: "exponential", time, value });
  }

  setValueCurveAtTime(values: ArrayLike<number>, time: number, duration: number): this {
    return this.add({ type: "curve", time, duration, values: Float32Array.from(values) });
  }

  cancelScheduledValues(time: number): this {
    this.events = this.events.filter((event) => event.time < time);
    return this;
  }

  /** The parameter value at a context time, following the automation timeline. */
  valueAt(time: number): number {
    let previousTime = 0;
    let previousValue = this.value;
    for (let index = 0; index < this.events.length; index += 1) {
      const event = this.events[index];
      if (event.type === "curve") {
        if (time < event.time) break;
        if (time < event.time + event.duration) {
          const position = ((time - event.time) / event.duration) * (event.values.length - 1);
          const low = Math.floor(position);
          const high = Math.min(event.values.length - 1, low + 1);
          return event.values[low] + (event.values[high] - event.values[low]) * (position - low);
        }
        previousTime = event.time + event.duration;
        previousValue = event.values[event.values.length - 1];
        continue;
      }
      if (time < event.time) {
        if (event.type === "linear") {
          const span = event.time - previousTime;
          const progress = span <= 0 ? 1 : (time - previousTime) / span;
          return previousValue + (event.value - previousValue) * progress;
        }
        if (event.type === "exponential" && previousValue > 0 && event.value > 0) {
          const span = event.time - previousTime;
          const progress = span <= 0 ? 1 : (time - previousTime) / span;
          return previousValue * Math.pow(event.value / previousValue, progress);
        }
        break;
      }
      previousTime = event.time;
      previousValue = event.value;
    }
    return previousValue;
  }
}

abstract class SoftwareNode {
  readonly inputs: SoftwareNode[] = [];
  connect(target: SoftwareNode): SoftwareNode {
    target.inputs.push(this);
    return target;
  }
  disconnect(): void {
    // Rendering walks `inputs`, so there is nothing to tear down.
  }
  /** Mono-or-stereo sample of this node at a frame, per channel. */
  abstract sample(frame: number, channel: number, context: SoftwareOfflineAudioContext): number;
}

class SoftwareGainNode extends SoftwareNode {
  readonly gain = new SoftwareAudioParam(1);
  sample(frame: number, channel: number, context: SoftwareOfflineAudioContext): number {
    let sum = 0;
    for (const input of this.inputs) sum += input.sample(frame, channel, context);
    return sum * this.gain.valueAt(frame / context.sampleRate);
  }
}

class SoftwarePannerNode extends SoftwareNode {
  readonly pan = new SoftwareAudioParam(0);
  sample(frame: number, channel: number, context: SoftwareOfflineAudioContext): number {
    let sum = 0;
    for (const input of this.inputs) sum += input.sample(frame, channel, context);
    return sum;
  }
}

class SoftwareDestination extends SoftwareNode {
  sample(frame: number, channel: number, context: SoftwareOfflineAudioContext): number {
    let sum = 0;
    for (const input of this.inputs) sum += input.sample(frame, channel, context);
    return sum;
  }
}

export class SoftwareAudioBuffer {
  readonly duration: number;
  private readonly data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number): Float32Array {
    return this.data[channel];
  }
}

class SoftwareBufferSource extends SoftwareNode {
  buffer: SoftwareAudioBuffer | null = null;
  readonly playbackRate = new SoftwareAudioParam(1);
  private when = Infinity;
  private offset = 0;
  private duration: number | undefined;

  start(when = 0, offset = 0, duration?: number): void {
    this.when = when;
    this.offset = offset;
    this.duration = duration;
  }

  sample(frame: number, channel: number, context: SoftwareOfflineAudioContext): number {
    const buffer = this.buffer;
    if (!buffer || !Number.isFinite(this.when)) return 0;
    const time = frame / context.sampleRate;
    if (time < this.when) return 0;
    const rate = this.playbackRate.value;
    const elapsed = time - this.when;
    // `duration` is in source seconds, so a source plays for duration / |rate| seconds.
    if (this.duration !== undefined && elapsed * Math.abs(rate) >= this.duration) return 0;
    const position = (this.offset + elapsed * rate) * buffer.sampleRate;
    if (position < 0 || position >= buffer.length - 1) return 0;
    const low = Math.floor(position);
    const data = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
    return data[low] + (data[low + 1] - data[low]) * (position - low);
  }
}

export class SoftwareOfflineAudioContext {
  readonly destination = new SoftwareDestination();
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  createGain(): SoftwareGainNode {
    return new SoftwareGainNode();
  }
  createStereoPanner(): SoftwarePannerNode {
    return new SoftwarePannerNode();
  }
  createBufferSource(): SoftwareBufferSource {
    return new SoftwareBufferSource();
  }
  createBuffer(channels: number, length: number, sampleRate: number): SoftwareAudioBuffer {
    return new SoftwareAudioBuffer(channels, length, sampleRate);
  }
  async decodeAudioData(): Promise<SoftwareAudioBuffer> {
    throw new Error("decodeAudioData is not available in the software context");
  }
  async startRendering(): Promise<SoftwareAudioBuffer> {
    const out = new SoftwareAudioBuffer(this.numberOfChannels, this.length, this.sampleRate);
    for (let channel = 0; channel < this.numberOfChannels; channel += 1) {
      const data = out.getChannelData(channel);
      for (let frame = 0; frame < this.length; frame += 1) {
        data[frame] = this.destination.sample(frame, channel, this);
      }
    }
    return out;
  }
}

/** A mono sine (or constant) test buffer. */
export function createToneBuffer(
  seconds: number,
  sampleRate: number,
  options: { frequency?: number; amplitude?: number; channels?: number; constant?: boolean } = {},
): SoftwareAudioBuffer {
  const { frequency = 440, amplitude = 0.5, channels = 2, constant = false } = options;
  const buffer = new SoftwareAudioBuffer(channels, Math.round(seconds * sampleRate), sampleRate);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = constant
        ? amplitude
        : amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
    }
  }
  return buffer;
}

/** Peak absolute value of channel 0 between two times (seconds). */
export function peakBetween(buffer: SoftwareAudioBuffer, from: number, to: number): number {
  const data = buffer.getChannelData(0);
  const start = Math.max(0, Math.floor(from * buffer.sampleRate));
  const end = Math.min(data.length, Math.ceil(to * buffer.sampleRate));
  let peak = 0;
  for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(data[index]));
  return peak;
}

/** Root-mean-square of channel 0 between two times (seconds). */
export function rmsBetween(buffer: SoftwareAudioBuffer, from: number, to: number): number {
  const data = buffer.getChannelData(0);
  const start = Math.max(0, Math.floor(from * buffer.sampleRate));
  const end = Math.min(data.length, Math.ceil(to * buffer.sampleRate));
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += data[index] * data[index];
  return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

/** Install the software context as the global (Offline)AudioContext; returns a restore function. */
export function installSoftwareAudioContext(): () => void {
  const globals = globalThis as unknown as Record<string, unknown>;
  const savedOffline = globals.OfflineAudioContext;
  const savedContext = globals.AudioContext;
  class SoftwareLiveContext extends SoftwareOfflineAudioContext {
    constructor(options?: { sampleRate?: number }) {
      super(2, 1, options?.sampleRate ?? 48000);
    }
  }
  globals.OfflineAudioContext = SoftwareOfflineAudioContext;
  globals.AudioContext = SoftwareLiveContext;
  return () => {
    globals.OfflineAudioContext = savedOffline;
    globals.AudioContext = savedContext;
  };
}
