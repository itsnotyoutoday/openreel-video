import type { ClipLocks } from "../../types/timeline";
import { registerActionHandler } from "../registry";
import { makeClipFieldHandler } from "./clip-helpers";

/** `clip/setLocks { clipId, locks?: { move?, trim? } }`: replaces the clip's locks (undefined clears them). Undoable. */
const clipSetLocks = makeClipFieldHandler({
  type: "clip/setLocks",
  paramKey: "locks",
  field: "locks",
  transform: (value) => {
    if (!value) return undefined;
    const { move, trim } = value as ClipLocks;
    return move || trim ? { ...(move ? { move: true } : {}), ...(trim ? { trim: true } : {}) } : undefined;
  },
  validateValue: (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "object") return "locks must be { move?: boolean, trim?: boolean }";
    const { move, trim } = value as Record<string, unknown>;
    return (move === undefined || typeof move === "boolean") && (trim === undefined || typeof trim === "boolean")
      ? null
      : "locks must be { move?: boolean, trim?: boolean }";
  },
});

registerActionHandler(clipSetLocks);
