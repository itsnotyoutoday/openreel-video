import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types";
import {
  StorageConflictError,
  createEngineStorageProvider,
  createMemoryStorageProvider,
} from "./storage-provider";
import { createMemoryRecentStore, createMemorySnapshotStore } from "./memory-stores";
import type { IStorageEngine, MediaRecord } from "./types";

const project = (id: string, name = "Test", modifiedAt = 1): Project =>
  ({ id, name, createdAt: 1, modifiedAt }) as unknown as Project;

const media = (id: string, projectId: string): MediaRecord => ({
  id,
  projectId,
  blob: new Blob(["data"]),
  metadata: {
    duration: 1,
    width: 1,
    height: 1,
    frameRate: 30,
    codec: "h264",
    sampleRate: 48000,
    channels: 2,
    fileSize: 4,
  },
});

describe("createMemoryStorageProvider", () => {
  it("round-trips a project and lists summaries newest first", async () => {
    const provider = createMemoryStorageProvider();
    await provider.saveProject(project("a", "Old", 1));
    await provider.saveProject(project("b", "New", 5));

    expect((await provider.listProjects()).map((p) => p.id)).toEqual(["b", "a"]);
    const loaded = await provider.loadProject("b");
    expect(loaded?.project.name).toBe("New");
    expect(loaded?.revision).toBe("1");
    expect(await provider.loadProject("missing")).toBeNull();
  });

  it("advances the revision and rejects a stale expectedRevision", async () => {
    const provider = createMemoryStorageProvider();
    const first = await provider.saveProject(project("a"));
    const second = await provider.saveProject(project("a", "Renamed"), {
      expectedRevision: first.revision,
    });
    expect(second.revision).toBe("2");

    await expect(
      provider.saveProject(project("a", "Stale"), { expectedRevision: first.revision }),
    ).rejects.toBeInstanceOf(StorageConflictError);
    expect((await provider.loadProject("a"))?.project.name).toBe("Renamed");
  });

  it("stores media by id and deleting a project removes its media", async () => {
    const provider = createMemoryStorageProvider();
    await provider.saveProject(project("a"));
    await provider.putMedia(media("m1", "a"));
    await provider.putMedia(media("m2", "other"));

    expect((await provider.getMedia("m1"))?.id).toBe("m1");
    expect((await provider.listMedia("a")).map((m) => m.id)).toEqual(["m1"]);

    await provider.deleteProject("a");
    expect(await provider.getMedia("m1")).toBeNull();
    expect(await provider.getMedia("m2")).not.toBeNull();
  });
});

describe("createEngineStorageProvider", () => {
  it("delegates each operation to the engine", async () => {
    const engine = {
      listProjects: vi.fn().mockResolvedValue([]),
      loadProject: vi.fn().mockResolvedValue(project("a")),
      saveProject: vi.fn().mockResolvedValue(undefined),
      deleteProject: vi.fn().mockResolvedValue(undefined),
      saveMedia: vi.fn().mockResolvedValue(undefined),
      loadMedia: vi.fn().mockResolvedValue(null),
      deleteMedia: vi.fn().mockResolvedValue(undefined),
      getMediaByProject: vi.fn().mockResolvedValue([]),
      saveFileHandle: vi.fn().mockResolvedValue(undefined),
      loadFileHandle: vi.fn().mockResolvedValue(null),
      saveDirectoryHandle: vi.fn().mockResolvedValue(undefined),
      loadDirectoryHandle: vi.fn().mockResolvedValue(null),
      getStorageUsage: vi.fn(),
      clearAllData: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as unknown as IStorageEngine;
    const provider = createEngineStorageProvider(engine);

    expect((await provider.loadProject("a"))?.project.id).toBe("a");
    await provider.saveProject(project("a"));
    await provider.putMedia(media("m", "a"));
    await provider.listMedia("a");
    await provider.handles!.loadFileHandle("x.mp4", 3);
    await provider.clearAll!();
    provider.dispose!();

    expect(engine.saveProject).toHaveBeenCalledOnce();
    expect(engine.saveMedia).toHaveBeenCalledOnce();
    expect(engine.getMediaByProject).toHaveBeenCalledWith("a");
    expect(engine.loadFileHandle).toHaveBeenCalledWith("x.mp4", 3);
    expect(engine.clearAllData).toHaveBeenCalledOnce();
    expect(engine.close).toHaveBeenCalledOnce();
  });
});

describe("memory snapshot and recent stores", () => {
  it("drops snapshot slots beyond retainSlots", async () => {
    const store = createMemorySnapshotStore();
    const record = (slot: number) => ({
      id: `p-slot-${slot}`,
      projectId: "p",
      projectName: "P",
      timestamp: slot,
      slot,
      data: "{}",
    });
    await store.put(record(0), 3);
    await store.put(record(1), 3);
    await store.put(record(2), 3);
    await store.put(record(0), 2);
    expect((await store.list("p")).map((r) => r.slot).sort()).toEqual([0, 1]);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it("lists recents newest first", async () => {
    const store = createMemoryRecentStore();
    await store.put({ id: "a", name: "A", lastOpened: 1 });
    await store.put({ id: "b", name: "B", lastOpened: 2 });
    expect((await store.list()).map((r) => r.id)).toEqual(["b", "a"]);
    await store.remove("b");
    expect(await store.get("b")).toBeNull();
  });
});
