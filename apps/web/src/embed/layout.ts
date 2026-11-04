import type { HostLayout } from "./types";

const PRESETS: Record<NonNullable<HostLayout["preset"]>, HostLayout> = {
  compact: {
    timelineHeight: "auto",
    minVisibleTracks: 4,
    trackHeight: 48,
    previewMinHeight: 200,
    panels: { mediaWidth: 320, inspectorWidth: 300 },
  },
  comfortable: {
    timelineHeight: "auto",
    minVisibleTracks: 5,
    trackHeight: 56,
    previewMinHeight: 260,
    panels: { mediaWidth: 400, inspectorWidth: 340 },
  },
};

/** Room above the tracks in the timeline panel: its toolbar, the ruler and the add-track row. */
export const TIMELINE_CHROME_PX = 112;

/**
 * The host's layout with its preset filled in (explicit fields win), or
 * `undefined` when the host passed none, so the editor keeps its own layout.
 */
export function resolveLayout(layout: HostLayout | undefined): HostLayout | undefined {
  if (!layout) return undefined;
  const base = layout.preset ? PRESETS[layout.preset] : undefined;
  return {
    ...base,
    ...layout,
    panels: { ...base?.panels, ...layout.panels },
  };
}

/** Padding of the editor root for `layout.insets` (undefined when none: the style stays upstream's). */
export function insetStyle(layout: HostLayout | undefined): { paddingTop?: number; paddingRight?: number; paddingBottom?: number; paddingLeft?: number } | undefined {
  const insets = layout?.insets;
  if (!insets) return undefined;
  return {
    ...(insets.top ? { paddingTop: insets.top } : {}),
    ...(insets.right ? { paddingRight: insets.right } : {}),
    ...(insets.bottom ? { paddingBottom: insets.bottom } : {}),
    ...(insets.left ? { paddingLeft: insets.left } : {}),
  };
}

/** The timeline row's CSS height for a resolved layout, or `undefined` to keep the editor's own. */
export function timelineRowSize(layout: HostLayout | undefined, trackCount = 0): string | undefined {
  if (!layout || layout.timelineHeight === undefined) return undefined;
  if (layout.timelineHeight === "auto") {
    const tracks = Math.max(1, layout.minVisibleTracks === "all" ? trackCount : (layout.minVisibleTracks ?? 4));
    // the rows are fitted (see fitTrackHeight): at least MIN_TRACK_HEIGHT each, at most the preferred height
    const rows = TIMELINE_CHROME_PX + tracks * (layout.trackHeight ?? 56);
    // never more than 60% of the editor, so a short window still has a stage
    return `min(${rows}px, 60%)`;
  }
  return `${layout.timelineHeight}%`;
}

/** Share of the editor's height the timeline may take with `timelineHeight: "auto"`. */
export const TIMELINE_MAX_SHARE = 0.6;
export const MIN_TRACK_HEIGHT = 40;

/**
 * The track row height that lets `trackCount` rows fit in the timeline's share
 * of an editor `editorHeight` px tall (for `minVisibleTracks: "all"`).
 */
export function fitTrackHeight(editorHeight: number, trackCount: number, preferred: number): number {
  if (trackCount <= 0) return preferred;
  const room = editorHeight * TIMELINE_MAX_SHARE - TIMELINE_CHROME_PX;
  return Math.max(MIN_TRACK_HEIGHT, Math.min(preferred, Math.floor(room / trackCount)));
}
