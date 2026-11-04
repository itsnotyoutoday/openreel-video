import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@openreel/core";
import {
  AutoSaveManager,
  serializeProjectForAutoSave,
} from "./auto-save";
import { createEmptyProject } from "../stores/project/project-helpers";

const project = (name: string): Project => ({
  ...createEmptyProject(name),
  id: "project-1",
});

describe("AutoSaveManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves the snapshot supplied with the dirty notification", async () => {
    vi.useFakeTimers();
    const manager = new AutoSaveManager({ debounceTime: 10, interval: 30_000 });
    const save = vi.fn().mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;

    manager.start(() => project("Initial"));
    manager.markDirty(project("Latest text edit"));
    await vi.advanceTimersByTimeAsync(10);

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Latest text edit" }),
      expect.any(String),
    );
    manager.stop();
  });

  it("saves content changes even when timestamps and item counts are identical", async () => {
    const manager = new AutoSaveManager();
    const save = vi.fn().mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;
    const initial = project("Initial");

    await manager.forceSave(initial);
    await manager.forceSave({ ...initial, name: "Renamed" });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0].name).toBe("Renamed");
  });

  it("serializes concurrent saves and retains edits arriving during a write", async () => {
    const manager = new AutoSaveManager();
    let finishFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => { finishFirst = resolve; });
    const save = vi.fn()
      .mockReturnValueOnce(firstWrite)
      .mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;
    const first = project("First edit");
    const latest = { ...first, name: "Edit made during save" };

    const savingFirst = manager.forceSave(first);
    const savingLatest = manager.forceSave(latest);
    expect(save).toHaveBeenCalledTimes(1);
    expect(manager.hasUnsavedChanges(latest)).toBe(true);
    finishFirst();
    await Promise.all([savingFirst, savingLatest]);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toBe(latest);
    expect(manager.hasUnsavedChanges(latest)).toBe(false);
  });

  it("keeps failed saves dirty and rejects explicit save attempts", async () => {
    const manager = new AutoSaveManager();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("Storage full"))
      .mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;
    const latest = project("Unsaved edit");
    const errorListener = vi.fn();
    manager.on("error", errorListener);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(manager.forceSave(latest)).rejects.toThrow("Storage full");
    expect(manager.hasUnsavedChanges(latest)).toBe(true);
    expect(errorListener).toHaveBeenCalledOnce();
    await manager.forceSave(latest);
    expect(manager.hasUnsavedChanges(latest)).toBe(false);
    consoleError.mockRestore();
  });

  it("honors disabled auto-save while allowing explicit saves", async () => {
    vi.useFakeTimers();
    const manager = new AutoSaveManager({ enabled: false, debounceTime: 10 });
    const save = vi.fn().mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;
    const latest = project("Manual save");
    manager.start(() => latest);
    manager.markDirty(latest);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).not.toHaveBeenCalled();

    await manager.forceSave(latest);
    expect(save).toHaveBeenCalledOnce();
    manager.stop();
  });

  it("flushes pending edits when the page is hidden before the debounce", async () => {
    vi.useFakeTimers();
    const manager = new AutoSaveManager({ debounceTime: 2_000 });
    const save = vi.fn().mockResolvedValue(undefined);
    (manager as unknown as { save(value: Project): Promise<void> }).save = save;
    let latest = project("Initial");
    manager.start(() => latest);
    await Promise.resolve();
    latest = { ...latest, name: "Last edit before switching tabs" };
    manager.markDirty();

    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toBe(latest);
    manager.stop();

    manager.markDirty({ ...latest, name: "Stopped session" });
    window.dispatchEvent(new Event("pagehide"));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledOnce();
    manager.stop();
  });

  it("strips runtime-only media payloads from serialized snapshots", () => {
    const source = project("Media project");
    const snapshot: Project = {
      ...source,
      mediaLibrary: {
        items: [
          {
            id: "media-1",
            name: "clip.mp4",
            type: "video",
            fileHandle: {} as FileSystemFileHandle,
            blob: new Blob(["video"], { type: "video/mp4" }),
            metadata: {
              duration: 5,
              width: 1920,
              height: 1080,
              frameRate: 30,
              codec: "h264",
              sampleRate: 48000,
              channels: 2,
              fileSize: 5,
            },
            thumbnailUrl: "blob:stale-thumbnail",
            waveformData: new Float32Array([0.1, 0.2]),
            filmstripThumbnails: [
              { timestamp: 0, url: "blob:stale-filmstrip" },
            ],
            sourceFile: {
              name: "clip.mp4",
              size: 5,
              lastModified: 123,
            },
          },
        ],
      },
    };

    const serialized = JSON.parse(serializeProjectForAutoSave(snapshot)) as {
      mediaLibrary: { items: Array<Record<string, unknown>> };
    };

    expect(serialized.mediaLibrary.items[0]).toMatchObject({
      blob: null,
      fileHandle: null,
      waveformData: null,
      thumbnailUrl: null,
      sourceFile: {
        name: "clip.mp4",
        size: 5,
        lastModified: 123,
      },
    });
    expect(serialized.mediaLibrary.items[0]).not.toHaveProperty(
      "filmstripThumbnails",
    );
  });
});
