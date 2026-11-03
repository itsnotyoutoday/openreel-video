import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import { createDownloadWritable } from "./export-runner";
import { setHostRuntime, type HostRuntime } from "../embed/host-runtime";
import type { EditorHostOptions } from "../embed/types";

vi.mock("@openreel/core", () => ({
  getExportEngine: vi.fn(),
}));

const createObjectURL = vi.fn(() => "blob:x");
URL.createObjectURL = createObjectURL;
URL.revokeObjectURL = vi.fn();

const project = { name: "Exported" } as unknown as Project;

function runtime(options: EditorHostOptions): HostRuntime {
  return { options, root: document.createElement("div"), getProject: () => project };
}

async function bytesOf(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve([...new Uint8Array(reader.result as ArrayBuffer)]);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

afterEach(() => {
  setHostRuntime(null);
  createObjectURL.mockClear();
  vi.restoreAllMocks();
});

describe("host export delivery", () => {
  it("hands the finished file to events.onExport instead of downloading", async () => {
    const onExport = vi.fn();
    setHostRuntime(runtime({ events: { onExport } }));

    const writable = await createDownloadWritable("Clip.mp4", "video/mp4");
    await writable.write(new Uint8Array([1, 2, 3, 4]));
    await writable.seek(1);
    await writable.write(new Uint8Array([9]));
    await writable.close();

    expect(onExport).toHaveBeenCalledOnce();
    const file = onExport.mock.calls[0][0];
    expect(file.filename).toBe("Clip.mp4");
    expect(file.mimeType).toBe("video/mp4");
    expect(file.project).toBe(project);
    expect(file.blob.type).toBe("video/mp4");
    expect(await bytesOf(file.blob)).toEqual([1, 9, 3, 4]);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("fails the export when the host callback rejects", async () => {
    setHostRuntime(runtime({ events: { onExport: async () => { throw new Error("upload failed"); } } }));
    const writable = await createDownloadWritable("Clip.mp4", "video/mp4");
    await writable.write(new Uint8Array([1]));
    await expect(writable.close()).rejects.toThrow("upload failed");
  });

  it("an empty export is still an error and nothing is delivered", async () => {
    const onExport = vi.fn();
    setHostRuntime(runtime({ events: { onExport } }));
    const writable = await createDownloadWritable("Clip.mp4", "video/mp4");
    await expect(writable.close()).rejects.toThrow("empty");
    expect(onExport).not.toHaveBeenCalled();
  });

  it("without onExport (or without a host) the export downloads as before", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    for (const rt of [null, runtime({}), runtime({ events: { onSave: vi.fn() } })]) {
      setHostRuntime(rt);
      const writable = await createDownloadWritable("Clip.mp4", "video/mp4", { delivery: "download" });
      await writable.write(new Uint8Array([1, 2]));
      await writable.close();
    }
    expect(click).toHaveBeenCalledTimes(3);
  });
});
