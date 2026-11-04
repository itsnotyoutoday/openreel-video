import type { Clip, Project } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import type { HostClipInfo } from "./types";

/** Id prefix of the selection item for a join that has no transition yet: `join:<clipA>:<clipB>`. */
export const JOIN_PREFIX = "join:";

/** DataTransfer type a host media tab drags assets under. */
export const HOST_ASSET_MIME = "application/x-openreel-host-assets";

type PlainRecord = Record<string, unknown>;

function mediaTypeOf(project: Project, clip: Clip): "video" | "image" | "audio" {
  const media = project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
  if (media) return media.type;
  const track = project.timeline.tracks.find((t) => t.id === clip.trackId);
  return track?.type === "audio" ? "audio" : track?.type === "image" ? "image" : "video";
}

/**
 * The name the host gave a clip (`setClipMetadata(id, { label })`, stored as
 * `metadata.host.label`); it wins over the media's file name everywhere the
 * editor names a clip: the timeline, its tooltip, the inspector header, menus.
 */
export function hostLabelOf(clip: { readonly metadata?: { readonly host?: Readonly<Record<string, unknown>> } }): string | undefined {
  const label = clip.metadata?.host?.label;
  return typeof label === "string" && label.trim() ? label : undefined;
}

/** The host's view of a timeline clip; `undefined` if there is no such clip. */
export function hostClipInfo(project: Project, id: string): HostClipInfo | undefined {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (!clip) continue;
    const placeholder = clip.metadata?.placeholder;
    const media = project.mediaLibrary.items.find((item) => item.id === clip.mediaId);
    return {
      id: clip.id,
      trackId: track.id,
      type: placeholder ? "placeholder" : mediaTypeOf(project, clip),
      start: clip.startTime,
      duration: clip.duration,
      mediaId: clip.mediaId,
      label: hostLabelOf(clip) ?? placeholder?.label ?? media?.name,
      metadata: clip.metadata?.host ? { ...clip.metadata.host } : undefined,
    };
  }
  const text = project.textClips?.find((c) => c.id === id);
  if (text) {
    return {
      id: text.id,
      trackId: text.trackId,
      type: "text",
      start: text.startTime,
      duration: text.duration,
      label: text.text,
    };
  }
  for (const list of [project.shapeClips, project.svgClips, project.stickerClips]) {
    const item = list?.find((c) => c.id === id);
    if (item) {
      return {
        id: item.id,
        trackId: item.trackId,
        type: "graphic",
        start: item.startTime,
        duration: item.duration,
      };
    }
  }
  return undefined;
}

/** Equality for the fields a host sees, so listeners fire only on real changes. */
export function sameHostClip(a: HostClipInfo | undefined, b: HostClipInfo | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.trackId === b.trackId &&
    a.type === b.type &&
    a.start === b.start &&
    a.duration === b.duration &&
    a.mediaId === b.mediaId &&
    a.label === b.label &&
    JSON.stringify(a.metadata) === JSON.stringify(b.metadata)
  );
}

/** Calls `cb` with the clip's info now and whenever it changes (null once it is gone). */
export function watchHostClip(
  id: string,
  cb: (clip: HostClipInfo | null) => void,
): () => void {
  let last = hostClipInfo(useProjectStore.getState().project, id);
  return useProjectStore.subscribe(
    (state) => state.project,
    (project) => {
      const next = hostClipInfo(project, id);
      if (sameHostClip(last, next)) return;
      last = next;
      try {
        cb(next ?? null);
      } catch (error) {
        console.error("[OpenReel] A host clip listener failed:", error);
      }
    },
  );
}

/** Host metadata of a timeline clip. */
export function getHostMetadata(id: string): PlainRecord | undefined {
  for (const track of useProjectStore.getState().project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return clip.metadata?.host ? { ...clip.metadata.host } : undefined;
  }
  return undefined;
}

/** Merge `patch` into a clip's host metadata as one undoable action. */
export async function mergeHostMetadata(id: string, patch: PlainRecord): Promise<void> {
  const store = useProjectStore.getState();
  let clip: Clip | undefined;
  for (const track of store.project.timeline.tracks) {
    clip = track.clips.find((c) => c.id === id) ?? clip;
  }
  if (!clip) throw new Error(`No timeline clip "${id}"`);
  const host: PlainRecord = { ...(clip.metadata?.host ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete host[key];
    else host[key] = value;
  }
  const rest: PlainRecord = { ...(clip.metadata ?? {}) };
  delete rest.host;
  const metadata = { ...rest, ...(Object.keys(host).length ? { host } : {}) };
  const result = await store.executeAction({
    type: "clip/setMetadata",
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params: { clipId: id, metadata: Object.keys(metadata).length ? metadata : undefined },
  });
  if (!result.success) {
    throw new Error(result.error?.message ?? "Could not change the clip metadata");
  }
}
