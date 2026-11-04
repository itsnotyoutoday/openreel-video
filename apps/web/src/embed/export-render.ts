import { getExportEngine, type ExportResult } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";

async function drain(generator: AsyncGenerator<unknown, ExportResult>): Promise<ExportResult> {
  for (;;) {
    const { value, done } = await generator.next();
    if (done) return value;
  }
}

/** One frame as a PNG, at `atSeconds` (default: the playhead). */
export async function renderStill(atSeconds?: number): Promise<Blob> {
  const project = useProjectStore.getState().getFullProject();
  const time = atSeconds ?? useTimelineStore.getState().playheadPosition;
  if (!Number.isFinite(time) || time < 0) throw new Error("renderStill needs a time of zero or more seconds");
  const engine = getExportEngine();
  await engine.initialize();
  const result = await engine.exportFrame(project, time, { format: "png", quality: 100 });
  if (!result.success || !result.blob) {
    throw new Error(result.error?.message ?? "Could not render the frame");
  }
  return result.blob;
}

/** The mixed audio of the whole timeline as a WAV. */
export async function renderAudio(): Promise<Blob> {
  const project = useProjectStore.getState().getFullProject();
  const engine = getExportEngine();
  await engine.initialize();
  const result = await drain(engine.exportAudio(project, { format: "wav" }));
  if (!result.success || !result.blob) {
    throw new Error(result.error?.message ?? "Could not render the audio");
  }
  return result.blob;
}
