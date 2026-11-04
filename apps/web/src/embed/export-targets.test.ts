import { describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import {
  mapTargetPhase,
  runExportTarget,
  splitExportTargets,
  targetVideoSettings,
  type ExportTargetDeps,
} from "./export-targets";
import type { ExportedFile, HostExportTarget } from "./types";

const project = { name: "P", settings: { width: 1080, height: 1920, frameRate: 24 } } as unknown as Project;
const file: ExportedFile = { blob: new Blob(["x"]), filename: "p.mp4", mimeType: "video/mp4", project };

const target = (id: string, group?: string, run?: HostExportTarget["run"]): HostExportTarget => ({
  id,
  label: id,
  group,
  run: run ?? (async () => undefined),
});

function deps(): ExportTargetDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    begin: () => calls.push("begin"),
    render: vi.fn(async () => file),
    report: (p, label) => calls.push(`${label}:${p.toFixed(2)}`),
    complete: (m) => calls.push(`complete:${m ?? ""}`),
  };
}

describe("splitExportTargets", () => {
  it("uses the primary group, else the first target, and groups the rest", () => {
    const a = target("a", "other");
    const b = target("b", "primary");
    const c = target("c", "Social");
    const d = target("d");
    const split = splitExportTargets([a, b, c, d]);
    expect(split.primary).toBe(b);
    expect(split.groups).toEqual([
      { group: "other", items: [a, d] },
      { group: "Social", items: [c] },
    ]);
    expect(splitExportTargets([a, c]).primary).toBe(a);
    expect(splitExportTargets([])).toEqual({ primary: null, groups: [] });
  });
});

describe("targetVideoSettings", () => {
  it("fills unset fields from the project and maps fps to the frame rate", () => {
    expect(targetVideoSettings(undefined, project)).toMatchObject({
      ext: "mp4",
      settings: { width: 1080, height: 1920, frameRate: 24, format: "mp4", codec: "h264" },
    });
    expect(targetVideoSettings({ fps: 30, format: "webm", width: 720 }, project)).toMatchObject({
      ext: "webm",
      settings: { width: 720, height: 1920, frameRate: 30, codec: "vp9" },
    });
  });
});

describe("mapTargetPhase", () => {
  it("places the phases in one bar", () => {
    expect(mapTargetPhase("rendering", 1).progress).toBeCloseTo(0.7);
    expect(mapTargetPhase("uploading", 0.5)).toMatchObject({ label: "Uploading" });
    expect(mapTargetPhase("saving", 1).progress).toBe(1);
    expect(mapTargetPhase("verifying").progress).toBe(-1);
  });
});

describe("runExportTarget", () => {
  it("renders once, reports phases in order and completes with the host's message", async () => {
    const d = deps();
    const t = target("t", "primary", async ({ renderBlob, progress }) => {
      const first = await renderBlob();
      const second = await renderBlob();
      expect(second).toBe(first);
      progress({ phase: "uploading", fraction: 0.5 });
      progress({ phase: "saving" });
      return { message: "Saved to the Library" };
    });
    await runExportTarget(t, d, new AbortController().signal);
    expect(d.render).toHaveBeenCalledTimes(1);
    expect(d.calls).toEqual(["begin", "Uploading:0.81", "Saving:0.92", "complete:Saved to the Library"]);
  });

  it("ends as a cancellation when the signal aborts, without completing", async () => {
    const d = deps();
    const controller = new AbortController();
    const t = target("t", "primary", async ({ progress }) => {
      controller.abort();
      progress({ phase: "uploading", fraction: 1 });
    });
    await expect(runExportTarget(t, d, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(d.calls).toEqual(["begin"]);
  });

  it("passes a host failure through", async () => {
    const t = target("t", "primary", async () => {
      throw new Error("upload failed");
    });
    await expect(runExportTarget(t, deps(), new AbortController().signal)).rejects.toThrow("upload failed");
  });
});
