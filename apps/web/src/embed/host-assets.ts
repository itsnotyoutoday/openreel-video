import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { getHostRuntime } from "./host-runtime";
import { HOST_ASSET_MIME } from "./host-clips";
import type { HostDragAsset } from "./types";

/**
 * Import a finished recording. With `hostActions.record` the host sees the file
 * first (to put it in its own storage) and may hand back the file to import;
 * without it the recording is imported as before.
 */
export async function importRecordedFile<R extends { success: boolean }>(
  file: File,
  record: ((file: File) => Promise<File | undefined> | File | undefined) | undefined,
  importFile: (file: File) => Promise<R>,
): Promise<R | { success: false; error: { code: "INVALID_PARAMS"; message: string } }> {
  if (!record) return importFile(file);
  try {
    return await importFile((await record(file)) ?? file);
  } catch (error) {
    return {
      success: false,
      error: { code: "INVALID_PARAMS", message: error instanceof Error ? error.message : String(error) },
    };
  }
}

/** Import files into the open project like dropped files; returns the media ids. */
export async function importFilesToLibrary(files: readonly File[]): Promise<string[]> {
  const ids: string[] = [];
  for (const file of files) {
    const store = useProjectStore.getState();
    const before = new Set(store.project.mediaLibrary.items.map((item) => item.id));
    const result = await store.importMedia(file);
    if (!result.success) {
      throw new Error(result.error?.message ?? `Could not import ${file.name}`);
    }
    const added = useProjectStore
      .getState()
      .project.mediaLibrary.items.find((item) => !before.has(item.id));
    if (!added) throw new Error(`Imported ${file.name} but found no new media item`);
    ids.push(added.id);
  }
  return ids;
}

export async function resolveAsset(assetId: string, name?: string): Promise<File> {
  const media = getHostRuntime()?.options.media;
  if (!media) throw new Error("No media source was passed to mountEditor");
  const blob = await media.resolve(assetId);
  if (blob instanceof File && !name) return blob;
  return new File([blob], name ?? (blob instanceof File ? blob.name : assetId), {
    type: blob.type,
  });
}

function mediaDuration(mediaId: string): number {
  const item = useProjectStore.getState().project.mediaLibrary.items.find((m) => m.id === mediaId);
  return item && item.metadata.duration > 0 ? item.metadata.duration : 5;
}

/**
 * Resolve host assets through `media.resolve`, import them and, when `place` is
 * given, put them on the timeline one after another from `place.at`.
 */
export async function importHostAssets(
  assets: ReadonlyArray<{ id: string; name?: string }>,
  place?: { trackId?: string; at?: number },
): Promise<string[]> {
  const mediaIds: string[] = [];
  let at = place?.at ?? useTimelineStore.getState().playheadPosition;
  let trackId = place?.trackId;
  for (const asset of assets) {
    const file = await resolveAsset(asset.id, asset.name);
    const [mediaId] = await importFilesToLibrary([file]);
    mediaIds.push(mediaId);
    if (place) {
      const result = await useProjectStore.getState().placeMediaClip(mediaId, trackId, at);
      if (!result.success) {
        throw new Error(result.error?.message ?? `Could not place ${file.name}`);
      }
      at += mediaDuration(mediaId);
      // later assets follow the first one on the track it landed on
      trackId =
        trackId ??
        useProjectStore
          .getState()
          .project.timeline.tracks.find((track) => track.clips.some((c) => c.mediaId === mediaId))?.id;
    }
  }
  return mediaIds;
}

/** Put the payload of a host drag in the DataTransfer. */
export function setHostDragData(event: DragEvent, assets: readonly HostDragAsset[]): void {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(HOST_ASSET_MIME, JSON.stringify(assets));
  event.dataTransfer.effectAllowed = "copy";
}

/** The assets in a host drag, or `null` when the event carries none. */
export function readHostDragAssets(dataTransfer: DataTransfer | null): HostDragAsset[] | null {
  if (!dataTransfer || !Array.from(dataTransfer.types).includes(HOST_ASSET_MIME)) return null;
  try {
    const parsed: unknown = JSON.parse(dataTransfer.getData(HOST_ASSET_MIME));
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (a): a is HostDragAsset =>
        typeof a === "object" && a !== null && typeof (a as HostDragAsset).id === "string",
    );
  } catch {
    return null;
  }
}

/** Handle a drop of host assets on the timeline: resolve, import, place. */
export async function dropHostAssets(
  assets: readonly HostDragAsset[],
  trackId: string | undefined,
  at: number,
): Promise<void> {
  try {
    await importHostAssets(assets, { trackId, at });
  } catch (error) {
    console.error("[OpenReel] Dropping host assets failed:", error);
    const { toast } = await import("../stores/notification-store");
    toast.error("Could not add the dropped media", error instanceof Error ? error.message : String(error));
  }
}
