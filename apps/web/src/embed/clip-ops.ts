import type { Action, Clip } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { importFilesToLibrary, resolveAsset } from "./host-assets";
import { mergeHostMetadata } from "./host-clips";
import type { HostMediaRef } from "./types";

function findClip(id: string): Clip {
  for (const track of useProjectStore.getState().project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return clip;
  }
  throw new Error(`No timeline clip "${id}"`);
}

async function run(type: string, params: Record<string, unknown>): Promise<void> {
  const result = await useProjectStore.getState().executeAction({
    type,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params,
  } as unknown as Action);
  if (!result.success) throw new Error(result.error?.message ?? `${type} failed`);
}

/** Run several steps as one undo entry. */
async function asOneStep(label: string, steps: () => Promise<void>): Promise<void> {
  const store = useProjectStore.getState();
  store.beginHistoryGroup(label);
  try {
    await steps();
  } finally {
    store.endHistoryGroup();
  }
}

/** Change a clip's volume, fades and display name in one undo step. */
export async function updateClip(
  id: string,
  patch: { volume?: number; fadeIn?: number; fadeOut?: number; name?: string },
): Promise<void> {
  findClip(id);
  if (patch.volume !== undefined && !(Number.isFinite(patch.volume) && patch.volume >= 0)) {
    throw new Error("volume must be a number from 0 up (1 is unity)");
  }
  for (const key of ["fadeIn", "fadeOut"] as const) {
    const value = patch[key];
    if (value !== undefined && !(Number.isFinite(value) && value >= 0)) {
      throw new Error(`${key} must be a number of seconds, 0 or more`);
    }
  }
  await asOneStep("Edit clip", async () => {
    if (patch.volume !== undefined) await run("audio/setVolume", { clipId: id, volume: patch.volume });
    if (patch.fadeIn !== undefined || patch.fadeOut !== undefined) {
      await run("audio/setFade", {
        clipId: id,
        ...(patch.fadeIn !== undefined ? { fadeIn: patch.fadeIn } : {}),
        ...(patch.fadeOut !== undefined ? { fadeOut: patch.fadeOut } : {}),
      });
    }
    if (patch.name !== undefined) await mergeHostMetadata(id, { label: patch.name || undefined });
  });
}

async function mediaIdFor(media: string | File | HostMediaRef): Promise<string> {
  if (typeof media === "string") {
    if (!useProjectStore.getState().project.mediaLibrary.items.some((item) => item.id === media)) {
      throw new Error(`No media item "${media}" in the project`);
    }
    return media;
  }
  const file = media instanceof File ? media : await resolveAsset(media.assetId, media.name);
  const [mediaId] = await importFilesToLibrary([file]);
  return mediaId;
}

/**
 * Point a clip at other media (a media id, a File or a host library reference).
 * Position, track, transitions and metadata stay; so does the duration, shortened
 * when the media is shorter, unless `opts.duration` is `"media"`.
 */
export async function replaceClipMedia(
  clipId: string,
  media: string | File | HostMediaRef,
  opts: { duration?: "keep" | "media" } = {},
): Promise<void> {
  const clip = findClip(clipId);
  const mediaId = await mediaIdFor(media);
  const item = useProjectStore.getState().project.mediaLibrary.items.find((m) => m.id === mediaId);
  const length = item?.metadata.duration ?? 0;
  const duration =
    opts.duration === "media" && length > 0 ? length : length > 0 && length < clip.duration ? length : clip.duration;
  const rest: Record<string, unknown> = { ...(clip.metadata ?? {}) };
  delete rest.placeholder;
  await asOneStep("Replace media", () =>
    run("clip/replaceMedia", {
      clipId,
      mediaId,
      duration,
      inPoint: 0,
      outPoint: duration,
      metadata: Object.keys(rest).length ? rest : undefined,
      clearMetadata: Object.keys(rest).length === 0,
    }),
  );
}

/** Remove a clip; with `ripple` the clips after it close the gap. */
export async function removeClipOp(id: string, opts: { ripple?: boolean } = {}): Promise<void> {
  findClip(id);
  const store = useProjectStore.getState();
  const result = opts.ripple ? await store.rippleDeleteClip(id) : await store.removeClip(id);
  if (!result.success) throw new Error(result.error?.message ?? "Could not remove the clip");
}
