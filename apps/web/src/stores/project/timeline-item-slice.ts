import { cloneProjectForEdit } from "./clone-project-for-edit";
import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { Action, ActionResult, Track } from "@openreel/core";
import {
  createEmptyRow,
  isTimelineIntervalClear,
  resolveTimelineItem,
  nextRowName,
  resolveTimelinePlacement,
  topRowIndex,
  withUniversalTracksCapability,
} from "@openreel/core";
import type { ProjectState } from "../project-store";
import type { ProjectStoreHelpers } from "./store-helpers";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export type TimelineItemSlice = Pick<
  ProjectState,
  "placeMediaClip" | "moveTimelineItem" | "moveTimelineItems" | "moveTimelineSelection"
>;

const failure = (
  code: "INVALID_PARAMS" | "TRACK_NOT_FOUND" | "TRACK_LOCKED" | "CLIP_LOCKED" | "OVERLAP_DETECTED",
  message: string,
): ActionResult => ({ success: false, error: { code, message } });

export function createTimelineItemSlice(
  set: Set,
  get: Get,
  helpers: ProjectStoreHelpers,
): TimelineItemSlice {
  const executePlacement = async (
    actions: Action[],
    description: string,
  ): Promise<ActionResult> => {
    const { project, actionExecutor } = get();
    const projectCopy = cloneProjectForEdit(project);
    const history = actionExecutor.getHistory();
    history.beginGroup(description);
    let results: ActionResult[] = [];
    try {
      results = await actionExecutor.executeMany(actions, projectCopy);
    } finally {
      history.endGroup();
    }
    const failed = results.find((result) => !result.success);
    if (failed) return failed;

    const nextProject = withUniversalTracksCapability({
      ...projectCopy,
      modifiedAt: Date.now(),
    });
    set({ project: nextProject });
    helpers.syncOverlayEnginesFromProject();
    return results.at(-1) ?? { success: true };
  };

  return {
    placeMediaClip: async (mediaId, targetTrackId, startTime, options) => {
      const { project } = get();
      const mediaItem = project.mediaLibrary.items.find(
        (item) => item.id === mediaId,
      );
      if (!mediaItem) return failure("INVALID_PARAMS", "Media item not found");

      const duration =
        options?.duration ??
        (mediaItem.metadata.duration > 0 ? mediaItem.metadata.duration : 5);
      const newTrackId = uuidv4();
      const placement = targetTrackId
        ? resolveTimelinePlacement(project, {
            targetTrackId,
            startTime,
            duration,
            policy: "stack-above",
            newTrackId,
            ...(mediaItem.type === "video" || mediaItem.type === "audio" || mediaItem.type === "image"
              ? { itemType: mediaItem.type }
              : {}),
          })
        : {
            ok: true as const,
            trackId: newTrackId,
            startTime: Math.max(0, startTime),
            createdTrack: {
              id: newTrackId,
              position: project.timeline.tracks.length,
              type: (["video", "audio", "image"] as const).find((kind) => kind === mediaItem.type) ?? "video",
            },
          };

      if (!placement.ok) {
        if (placement.reason === "track-not-found") {
          return failure("TRACK_NOT_FOUND", "Destination track not found");
        }
        if (placement.reason === "track-locked") {
          return failure("TRACK_LOCKED", "Destination track is locked");
        }
        return failure("OVERLAP_DETECTED", "The destination interval is occupied");
      }

      const actions: Action[] = [];
      if (placement.createdTrack) {
        actions.push({
          type: "track/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            trackType: placement.createdTrack.type ?? "video",
            name: nextRowName(project.timeline.tracks, placement.createdTrack.type ?? "video"),
            trackId: placement.createdTrack.id,
            position: placement.createdTrack.position,
            mode: "standard",
          },
        });
      }
      actions.push({
        type: "clip/add",
        id: uuidv4(),
        timestamp: Date.now(),
        params: {
          clipId: options?.clipId ?? uuidv4(),
          trackId: placement.trackId,
          mediaId,
          startTime: placement.startTime,
          duration,
          ...(options?.metadata ? { metadata: options.metadata } : {}),
        },
      });
      return executePlacement(actions, "Place media");
    },

    moveTimelineItem: async (itemId, startTime, targetTrackId) => {
      const { project } = get();
      const resolved = resolveTimelineItem(project, itemId);
      if (!resolved) return failure("INVALID_PARAMS", "Timeline item not found");
      const sourceTrack = project.timeline.tracks.find(
        (track) => track.id === resolved.trackId,
      );
      if (sourceTrack?.locked) {
        return failure("TRACK_LOCKED", "Source track is locked");
      }

      const requestedTrackId = targetTrackId ?? resolved.trackId;
      const placement = resolveTimelinePlacement(project, {
        targetTrackId: requestedTrackId,
        startTime,
        duration: resolved.duration,
        policy: targetTrackId ? "stack-above" : "gap",
        excludeItemIds: [itemId],
        newTrackId: uuidv4(),
        ...(targetTrackId && sourceTrack ? { itemType: sourceTrack.type } : {}),
      });
      if (!placement.ok) {
        if (placement.reason === "track-not-found") {
          return failure("TRACK_NOT_FOUND", "Destination track not found");
        }
        if (placement.reason === "track-locked") {
          return failure("TRACK_LOCKED", "Destination track is locked");
        }
        return failure("OVERLAP_DETECTED", "The destination interval is occupied");
      }

      const actions: Action[] = [];
      if (placement.createdTrack) {
        actions.push({
          type: "track/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            trackType: placement.createdTrack.type ?? "video",
            name: nextRowName(project.timeline.tracks, placement.createdTrack.type ?? "video"),
            trackId: placement.createdTrack.id,
            position: placement.createdTrack.position,
            mode: "standard",
          },
        });
      }
      const move = moveAction(itemId, resolved.kind, placement.startTime, placement.trackId);
      if (!move) {
        return failure(
          "INVALID_PARAMS",
          "This timeline item cannot be moved from the timeline yet",
        );
      }
      actions.push(move);

      return executePlacement(actions, "Move timeline item");
    },

    moveTimelineItems: async (moves, targetTrackId) => {
      const { project } = get();
      if (moves.length === 0) return { success: true };
      const items: Array<{
        itemId: string;
        startTime: number;
        resolved: NonNullable<ReturnType<typeof resolveTimelineItem>>;
      }> = [];
      for (const move of moves) {
        const resolved = resolveTimelineItem(project, move.itemId);
        if (!resolved) return failure("INVALID_PARAMS", "Timeline item not found");
        items.push({ ...move, startTime: Math.max(0, move.startTime), resolved });
      }
      const tracks = project.timeline.tracks;
      const sourceIds = new Set(items.map((item) => item.resolved.trackId));
      if (tracks.some((track) => sourceIds.has(track.id) && track.locked)) {
        return failure("TRACK_LOCKED", "Source track is locked");
      }
      const targetIndex = tracks.findIndex((track) => track.id === targetTrackId);
      const target = tracks[targetIndex];
      if (!target) return failure("TRACK_NOT_FOUND", "Destination track not found");
      const kind = tracks.find((track) => track.id === items[0].resolved.trackId)?.type ?? target.type;
      const ids = items.map((item) => item.itemId);
      // the set stays together: on the target row when it takes all of it, else on one new row
      const fits =
        !target.locked &&
        target.type === kind &&
        items.every((item) =>
          isTimelineIntervalClear(project, target.id, item.startTime, item.resolved.duration, ids),
        );
      const actions: Action[] = [];
      let destId = target.id;
      if (!fits) {
        destId = uuidv4();
        actions.push({
          type: "track/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            trackType: kind,
            name: nextRowName(tracks, kind),
            trackId: destId,
            position: topRowIndex(tracks, kind, targetIndex),
            mode: "standard",
          },
        });
      }
      for (const item of items) {
        const action = moveAction(item.itemId, item.resolved.kind, item.startTime, destId);
        if (!action) {
          return failure("INVALID_PARAMS", "This timeline item cannot be moved from the timeline yet");
        }
        actions.push(action);
      }
      return executePlacement(actions, "Move timeline items");
    },

    moveTimelineSelection: async (moves, anchorTrackId, targetTrackId) => {
      const { project } = get();
      if (moves.length === 0) return { success: true };
      const tracks = project.timeline.tracks;
      const indexOf = (id: string) => tracks.findIndex((track) => track.id === id);
      const anchorIndex = indexOf(anchorTrackId);
      const targetIndex = indexOf(targetTrackId);
      if (anchorIndex < 0 || targetIndex < 0) return failure("TRACK_NOT_FOUND", "Destination track not found");
      const offset = targetIndex - anchorIndex;

      type Item = { itemId: string; startTime: number; resolved: NonNullable<ReturnType<typeof resolveTimelineItem>> };
      const rows = new Map<string, Item[]>();
      for (const move of moves) {
        const resolved = resolveTimelineItem(project, move.itemId);
        if (!resolved) return failure("INVALID_PARAMS", "Timeline item not found");
        const list = rows.get(resolved.trackId) ?? [];
        list.push({ itemId: move.itemId, startTime: Math.max(0, move.startTime), resolved });
        rows.set(resolved.trackId, list);
      }
      const ids = moves.map((move) => move.itemId);
      for (const track of tracks) {
        if (!rows.has(track.id)) continue;
        if (track.locked) return failure("TRACK_LOCKED", "Source track is locked");
        if (track.clips.some((clip) => ids.includes(clip.id) && clip.locks?.move)) {
          return failure("CLIP_LOCKED", "A selected clip is locked against moving");
        }
      }

      // each source row goes to the row at the same offset when that row takes all of its items
      const plans: Array<{ source: Track; sourceIndex: number; items: Item[]; destId?: string }> = [];
      const claimed = new Set<string>();
      for (const [sourceId, items] of rows) {
        const sourceIndex = indexOf(sourceId);
        const source = tracks[sourceIndex];
        if (!source) return failure("TRACK_NOT_FOUND", "Source track not found");
        const dest = tracks[sourceIndex + offset];
        const fits =
          dest !== undefined &&
          !dest.locked &&
          dest.type === source.type &&
          !claimed.has(dest.id) &&
          items.every((item) =>
            isTimelineIntervalClear(project, dest.id, item.startTime, item.resolved.duration, ids),
          );
        if (fits) claimed.add(dest.id);
        plans.push({ source, sourceIndex, items, destId: fits ? dest.id : undefined });
      }

      // the rest get one new row each, of their own kind, directly above the highest row of that
      // kind; made bottom row first so the upper source row's new row ends up above the lower one's
      const actions: Action[] = [];
      let simulated: Track[] = [...tracks];
      for (const plan of [...plans].filter((p) => !p.destId).sort((a, b) => b.sourceIndex - a.sourceIndex)) {
        const kind = plan.source.type;
        const row = createEmptyRow(simulated, kind, uuidv4());
        const position = topRowIndex(simulated, kind, simulated.findIndex((track) => track.id === plan.source.id));
        actions.push({
          type: "track/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { trackType: kind, name: row.name, trackId: row.id, position, mode: "standard" },
        });
        simulated = [...simulated.slice(0, position), row, ...simulated.slice(position)];
        plan.destId = row.id;
      }
      for (const plan of plans) {
        for (const item of plan.items) {
          const action = moveAction(item.itemId, item.resolved.kind, item.startTime, plan.destId as string);
          if (!action) {
            return failure("INVALID_PARAMS", "This timeline item cannot be moved from the timeline yet");
          }
          actions.push(action);
        }
      }
      return executePlacement(actions, "Move timeline items");
    },
  };
}

/** The action that puts one timeline item on `trackId` at `startTime`, by the item's kind. */
function moveAction(itemId: string, kind: string, startTime: number, trackId: string): Action | null {
  if (kind === "media") {
    return {
      type: "clip/move",
      id: uuidv4(),
      timestamp: Date.now(),
      params: { clipId: itemId, startTime, trackId },
    };
  }
  if (kind === "text" || kind === "shape" || kind === "svg" || kind === "sticker") {
    return {
      type: `${kind}/update`,
      id: uuidv4(),
      timestamp: Date.now(),
      params: { clipId: itemId, updates: { startTime, trackId } },
    };
  }
  return null;
}
