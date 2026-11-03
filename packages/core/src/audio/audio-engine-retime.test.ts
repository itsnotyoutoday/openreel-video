import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AudioEngine } from "./audio-engine";
import type { Project } from "../types/project";

interface SourceCall {
  when: number;
  offset: number;
  duration: number | undefined;
  playbackRate: number;
}

const SAMPLE_RATE = 48000;

const createParam = (initial = 0) => ({
  value: initial,
  setValueAtTime: () => undefined,
  linearRampToValueAtTime: () => undefined,
  exponentialRampToValueAtTime: () => undefined,
  setValueCurveAtTime: () => undefined,
  cancelScheduledValues: () => undefined,
});

const createNode = () => ({
  connect: () => undefined,
  disconnect: () => undefined,
  gain: createParam(1),
  pan: createParam(0),
});

const calls: SourceCall[] = [];

function createFakeBuffer(channels: number, length: number, sampleRate: number) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (channel: number) => data[channel],
  } as unknown as AudioBuffer;
}

class FakeOfflineAudioContext {
  readonly destination = createNode();
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
  }

  createGain() {
    return createNode();
  }

  createStereoPanner() {
    return createNode();
  }

  createBufferSource() {
    const source = {
      ...createNode(),
      buffer: null as unknown,
      playbackRate: createParam(1),
      start(when: number, offset: number, duration?: number) {
        calls.push({
          when,
          offset,
          duration,
          playbackRate: source.playbackRate.value,
        });
      },
    };
    return source;
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return createFakeBuffer(channels, length, sampleRate);
  }

  async startRendering() {
    return createFakeBuffer(this.numberOfChannels, this.length, this.sampleRate);
  }
}

class FakeAudioContext extends FakeOfflineAudioContext {
  constructor() {
    super(2, 1, SAMPLE_RATE);
  }
}

const globals = globalThis as unknown as Record<string, unknown>;
let savedOffline: unknown;
let savedContext: unknown;

beforeEach(() => {
  calls.length = 0;
  savedOffline = globals.OfflineAudioContext;
  savedContext = globals.AudioContext;
  globals.OfflineAudioContext = FakeOfflineAudioContext;
  globals.AudioContext = FakeAudioContext;
});

afterEach(() => {
  globals.OfflineAudioContext = savedOffline;
  globals.AudioContext = savedContext;
});

function createProject(clip: {
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed?: number;
  pitchCorrection?: boolean;
}): Project {
  return {
    settings: { sampleRate: SAMPLE_RATE, channels: 2 },
    mediaLibrary: {
      items: [
        {
          id: "media-1",
          type: "audio",
          blob: new Blob([new Uint8Array(4)]),
          metadata: { duration: 10, hasAudio: true },
        },
      ],
    },
    timeline: {
      tracks: [
        {
          id: "track-1",
          type: "audio",
          name: "Audio",
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
          clips: [
            {
              id: "clip-1",
              mediaId: "media-1",
              trackId: "track-1",
              effects: [],
              audioEffects: [],
              transform: {},
              volume: 1,
              keyframes: [],
              // These tests are about how playback is scheduled when the audio is
              // resampled; pitch-corrected rendering is covered in audio-engine-render.
              pitchCorrection: false,
              ...clip,
            },
          ],
        },
      ],
    },
  } as unknown as Project;
}

async function createEngine(): Promise<AudioEngine> {
  const engine = new AudioEngine({ sampleRate: SAMPLE_RATE, channels: 2 });
  await engine.initialize();
  const seeded = engine as unknown as { mediaBuffers: Map<string, AudioBuffer> };
  seeded.mediaBuffers.set(
    "media-1:0",
    createFakeBuffer(2, 10 * SAMPLE_RATE, SAMPLE_RATE),
  );
  return engine;
}

describe("AudioEngine retimed clips", () => {
  it("schedules a 2x clip against source seconds and honours the source offset in later chunks", async () => {
    // 4 s of timeline at 2x consumes 8 s of source, starting 1 s into the file.
    const project = createProject({ startTime: 10, duration: 4, inPoint: 1, outPoint: 9, speed: 2 });
    const engine = await createEngine();

    await engine.renderAudio(project, 10, 4);
    expect(calls).toHaveLength(1);
    expect(calls[0].playbackRate).toBe(2);
    expect(calls[0].offset).toBeCloseTo(1);
    expect(calls[0].duration).toBeCloseTo(8);

    // A chunk that starts 2 s into the clip must resume 4 source seconds in.
    calls.length = 0;
    await engine.renderAudio(project, 12, 2);
    expect(calls).toHaveLength(1);
    expect(calls[0].offset).toBeCloseTo(1 + 2 * 2);
    expect(calls[0].duration).toBeCloseTo(4);
  });

  it("keeps a 0.5x clip playing across an export chunk boundary", async () => {
    // 10 s of timeline at 0.5x consumes 5 s of source; the 15 s chunk boundary falls inside it.
    const project = createProject({ startTime: 6, duration: 10, inPoint: 0, outPoint: 5, speed: 0.5 });
    const engine = await createEngine();

    await engine.renderAudio(project, 0, 15);
    expect(calls[0].duration).toBeCloseTo(9 * 0.5);

    calls.length = 0;
    await engine.renderAudio(project, 15, 15);
    expect(calls).toHaveLength(1);
    // Resumes 9 timeline seconds in (4.5 source seconds) for the last 1 s (0.5 source s).
    expect(calls[0].offset).toBeCloseTo(4.5);
    expect(calls[0].duration).toBeCloseTo(0.5);
  });

  it("leaves unretimed clips unchanged", async () => {
    const project = createProject({ startTime: 0, duration: 4, inPoint: 2, outPoint: 6 });
    const engine = await createEngine();

    await engine.renderAudio(project, 1, 2);
    expect(calls[0].playbackRate).toBe(1);
    expect(calls[0].offset).toBeCloseTo(3);
    expect(calls[0].duration).toBeCloseTo(2);
  });
});
