import React, { useCallback, useMemo, useState } from "react";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { useHostRuntime } from "../../../embed/host-runtime";
import {
  readPreviewMode,
  resolvePreviewThumb,
  writePreviewMode,
  type EffectPreviewMode,
  type PreviewThumb,
} from "./effect-preview-media";

/**
 * The image the Effects and Transitions cards preview on, and the mode toggle.
 * Follows the selection reactively (the selected ids are a store selector, not
 * a stable getter) and, in clip mode, the playhead.
 */
export function useEffectPreviewMedia(): {
  thumb: PreviewThumb;
  mode: EffectPreviewMode;
  setMode: (mode: EffectPreviewMode) => void;
} {
  const [mode, setModeState] = useState<EffectPreviewMode>(readPreviewMode);
  const project = useProjectStore((s) => s.project);
  const selectedItems = useUIStore((s) => s.selectedItems);
  const playhead = useTimelineStore((s) => (mode === "clip" ? s.playheadPosition : 0));
  const host = useHostRuntime()?.options.effectPreviewMedia;

  const selectedClipIds = useMemo(
    () => selectedItems.filter((item) => item.type === "clip").map((item) => item.id),
    [selectedItems],
  );
  const thumb = useMemo(
    () => resolvePreviewThumb({ mode, project, selectedClipIds, playhead, host }),
    [mode, project, selectedClipIds, playhead, host],
  );
  const setMode = useCallback((next: EffectPreviewMode) => {
    setModeState(next);
    writePreviewMode(next);
  }, []);
  return { thumb, mode, setMode };
}

/** "Preview on: Sample | Selected clip". */
export const PreviewModeToggle: React.FC<{
  mode: EffectPreviewMode;
  onChange: (mode: EffectPreviewMode) => void;
}> = ({ mode, onChange }) => (
  <div className="mt-2 flex items-center gap-2 text-[10px] text-fg-muted" role="group" aria-label="Preview on">
    <span>Preview on:</span>
    {(["sample", "clip"] as const).map((value) => (
      <button
        key={value}
        type="button"
        aria-pressed={mode === value}
        onClick={() => onChange(value)}
        className={`h-5 rounded-md border px-2 text-[9px] font-semibold transition-colors ${
          mode === value
            ? "border-primary bg-primary/10 text-primary"
            : "border-border bg-bg-2 text-fg-3 hover:border-primary/50 hover:text-fg"
        }`}
      >
        {value === "sample" ? "Sample" : "Selected clip"}
      </button>
    ))}
  </div>
);
