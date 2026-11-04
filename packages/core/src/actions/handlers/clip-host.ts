import type { Action, ValidationResult } from "../../types/actions";
import type { Project } from "../../types/project";
import type { ClipMetadata } from "../../types/timeline";
import { registerActionHandler } from "../registry";
import type { ActionHandler } from "../registry";
import { findClip, makeClipFieldHandler, patchClip } from "./clip-helpers";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Replaces a clip's whole `metadata` object (undefined clears it). */
const clipSetMetadata = makeClipFieldHandler({
  type: "clip/setMetadata",
  paramKey: "metadata",
  field: "metadata",
  validateValue: (value) =>
    value === undefined || isRecord(value) ? null : "metadata must be an object",
});

/**
 * Points a clip at other media while keeping its place on the timeline:
 * position, track, transitions (they live on the track) and metadata stay.
 * Used to swap a placeholder for the real clip.
 */
const clipReplaceMedia: ActionHandler = {
  type: "clip/replaceMedia",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as Record<string, unknown>;
    const errors = [];
    if (typeof params.clipId !== "string" || !findClip(project, params.clipId)) {
      errors.push({ code: "CLIP_NOT_FOUND", message: "Clip not found" });
    }
    const media = project.mediaLibrary.items.find((item) => item.id === params.mediaId);
    if (typeof params.mediaId !== "string" || !media) {
      errors.push({ code: "INVALID_PARAMS", message: "mediaId must name a media item" });
    }
    for (const field of ["duration", "inPoint", "outPoint"] as const) {
      const value = params[field];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        errors.push({ code: "INVALID_PARAMS", message: `${field} must be a finite non-negative number` });
      }
    }
    if (params.metadata !== undefined && !isRecord(params.metadata)) {
      errors.push({ code: "INVALID_PARAMS", message: "metadata must be an object" });
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const params = action.params as {
      clipId: string;
      mediaId: string;
      duration?: number;
      inPoint?: number;
      outPoint?: number;
      metadata?: ClipMetadata;
      clearMetadata?: boolean;
    };
    const clip = findClip(project, params.clipId);
    if (!clip) return;
    const duration = params.duration ?? clip.duration;
    patchClip(project, params.clipId, {
      mediaId: params.mediaId,
      duration,
      inPoint: params.inPoint ?? 0,
      outPoint: params.outPoint ?? (params.inPoint ?? 0) + duration,
      metadata: params.clearMetadata ? undefined : (params.metadata ?? clip.metadata),
    });
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const clip = findClip(projectBefore, (action.params as { clipId: string }).clipId);
    if (!clip) return null;
    return {
      type: "clip/replaceMedia",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: {
        clipId: clip.id,
        mediaId: clip.mediaId,
        duration: clip.duration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        metadata: clip.metadata,
        clearMetadata: clip.metadata === undefined,
      },
    };
  },
};

registerActionHandler(clipSetMetadata);
registerActionHandler(clipReplaceMedia);
