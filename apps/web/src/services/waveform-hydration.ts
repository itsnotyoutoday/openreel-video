import type { MediaItem } from "@openreel/core";
import { getMediaBridge, initializeMediaBridge } from "../bridges/media-bridge";
import { useProjectStore } from "../stores/project-store";

/**
 * Waveform peaks are not stored with a project (save, auto-save and media
 * recovery drop them), so audio clips of a reopened or host-loaded project
 * would draw no waveform. This computes them again, once per media item, from
 * the media's bytes. The peaks are display data: setting them is not an edit
 * and never makes the project dirty.
 */
const inFlight = new Set<string>();
const failed = new Set<string>();

/** True when this media item has sound but no waveform yet and its bytes are here. */
export function needsWaveform(item: MediaItem | undefined): item is MediaItem {
  if (!item || item.waveformData || !item.blob || item.isPlaceholder) return false;
  if (item.type === "image") return false;
  return item.type === "audio" || item.metadata.hasAudio !== false;
}

export async function ensureWaveform(item: MediaItem | undefined): Promise<void> {
  if (!needsWaveform(item) || inFlight.has(item.id) || failed.has(item.id)) return;
  inFlight.add(item.id);
  try {
    const bridge = getMediaBridge();
    if (!bridge.isInitialized()) await initializeMediaBridge();
    const waveform = await bridge.generateWaveform(item.blob as Blob, item.id);
    if (!waveform?.peaks?.length) {
      failed.add(item.id);
      return;
    }
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        mediaLibrary: {
          ...state.project.mediaLibrary,
          items: state.project.mediaLibrary.items.map((media) =>
            media.id === item.id && !media.waveformData ? { ...media, waveformData: waveform.peaks } : media,
          ),
        },
      },
    }));
  } catch (error) {
    failed.add(item.id);
    console.warn(`[OpenReel] Could not compute the waveform of ${item.name}:`, error);
  } finally {
    inFlight.delete(item.id);
  }
}
