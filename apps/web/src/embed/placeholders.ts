import type { Action, ClipMetadata, MediaItem, PlaceholderClipInfo, Project } from "@openreel/core";
import { saveMediaBlob } from "../services/media-storage";
import { useProjectStore } from "../stores/project-store";
import { getHostMetadata, mergeHostMetadata } from "./host-clips";
import { dataUrlToFile, loadStill, renderPlaceholderCard } from "./placeholder-card";
import type { AddPlaceholderOptions, PlaceholderPatch } from "./types";

type PlainRecord = Record<string, unknown>;

const MAX_CARD_EDGE = 960;

/** How many placeholder clips are still on the timeline. */
export function countPlaceholders(project: Project): number {
  let count = 0;
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) if (clip.metadata?.placeholder) count += 1;
  }
  return count;
}

function findClip(id: string) {
  for (const track of useProjectStore.getState().project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return clip;
  }
  return undefined;
}

/**
 * Add the generated still for a placeholder to the media library (the item is
 * in the project before the first await) and persist its bytes. The item is
 * hidden from the Media panel (`hostGenerated`).
 */
async function addCardMedia(
  info: PlaceholderClipInfo,
  image?: HTMLImageElement | null,
): Promise<MediaItem> {
  if (useProjectStore.getState().actionExecutor.isReadOnly()) {
    throw new Error("The editor is read only");
  }
  const { project } = useProjectStore.getState();
  const scale = Math.min(1, MAX_CARD_EDGE / Math.max(project.settings.width, project.settings.height));
  const width = Math.max(2, Math.round(project.settings.width * scale));
  const height = Math.max(2, Math.round(project.settings.height * scale));
  const dataUrl = renderPlaceholderCard({
    label: info.label,
    pattern: info.pattern,
    width,
    height,
    image: image ?? undefined,
  });
  const id = crypto.randomUUID();
  const file = dataUrlToFile(dataUrl, `placeholder-${id.slice(0, 8)}.png`);
  const item: MediaItem = {
    id,
    name: info.label ? `Placeholder: ${info.label}` : "Placeholder",
    type: "image",
    fileHandle: null,
    blob: file,
    metadata: {
      duration: 0,
      width,
      height,
      frameRate: 0,
      codec: "image/png",
      sampleRate: 0,
      channels: 0,
      fileSize: file.size,
      hasVideo: true,
      hasAudio: false,
    },
    thumbnailUrl: dataUrl,
    waveformData: null,
    hostGenerated: true,
  };
  useProjectStore.setState((state) => ({
    project: {
      ...state.project,
      mediaLibrary: {
        ...state.project.mediaLibrary,
        items: [...state.project.mediaLibrary.items, item],
      },
      modifiedAt: Date.now(),
    },
  }));
  try {
    await saveMediaBlob(project.id, id, file, item.metadata);
  } catch (error) {
    console.error("[OpenReel] Could not store the placeholder still:", error);
  }
  return item;
}

async function run(
  type: string,
  params: Record<string, unknown>,
): Promise<void> {
  const result = await useProjectStore.getState().executeAction({
    type,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params,
  } as unknown as Action);
  if (!result.success) {
    throw new Error(result.error?.message ?? `${type} failed`);
  }
}

/**
 * Fetch a placeholder's proxy (`previewUrl`), import it as hidden media and
 * point the clip at it, keeping the placeholder marker, position, row and
 * length. The proxy then plays in the preview until `replacePlaceholder`.
 */
async function applyPreviewProxy(clipId: string, url: string): Promise<void> {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`Could not fetch the placeholder preview ${url} (${response.status})`);
  const blob = await response.blob();
  const name = decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() || "preview.mp4");
  const file = new File([blob], name, { type: blob.type || "video/mp4" });
  const before = new Set(useProjectStore.getState().project.mediaLibrary.items.map((item) => item.id));
  const imported = await useProjectStore.getState().importMedia(file);
  if (!imported.success) throw new Error(imported.error?.message ?? "Could not import the placeholder preview");
  const media = useProjectStore.getState().project.mediaLibrary.items.find((item) => !before.has(item.id));
  if (!media) throw new Error("The placeholder preview was not imported");
  // hidden from the Media panel like the placeholder's still
  useProjectStore.setState((state) => ({
    project: {
      ...state.project,
      mediaLibrary: {
        ...state.project.mediaLibrary,
        items: state.project.mediaLibrary.items.map((item) => (item.id === media.id ? { ...item, hostGenerated: true } : item)),
      },
    },
  }));
  const clip = findClip(clipId);
  // replaced or given another proxy meanwhile: leave it
  if (!clip?.metadata?.placeholder || clip.metadata.placeholder.previewUrl !== url) return;
  await run("clip/replaceMedia", {
    clipId,
    mediaId: media.id,
    duration: clip.duration,
    inPoint: 0,
    outPoint: clip.duration,
    metadata: clip.metadata,
    hostEdit: true,
  });
}

function withoutUndefined(info: PlaceholderClipInfo): PlaceholderClipInfo {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(info)) if (value !== undefined) out[key] = value;
  return out as unknown as PlaceholderClipInfo;
}

/**
 * The host-facing placeholder operations. Work runs one step at a time in
 * call order, so `addPlaceholderClip` can return the clip id at once and later
 * calls (update, replace) still see the clip.
 */
export function createPlaceholderController() {
  let queue: Promise<unknown> = Promise.resolve();
  /** Host metadata of clips that are queued but not on the timeline yet. */
  const pending = new Map<string, PlainRecord>();

  const enqueue = (label: string, step: () => Promise<void>): Promise<void> => {
    const next = queue.then(step).catch((error: unknown) => {
      console.error(`[OpenReel] ${label} failed:`, error);
    });
    queue = next;
    return next;
  };

  async function applyStill(
    clipId: string,
    info: PlaceholderClipInfo,
    crossOrigin?: AddPlaceholderOptions["imageCrossOrigin"],
  ): Promise<void> {
    if (!info.imageUrl) return;
    const image = await loadStill(info.imageUrl, crossOrigin);
    if (!image) {
      console.warn(`[OpenReel] Could not load the placeholder still ${info.imageUrl}; keeping the card.`);
      return;
    }
    const clip = findClip(clipId);
    if (!clip?.metadata?.placeholder || clip.metadata.placeholder.imageUrl !== info.imageUrl) return;
    const media = await addCardMedia(info, image);
    await run("clip/replaceMedia", {
      clipId,
      mediaId: media.id,
      duration: clip.duration,
      metadata: clip.metadata,
    });
  }

  return {
    add(options: AddPlaceholderOptions): string {
      const clipId = crypto.randomUUID();
      const info = withoutUndefined({
        label: options.label,
        imageUrl: options.imageUrl,
        pattern: options.pattern ?? "bars",
        progress: options.progress,
        previewUrl: options.previewUrl,
      });
      const metadata: ClipMetadata = {
        placeholder: info,
        ...(options.metadata ? { host: { ...options.metadata } } : {}),
      };
      pending.set(clipId, { ...(options.metadata ?? {}) });
      void enqueue("addPlaceholderClip", async () => {
        try {
          const media = await addCardMedia(info);
          const result = await useProjectStore
            .getState()
            .placeMediaClip(media.id, options.trackId, options.start, {
              clipId,
              duration: options.duration,
              metadata,
            });
          if (!result.success) {
            throw new Error(result.error?.message ?? "Could not place the placeholder");
          }
        } finally {
          pending.delete(clipId);
        }
        if (info.previewUrl) await applyPreviewProxy(clipId, info.previewUrl);
        else await applyStill(clipId, info, options.imageCrossOrigin);
      });
      return clipId;
    },

    update(id: string, patch: PlaceholderPatch): void {
      void enqueue("updatePlaceholder", async () => {
        const clip = findClip(id);
        const current = clip?.metadata?.placeholder;
        if (!clip || !current) throw new Error(`"${id}" is not a placeholder clip`);
        const next = withoutUndefined({
          label: patch.label ?? current.label,
          imageUrl: patch.imageUrl ?? current.imageUrl,
          pattern: patch.pattern ?? current.pattern,
          progress: patch.progress ?? current.progress,
          previewUrl: patch.previewUrl ?? current.previewUrl,
        });
        const host =
          patch.metadata || clip.metadata?.host
            ? { ...(clip.metadata?.host ?? {}), ...(patch.metadata ?? {}) }
            : undefined;
        const metadata: ClipMetadata = {
          ...(clip.metadata ?? {}),
          placeholder: next,
          ...(host ? { host } : {}),
        };
        const visual =
          next.label !== current.label ||
          next.imageUrl !== current.imageUrl ||
          next.pattern !== current.pattern;
        // while a proxy plays, the card is not shown: only the timeline drawing changes
        if (visual && !next.previewUrl) {
          const image = next.imageUrl ? await loadStill(next.imageUrl) : null;
          const media = await addCardMedia(next, image);
          await run("clip/replaceMedia", {
            clipId: id,
            mediaId: media.id,
            duration: clip.duration,
            metadata,
          });
        } else {
          await run("clip/setMetadata", { clipId: id, metadata });
        }
        if (patch.duration !== undefined && patch.duration !== clip.duration) {
          await run("clip/restoreTiming", {
            clipId: id,
            startTime: clip.startTime,
            duration: patch.duration,
            inPoint: 0,
            outPoint: patch.duration,
            hostEdit: true,
          });
        }
        if (next.previewUrl && next.previewUrl !== current.previewUrl) await applyPreviewProxy(id, next.previewUrl);
      });
    },

    replace(id: string, mediaId: string): void {
      void enqueue("replacePlaceholder", async () => {
        const store = useProjectStore.getState();
        const clip = findClip(id);
        if (!clip?.metadata?.placeholder) throw new Error(`"${id}" is not a placeholder clip`);
        const media = store.project.mediaLibrary.items.find((item) => item.id === mediaId);
        if (!media) throw new Error(`No media item "${mediaId}" in the project`);
        const length = media.metadata.duration;
        const duration = length > 0 && length < clip.duration ? length : clip.duration;
        const rest: PlainRecord = { ...clip.metadata };
        delete rest.placeholder;
        await run("clip/replaceMedia", {
          clipId: id,
          mediaId,
          duration,
          inPoint: 0,
          outPoint: duration,
          metadata: Object.keys(rest).length ? rest : undefined,
          clearMetadata: Object.keys(rest).length === 0,
        });
      });
    },

    getMetadata(id: string): PlainRecord | undefined {
      const queued = pending.get(id);
      return queued ? { ...queued } : getHostMetadata(id);
    },

    setMetadata(id: string, patch: PlainRecord): void {
      const queued = pending.get(id);
      if (queued) {
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete queued[key];
          else queued[key] = value;
        }
      }
      void enqueue("setClipMetadata", () => mergeHostMetadata(id, patch));
    },

    /** Resolves when everything queued so far has finished (for tests). */
    idle: () => queue.then(() => undefined),
  };
}

export type PlaceholderController = ReturnType<typeof createPlaceholderController>;
