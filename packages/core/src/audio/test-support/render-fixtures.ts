import { AudioEngine } from "../audio-engine";
import type { Project } from "../../types/project";
import {
  SoftwareAudioBuffer,
  installSoftwareAudioContext,
} from "./software-audio-context";

export const SAMPLE_RATE = 8000;

/** A mono-per-channel ramp whose value at source time s is s / seconds, so rendered samples reveal where they came from. */
export function createRampBuffer(seconds: number, sampleRate = SAMPLE_RATE): SoftwareAudioBuffer {
  const buffer = new SoftwareAudioBuffer(2, Math.round(seconds * sampleRate), sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) data[index] = index / data.length;
  }
  return buffer;
}

type ClipOverrides = Record<string, unknown>;

export function createAudioProject(clip: ClipOverrides, trackOverrides: ClipOverrides = {}): Project {
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
          ...trackOverrides,
          clips: [
            {
              id: "clip-1",
              mediaId: "media-1",
              trackId: "track-1",
              startTime: 0,
              duration: 4,
              inPoint: 0,
              outPoint: 4,
              effects: [],
              audioEffects: [],
              transform: {},
              volume: 1,
              keyframes: [],
              ...clip,
            },
          ],
        },
      ],
    },
  } as unknown as Project;
}

/** An initialised AudioEngine on the software context, with a seeded 10 s source ramp. */
export async function createRenderingEngine(
  source: SoftwareAudioBuffer = createRampBuffer(10),
): Promise<{ engine: AudioEngine; restore: () => void }> {
  const restore = installSoftwareAudioContext();
  const engine = new AudioEngine({ sampleRate: SAMPLE_RATE, channels: 2 });
  await engine.initialize();
  (engine as unknown as { mediaBuffers: Map<string, unknown> }).mediaBuffers.set("media-1:0", source);
  return { engine, restore };
}

/** Sample channel 0 of a rendered buffer at a time in seconds. */
export function valueAt(buffer: { getChannelData(c: number): Float32Array; sampleRate: number }, seconds: number): number {
  return buffer.getChannelData(0)[Math.floor(seconds * buffer.sampleRate)];
}
