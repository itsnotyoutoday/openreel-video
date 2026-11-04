import { create } from "zustand";
import { getHostRuntime } from "./host-runtime";
import type { HostMarker } from "./types";

/**
 * Markers and comments the host shows on the ruler. They are the host's, not
 * the project's: never saved, never in undo history, never an unsaved change,
 * and untouched by `applyRemoteProject`.
 */
export const useHostMarkers = create<{ markers: readonly HostMarker[] }>(() => ({ markers: [] }));

/** Validate and store the host's markers (sorted by time). */
export function setHostMarkers(markers: readonly HostMarker[]): void {
  if (!Array.isArray(markers)) throw new Error("setMarkers expects an array of { id, time, label?, color? }");
  const clean = markers.map((marker) => {
    if (!marker || typeof marker.id !== "string" || typeof marker.time !== "number" || !Number.isFinite(marker.time)) {
      throw new Error("Every marker needs a string id and a finite time in seconds");
    }
    return {
      id: marker.id,
      time: Math.max(0, marker.time),
      ...(typeof marker.label === "string" ? { label: marker.label } : {}),
      ...(typeof marker.color === "string" ? { color: marker.color } : {}),
    };
  });
  useHostMarkers.setState({ markers: clean.sort((a, b) => a.time - b.time) });
}

/** Tell the host its marker was clicked; a failing callback is logged. */
export function notifyMarkerClick(marker: HostMarker): void {
  const onMarkerClick = getHostRuntime()?.options.events?.onMarkerClick;
  if (!onMarkerClick) return;
  try {
    onMarkerClick({ ...marker });
  } catch (error) {
    console.error("[OpenReel] events.onMarkerClick failed:", error);
  }
}
