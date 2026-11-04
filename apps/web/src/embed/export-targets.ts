import type { Project, VideoExportSettings } from "@openreel/core";
import type { ExportedFile, HostExportSettings, HostExportTarget } from "./types";

/** The primary target and the rest, grouped for the menu (first-seen group order). */
export function splitExportTargets(targets: readonly HostExportTarget[]): {
  primary: HostExportTarget | null;
  groups: Array<{ group: string; items: HostExportTarget[] }>;
} {
  if (targets.length === 0) return { primary: null, groups: [] };
  const primary = targets.find((t) => t.group === "primary") ?? targets[0];
  const groups = new Map<string, HostExportTarget[]>();
  for (const target of targets) {
    if (target === primary) continue;
    const key = !target.group || target.group === "primary" ? "other" : target.group;
    groups.set(key, [...(groups.get(key) ?? []), target]);
  }
  return { primary, groups: [...groups].map(([group, items]) => ({ group, items })) };
}

/** Engine settings for a target; unset fields come from the project. */
export function targetVideoSettings(
  settings: HostExportSettings | undefined,
  project: Project,
): { settings: Partial<VideoExportSettings>; ext: "mp4" | "webm" | "mov" } {
  const format = settings?.format ?? "mp4";
  const codec = settings?.codec ?? (format === "webm" ? "vp9" : "h264");
  return {
    ext: format,
    settings: {
      width: settings?.width ?? project.settings.width,
      height: settings?.height ?? project.settings.height,
      frameRate: settings?.fps ?? project.settings.frameRate,
      format,
      codec,
      bitrate: settings?.bitrate ?? 12000,
      quality: settings?.quality ?? 85,
    },
  };
}

// Rendering is most of the work; uploading and saving share the rest.
const PHASE_RANGE: Record<string, readonly [number, number, string]> = {
  rendering: [0, 0.7, "Rendering"],
  uploading: [0.7, 0.92, "Uploading"],
  saving: [0.92, 1, "Saving"],
};

/** Overall progress (0..1) and the label for a phase report from the host. */
export function mapTargetPhase(
  phase: string,
  fraction?: number,
): { progress: number; label: string } {
  const range = PHASE_RANGE[phase.toLowerCase()];
  const f = Math.min(1, Math.max(0, fraction ?? 0));
  if (!range) return { progress: -1, label: phase.charAt(0).toUpperCase() + phase.slice(1) };
  return { progress: range[0] + (range[1] - range[0]) * f, label: range[2] };
}

export interface ExportTargetDeps {
  /** Mark an export as started (overlay and cancel button appear). */
  begin(): void;
  /** Render the timeline with the target's settings (progress 0..0.7 is the renderer's). */
  render(target: HostExportTarget): Promise<ExportedFile>;
  report(progress01: number, label: string): void;
  /** The target finished; `message` replaces the default "Saved!". */
  complete(message?: string): void;
}

/**
 * Run a host export target: phases and progress reach the overlay, `renderBlob`
 * renders at most once, and an aborted signal ends the run as a cancellation.
 */
export async function runExportTarget(
  target: HostExportTarget,
  deps: ExportTargetDeps,
  signal: AbortSignal,
): Promise<void> {
  deps.begin();
  let rendered: Promise<ExportedFile> | null = null;
  let last = 0;
  const result = await target.run({
    renderBlob: () => (rendered ??= deps.render(target)),
    progress: ({ phase, fraction }) => {
      if (signal.aborted) return;
      const mapped = mapTargetPhase(phase, fraction);
      last = mapped.progress < 0 ? last : Math.max(last, mapped.progress);
      deps.report(last, mapped.label);
    },
    signal,
  });
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
  deps.complete(result && typeof result === "object" ? result.message : undefined);
}
