import type { Action } from "../types/actions";
import type { Project } from "../types/project";
import type { Clip, Track } from "../types/timeline";

/** A refused edit: the clip or row it touches is locked. */
export interface EditLockViolation {
  readonly code: "TRACK_LOCKED" | "CLIP_LOCKED";
  readonly clipId?: string;
  readonly trackId?: string;
  readonly lock: "track" | "move" | "trim";
  readonly message: string;
}

const EPS = 1e-6;

/** Edits that move a clip in time or between rows. */
const MOVES = new Set(["clip/move", "clip/slide", "clip/closeGapBefore", "clip/rippleRestore"]);
/** Edits that change which part of the source a clip shows, or how long it is. */
const TRIMS = new Set(["clip/trim", "clip/trimToPlayhead", "clip/slip", "clip/roll", "clip/setSpeed", "clip/split"]);
/** Timing edits the validator does not already refuse on a locked row. */
const ROW_GUARDED = new Set([
  "clip/slide",
  "clip/slip",
  "clip/roll",
  "clip/trimToPlayhead",
  "clip/restoreTiming",
  "clip/closeGapBefore",
  "clip/setSpeed",
  "clip/rippleRestore",
]);

function locate(project: Project, clipId: string): { clip: Clip; track: Track } | undefined {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return undefined;
}

const differs = (a: unknown, b: number): boolean => typeof a === "number" && Math.abs(a - b) > EPS;

function clipLabel(clip: Clip): string {
  const host = clip.metadata?.host as { label?: unknown } | undefined;
  return typeof host?.label === "string" && host.label ? `"${host.label}"` : "This clip";
}

const trackViolation = (track: Track, clipId?: string): EditLockViolation => ({
  code: "TRACK_LOCKED",
  trackId: track.id,
  clipId,
  lock: "track",
  message: `${track.name || "This row"} is locked`,
});

const clipViolation = (clip: Clip, lock: "move" | "trim"): EditLockViolation => ({
  code: "CLIP_LOCKED",
  clipId: clip.id,
  trackId: clip.trackId,
  lock,
  message: `${clipLabel(clip)} is locked against ${lock === "move" ? "moving" : "trimming"}`,
});

/**
 * The lock an edit would break: a locked row (`Track.locked`) or a clip's own
 * `locks.move` / `locks.trim`. Undo and redo never ask, and an action whose
 * params carry `hostEdit: true` (the embedding host changing its own clip, such
 * as a placeholder's length) is not refused by clip locks.
 */
export function editLockViolation(action: Action, project: Project): EditLockViolation | null {
  const params = (action.params ?? {}) as Record<string, unknown>;
  if (action.type === "clip/moveGroup") return groupMoveViolation(params, project);
  const clipId = params.clipId;
  if (typeof clipId !== "string") return null;
  const found = locate(project, clipId);
  if (!found) return null;
  const { clip, track } = found;

  if (track.locked && ROW_GUARDED.has(action.type)) return trackViolation(track, clip.id);
  if (params.hostEdit === true) return null;

  const locks = clip.locks;
  if (action.type === "clip/rippleDelete") {
    // the clips after it on the row shift left
    const moved = track.clips.find(
      (other) => other.id !== clip.id && other.locks?.move && other.startTime > clip.startTime + EPS,
    );
    return moved ? clipViolation(moved, "move") : null;
  }
  if (!locks?.move && !locks?.trim) return null;

  if (action.type === "clip/move") {
    const moves =
      differs(params.startTime, clip.startTime) ||
      (typeof params.trackId === "string" && params.trackId !== clip.trackId);
    return moves && locks.move ? clipViolation(clip, "move") : null;
  }
  if (action.type === "clip/restoreTiming") {
    if (locks.move && differs(params.startTime, clip.startTime)) return clipViolation(clip, "move");
    const trimmed =
      differs(params.duration, clip.duration) ||
      differs(params.inPoint, clip.inPoint) ||
      differs(params.outPoint, clip.outPoint);
    return locks.trim && trimmed ? clipViolation(clip, "trim") : null;
  }
  if (MOVES.has(action.type) && locks.move) return clipViolation(clip, "move");
  if (TRIMS.has(action.type) && locks.trim) return clipViolation(clip, "trim");
  return null;
}

function groupMoveViolation(params: Record<string, unknown>, project: Project): EditLockViolation | null {
  const groupId = params.groupId;
  if (typeof groupId !== "string") return null;
  const delta = typeof params.delta === "number" ? params.delta : 0;
  const rowChange = typeof params.targetTrackId === "string" && params.targetTrackId !== params.fromTrackId;
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.groupId !== groupId) continue;
      if (track.locked) return trackViolation(track, clip.id);
      if (clip.locks?.move && (Math.abs(delta) > EPS || rowChange)) return clipViolation(clip, "move");
    }
  }
  return null;
}
