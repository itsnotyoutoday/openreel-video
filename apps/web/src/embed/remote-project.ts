import { normalizeLoadedOverlaps, type Clip, type Project, type Track } from "@openreel/core";
import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import { attachProjectMedia, setKnownRevision } from "../services/storage/project-persistence";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { hostClipInfo } from "./host-clips";

export interface RemoteProjectOptions {
  readonly revision?: string;
  readonly keepSelection?: boolean;
  readonly keepPlayhead?: boolean;
  readonly keepZoom?: boolean;
}

/**
 * Carry the open project's edit locks over to an incoming project: a row
 * (matched by id) whose incoming `locked` is missing keeps its lock, and a clip
 * (matched by id) without a `locks` field keeps its locks. A lock the incoming
 * project states (`locked: false`, `locks: {}`) wins, so the host can still
 * change them.
 */
export function keepEditLocks(incoming: Project, current: Project): Project {
  const tracks = new Map<string, Track>(current.timeline.tracks.map((track) => [track.id, track]));
  const clips = new Map<string, Clip>();
  for (const track of current.timeline.tracks) for (const clip of track.clips) clips.set(clip.id, clip);
  let changed = false;
  const nextTracks = incoming.timeline.tracks.map((track) => {
    const before = tracks.get(track.id);
    let next = track;
    if ((track as { locked?: boolean }).locked === undefined) {
      next = { ...next, locked: before?.locked ?? false };
      changed = true;
    }
    const nextClips = track.clips.map((clip) => {
      const kept = clips.get(clip.id)?.locks;
      if (!kept || "locks" in clip) return clip;
      changed = true;
      return { ...clip, locks: { ...kept } };
    });
    return nextClips.some((clip, i) => clip !== track.clips[i]) ? { ...next, clips: nextClips } : next;
  });
  return changed ? { ...incoming, timeline: { ...incoming.timeline, tracks: nextTracks } } : incoming;
}

/**
 * Replace the open project's content with `incoming` as one undoable step
 * ("Remote change"), without reloading the editor. Selection, playhead and zoom
 * are kept unless the options say otherwise, and a read-only editor still
 * accepts this: it is the host changing the cut, not the person.
 */
export async function applyRemoteProject(
  incoming: Project,
  options: RemoteProjectOptions = {},
): Promise<void> {
  const store = useProjectStore.getState();
  if (!store.hasOpenProject) throw new Error("No project is open");
  const ui = useUIStore.getState();
  const timeline = useTimelineStore.getState();
  const selection = ui.selectedItems;
  const playhead = timeline.playheadPosition;
  const zoom = timeline.pixelsPerSecond;

  const merged = await attachProjectMedia(keepEditLocks(incoming, store.project), store.project.mediaLibrary.items);
  if (options.revision !== undefined) setKnownRevision(store.project.id, options.revision);

  const { actionExecutor } = useProjectStore.getState();
  const wasReadOnly = actionExecutor.isReadOnly();
  actionExecutor.setReadOnly(false);
  const projectStore = useProjectStore.getState();
  projectStore.beginHistoryGroup("Remote change");
  let result: Awaited<ReturnType<typeof store.executeAction>>;
  try {
    result = await useProjectStore.getState().executeAction({
      type: "project/applyEditSnapshot",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      params: { snapshot: editSnapshot(normalizeLoadedOverlaps(merged)) },
    });
  } finally {
    projectStore.endHistoryGroup();
    actionExecutor.setReadOnly(wasReadOnly);
  }
  if (!result.success) {
    throw new Error(result.error?.message ?? "The remote project could not be applied");
  }

  const project = useProjectStore.getState().project;
  if (options.keepSelection === false) {
    useUIStore.getState().clearSelection();
  } else {
    const kept = selection.filter((item) => hostClipInfo(project, item.id) !== undefined);
    if (kept.length !== selection.length) useUIStore.getState().selectMultiple(kept);
  }
  if (options.keepPlayhead === false) useTimelineStore.getState().seekTo(0);
  else useTimelineStore.getState().seekTo(playhead);
  if (options.keepZoom === false) useTimelineStore.getState().resetZoom();
  else useTimelineStore.getState().setZoom(zoom);
}
