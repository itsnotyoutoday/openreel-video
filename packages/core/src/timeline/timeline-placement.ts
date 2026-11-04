import type { Project, Track } from "../types";
import { getTrackItems, isStandardTrack } from "./timeline-items";

export type TimelinePlacementPolicy = "gap" | "stack-above";

export interface TimelinePlacementRequest {
  readonly targetTrackId: string;
  readonly startTime: number;
  readonly duration: number;
  readonly policy: TimelinePlacementPolicy;
  readonly excludeItemIds?: readonly string[];
  readonly newTrackId?: string;
  /**
   * The kind of row the item belongs on. When the target row is another kind
   * (a video dropped on the Text row) the item gets a NEW row of its own kind,
   * directly above the nearest row of that kind below the target.
   */
  readonly itemType?: Track["type"];
}

export type TimelinePlacementResult =
  | {
      readonly ok: true;
      readonly trackId: string;
      readonly startTime: number;
      /** A new row to make; `type` is the kind of the row it was made for (default video). */
      readonly createdTrack?: {
        readonly id: string;
        readonly position: number;
        readonly type?: Track["type"];
      };
    }
  | {
      readonly ok: false;
      readonly reason: "track-not-found" | "track-locked" | "overlap";
    };

const PLACEMENT_EPSILON = 0.0001;

export function timelineIntervalsOverlap(
  leftStart: number,
  leftDuration: number,
  rightStart: number,
  rightDuration: number,
): boolean {
  const leftEnd = leftStart + leftDuration;
  const rightEnd = rightStart + rightDuration;
  return (
    leftStart < rightEnd - PLACEMENT_EPSILON &&
    rightStart < leftEnd - PLACEMENT_EPSILON
  );
}

export function isTimelineIntervalClear(
  project: Project,
  trackId: string,
  startTime: number,
  duration: number,
  excludeItemIds: readonly string[] = [],
): boolean {
  const excluded = new Set(excludeItemIds);
  return getTrackItems(project, trackId).every(
    (item) =>
      excluded.has(item.id) ||
      !timelineIntervalsOverlap(
        startTime,
        duration,
        item.startTime,
        item.duration,
      ),
  );
}

/**
 * Where a new row of `type` goes: directly above the highest existing row of that
 * kind, so text and graphics rows stay on top and the new layer sits above the
 * older layers of its kind. With no such row, `fallback`.
 */
export function topRowIndex(tracks: readonly Track[], type: Track["type"], fallback: number): number {
  const at = tracks.findIndex((track) => track.type === type);
  return at >= 0 ? at : fallback;
}

/** Resolve the destination row without mutating the project. */
export function resolveTimelinePlacement(
  project: Project,
  request: TimelinePlacementRequest,
): TimelinePlacementResult {
  const targetIndex = project.timeline.tracks.findIndex(
    (track) => track.id === request.targetTrackId,
  );
  if (targetIndex < 0) return { ok: false, reason: "track-not-found" };

  const target = project.timeline.tracks[targetIndex];
  if (target.locked && request.policy === "gap") {
    return { ok: false, reason: "track-locked" };
  }

  const startTime = Math.max(0, request.startTime);
  if (request.itemType && request.itemType !== target.type && request.policy !== "gap") {
    const newTrackId = request.newTrackId ?? `track-${crypto.randomUUID()}`;
    return {
      ok: true,
      trackId: newTrackId,
      startTime,
      createdTrack: { id: newTrackId, position: topRowIndex(project.timeline.tracks, request.itemType, targetIndex), type: request.itemType },
    };
  }
  if (
    !target.locked &&
    isTimelineIntervalClear(
      project,
      target.id,
      startTime,
      request.duration,
      request.excludeItemIds,
    )
  ) {
    return { ok: true, trackId: target.id, startTime };
  }

  if (request.policy === "gap") return { ok: false, reason: "overlap" };

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const candidate = project.timeline.tracks[index];
    if (
      !candidate.locked &&
      isStandardTrack(candidate) &&
      // The track list labels rows by their type, so an item must not land on a
      // free row of another kind (a video on the "Text" row). This holds for every
      // project, including those that carry the universal-tracks capability.
      candidate.type === target.type &&
      isTimelineIntervalClear(
        project,
        candidate.id,
        startTime,
        request.duration,
        request.excludeItemIds,
      )
    ) {
      return { ok: true, trackId: candidate.id, startTime };
    }
  }

  const newTrackId = request.newTrackId ?? `track-${crypto.randomUUID()}`;
  return {
    ok: true,
    trackId: newTrackId,
    startTime,
    createdTrack: {
      id: newTrackId,
      position: topRowIndex(project.timeline.tracks, target.type, targetIndex),
      type: target.type,
    },
  };
}
