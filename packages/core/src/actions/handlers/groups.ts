import type { Action, ValidationResult } from "../../types/actions";
import type { ClipGroup, Project } from "../../types/project";
import type { Clip, Track } from "../../types/timeline";
import { createEmptyRow } from "../../timeline/row-placement";
import { timelineIntervalsOverlap, topRowIndex } from "../../timeline/timeline-placement";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";
import { editSnapshot } from "./edit-snapshot";
import { findClip, makeClipFieldHandler, patchClip } from "./clip-helpers";

/** A refused edit to a locked group: which group and which kind of edit. */
export interface LockedGroupViolation {
  readonly groupId: string;
  readonly action: "move" | "split" | "trim" | "delete" | "retime";
  readonly message: string;
}

const RETIME = new Set([
  "clip/slip",
  "clip/slide",
  "clip/roll",
  "clip/trimToPlayhead",
  "clip/restoreTiming",
  "clip/closeGapBefore",
  "clip/setSpeed",
  "clip/rippleRestore",
]);

function lockedGroupOf(project: Project, clip: Clip | undefined): ClipGroup | undefined {
  if (!clip?.groupId) return undefined;
  return project.clipGroups?.find((group) => group.id === clip.groupId && group.locked);
}

function members(project: Project, groupId: string): Clip[] {
  return project.timeline.tracks
    .flatMap((track) => track.clips)
    .filter((clip) => clip.groupId === groupId)
    .sort((a, b) => a.startTime - b.startTime);
}

const EPS = 1e-6;

/**
 * Edits that would break a locked group apart: moving, splitting, deleting or
 * retiming one member, or trimming an inside boundary. Moving or removing the
 * whole group goes through `clip/moveGroup` and `clip/removeGroup`; trimming the
 * group's outer start or end, and per-clip effects, volume and colour, stay allowed.
 */
export function lockedGroupViolation(action: Action, project: Project): LockedGroupViolation | null {
  const params = action.params as { clipId?: string; inPoint?: number; outPoint?: number };
  if (typeof params?.clipId !== "string") return null;
  const clip = findClip(project, params.clipId);
  const group = lockedGroupOf(project, clip);
  if (!clip || !group) return null;
  const violation = (kind: LockedGroupViolation["action"]): LockedGroupViolation => ({
    groupId: group.id,
    action: kind,
    message: `"${group.label ?? "This scene"}" is locked; ${kind === "delete" ? "removing" : kind === "split" ? "splitting" : kind === "trim" ? "trimming inside" : kind === "move" ? "moving part of" : "retiming part of"} it would break the chain`,
  });
  switch (action.type) {
    case "clip/move":
      return violation("move");
    case "clip/split":
      return violation("split");
    case "clip/remove":
    case "clip/rippleDelete":
      return violation("delete");
    case "clip/trim": {
      const all = members(project, group.id);
      const first = all[0]?.id === clip.id;
      const last = all.at(-1)?.id === clip.id;
      const startChanged = params.inPoint !== undefined && Math.abs(params.inPoint - clip.inPoint) > EPS;
      const endChanged = params.outPoint !== undefined && Math.abs(params.outPoint - clip.outPoint) > EPS;
      if ((startChanged && !first) || (endChanged && !last)) return violation("trim");
      return null;
    }
    default:
      return RETIME.has(action.type) ? violation("retime") : null;
  }
}

const clipSetGroup = makeClipFieldHandler({
  type: "clip/setGroup",
  paramKey: "groupId",
  field: "groupId" as never,
  validateValue: (value) =>
    value === undefined || value === null || typeof value === "string" ? null : "groupId must be a string",
});

const projectSetClipGroups: ActionHandler = {
  type: "project/setClipGroups",
  validate(action: Action): ValidationResult {
    const groups = (action.params as { groups?: unknown }).groups;
    const bad =
      !Array.isArray(groups) ||
      groups.some((g) => !g || typeof g !== "object" || typeof (g as ClipGroup).id !== "string");
    return bad
      ? { valid: false, errors: [{ code: "INVALID_PARAMS", message: "groups must be an array of { id, locked, ... }" }] }
      : { valid: true, errors: [] };
  },
  apply(action: Action, project: Project): void {
    const groups = (action.params as { groups: ClipGroup[] }).groups;
    // groups that list their members assign them: membership is replaced for those groups
    for (const group of groups) {
      if (!Array.isArray(group.clipIds)) continue;
      const wanted = new Set(group.clipIds);
      for (const clip of project.timeline.tracks.flatMap((track) => track.clips)) {
        if (wanted.has(clip.id)) patchClip(project, clip.id, { groupId: group.id });
        else if (clip.groupId === group.id) patchClip(project, clip.id, { groupId: undefined });
      }
    }
    (project as { clipGroups?: ClipGroup[] }).clipGroups = groups.map(({ clipIds: _members, ...group }) => group);
  },
  invert(action: Action, before: Project): Action | null {
    const groups = (action.params as { groups: ClipGroup[] }).groups;
    if (groups.some((group) => Array.isArray(group.clipIds))) {
      // membership changed too: restore the whole edit, not just the group list
      return {
        type: "project/applyEditSnapshot",
        id: `inverse-${action.id}`,
        timestamp: Date.now(),
        params: { snapshot: editSnapshot(before) },
      };
    }
    return {
      type: "project/setClipGroups",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { groups: before.clipGroups ?? [] },
    };
  },
};

function groupExists(project: Project, groupId: unknown): ValidationResult {
  return typeof groupId === "string" && members(project, groupId).length > 0
    ? { valid: true, errors: [] }
    : { valid: false, errors: [{ code: "CLIP_NOT_FOUND", message: "No clips in that group" }] };
}

/**
 * Move every clip of a group by `delta` seconds, as one unit. Each row's members
 * stay together: they keep their row when the new span is free there, otherwise
 * ALL of that row's members go to one new row of the same kind directly above it,
 * never onto a free row of another kind. `fromTrackId` + `targetTrackId` also move
 * that row's members to another row of the same kind (a vertical drag).
 */
const moveGroup: ActionHandler = {
  type: "clip/moveGroup",
  validate(action, project) {
    const { groupId, delta, targetTrackId } = action.params as { groupId?: string; delta?: number; targetTrackId?: string };
    const base = groupExists(project, groupId);
    if (!base.valid) return base;
    if (typeof delta !== "number" || !Number.isFinite(delta)) {
      return { valid: false, errors: [{ code: "INVALID_PARAMS", message: "delta must be a number" }] };
    }
    if (targetTrackId !== undefined && !project.timeline.tracks.some((track) => track.id === targetTrackId)) {
      return { valid: false, errors: [{ code: "TRACK_NOT_FOUND", message: "No such target row" }] };
    }
    const first = members(project, groupId as string)[0];
    return first.startTime + delta < -EPS
      ? { valid: false, errors: [{ code: "OUT_OF_BOUNDS", message: "The group would start before 0" }] }
      : base;
  },
  apply(action, project) {
    const { groupId, delta, fromTrackId, targetTrackId } = action.params as {
      groupId: string;
      delta: number;
      fromTrackId?: string;
      targetTrackId?: string;
    };
    const group = members(project, groupId);
    const ids = new Set(group.map((clip) => clip.id));
    const timeline = project.timeline as { tracks: Track[] };
    const sources = [...new Set(group.map((clip) => clip.trackId))];
    for (const sourceId of sources) {
      const source = timeline.tracks.find((track) => track.id === sourceId);
      if (!source) continue;
      const moved = group.filter((clip) => clip.trackId === sourceId);
      let dest = source;
      // dropped on a row of another kind (Text, Audio): a new row of the group's own kind
      let wrongKind = false;
      if (sourceId === fromTrackId && targetTrackId && targetTrackId !== sourceId) {
        const target = timeline.tracks.find((track) => track.id === targetTrackId);
        if (target && !target.locked && target.type === source.type) dest = target;
        else if (target && target.type !== source.type) wrongKind = true;
      }
      const fits = !wrongKind && moved.every((clip) =>
        dest.clips.every(
          (other) =>
            ids.has(other.id) ||
            !timelineIntervalsOverlap(Math.max(0, clip.startTime + delta), clip.duration, other.startTime, other.duration),
        ),
      );
      let destId = dest.id;
      if (!fits || dest.locked) {
        const row = createEmptyRow(timeline.tracks, dest.type);
        const at = topRowIndex(timeline.tracks, dest.type, timeline.tracks.findIndex((track) => track.id === dest.id));
        timeline.tracks = [...timeline.tracks.slice(0, at), row, ...timeline.tracks.slice(at)];
        destId = row.id;
      }
      for (const clip of moved) {
        patchClip(project, clip.id, { startTime: Math.max(0, clip.startTime + delta), trackId: destId });
      }
      // the clips travel with their row: move them between the rows' clip lists
      if (destId !== sourceId) {
        const movedIds = new Set(moved.map((clip) => clip.id));
        const pulled = (timeline.tracks.find((track) => track.id === sourceId)?.clips ?? []).filter((c) => movedIds.has(c.id));
        timeline.tracks = timeline.tracks.map((track) => {
          if (track.id === sourceId) return { ...track, clips: track.clips.filter((c) => !movedIds.has(c.id)) };
          if (track.id === destId) return { ...track, clips: [...track.clips, ...pulled] };
          return track;
        });
      }
    }
  },
  invert(action, before) {
    // rows may have been made and clips moved between rows: restore the whole edit
    return {
      type: "project/applyEditSnapshot",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { snapshot: editSnapshot(before) },
    };
  },
};

/** Remove every clip of a group (the group itself stays defined, empty). */
const removeGroup: ActionHandler = {
  type: "clip/removeGroup",
  validate: (action, project) => groupExists(project, (action.params as { groupId?: string }).groupId),
  apply(action, project) {
    const { groupId } = action.params as { groupId: string };
    const ids = new Set(members(project, groupId).map((clip) => clip.id));
    (project.timeline as { tracks: Project["timeline"]["tracks"] }).tracks = project.timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => !ids.has(clip.id)),
    }));
  },
  invert(action, before) {
    return {
      type: "project/applyEditSnapshot",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { snapshot: editSnapshot(before) },
    };
  },
};

registerActionHandler(clipSetGroup);
registerActionHandler(projectSetClipGroups);
registerActionHandler(moveGroup);
registerActionHandler(removeGroup);
