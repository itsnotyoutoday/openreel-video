import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryRecentStore,
  createMemorySnapshotStore,
  createMemoryStorageProvider,
  type MediaMetadata,
  type Project,
} from "@openreel/core";
import {
  getDefaultStorageProvider,
  getRecentStore,
  getSnapshotStore,
  getStorageProvider,
  hasHostStorageProvider,
  setStorageProvider,
} from "./storage-context";
import {
  forgetKnownRevisions,
  loadProjectFromProvider,
  saveProjectToProvider,
} from "./project-persistence";
import {
  deleteMediaBlob,
  loadMediaBlob,
  loadProjectMedia,
  saveMediaBlob,
} from "../media-storage";
import { AutoSaveManager } from "../auto-save";
import { projectManager } from "../project-manager";
import { createEmptyProject } from "../../stores/project/project-helpers";

const metadata: MediaMetadata = {
  duration: 1,
  width: 1,
  height: 1,
  frameRate: 30,
  codec: "h264",
  sampleRate: 48000,
  channels: 2,
  fileSize: 4,
};

function hostProvider() {
  const base = createMemoryStorageProvider();
  const snapshots = createMemorySnapshotStore();
  const recents = createMemoryRecentStore();
  return { base, snapshots, recents, provider: { ...base, snapshots, recents } };
}

afterEach(() => {
  setStorageProvider(null);
  forgetKnownRevisions();
});

describe("storage context", () => {
  it("uses the built-in IndexedDB provider when no host provider is installed", () => {
    expect(hasHostStorageProvider()).toBe(false);
    expect(getStorageProvider().snapshots).toBe(getDefaultStorageProvider().snapshots);
    expect(getSnapshotStore()).toBe(getDefaultStorageProvider().snapshots);
    expect(getRecentStore()).toBe(getDefaultStorageProvider().recents);
  });

  it("routes media calls through the host provider by media id", async () => {
    const { base, provider } = hostProvider();
    setStorageProvider(provider);
    expect(hasHostStorageProvider()).toBe(true);

    await saveMediaBlob("p1", "m1", new Blob(["abcd"]), metadata);
    expect(base.media.get("m1")?.projectId).toBe("p1");
    expect((await loadMediaBlob("m1"))?.size).toBe(4);
    expect((await loadProjectMedia("p1")).map((r) => r.id)).toEqual(["m1"]);
    await deleteMediaBlob("m1");
    expect(base.media.size).toBe(0);
  });

  it("falls back to the default snapshot and recent stores when the host omits them", () => {
    setStorageProvider(createMemoryStorageProvider());
    expect(getSnapshotStore()).toBe(getDefaultStorageProvider().snapshots);
    expect(getRecentStore()).toBe(getDefaultStorageProvider().recents);
  });

  it("writes auto-save snapshots to the host snapshot store", async () => {
    const { snapshots, provider } = hostProvider();
    setStorageProvider(provider);
    const manager = new AutoSaveManager();
    const project: Project = { ...createEmptyProject("Host"), id: "p1" };

    await manager.forceSave(project);

    const saved = await snapshots.list("p1");
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0].data).name).toBe("Host");
    const recovered = await manager.recover(saved[0].id);
    expect(recovered?.name).toBe("Host");
  });

  it("keeps the recent list in the host recent store", async () => {
    const { recents, provider } = hostProvider();
    setStorageProvider(provider);
    await projectManager.initialize();
    const project: Project = { ...createEmptyProject("Recent"), id: "p9" };

    await projectManager.addToRecent(project);

    expect((await recents.list()).map((r) => r.id)).toEqual(["p9"]);
    expect((await projectManager.getRecentProjects()).map((r) => r.name)).toEqual(["Recent"]);
  });

  it("saves through the host provider instead of a file picker", async () => {
    const { base, provider } = hostProvider();
    setStorageProvider(provider);
    await projectManager.initialize();
    const project: Project = { ...createEmptyProject("Saved"), id: "p2" };

    expect(await projectManager.saveProject(project)).toBe(true);

    expect(base.projects.get("p2")).toBeDefined();
  });
});

describe("project persistence", () => {
  it("strips media blobs on save and re-attaches them as Files on load", async () => {
    const { base, provider } = hostProvider();
    setStorageProvider(provider);
    const empty = createEmptyProject("Media");
    const project: Project = {
      ...empty,
      id: "p3",
      mediaLibrary: {
        items: [
          {
            id: "m1",
            name: "clip.mp4",
            type: "video",
            fileHandle: null,
            blob: new Blob(["abcd"], { type: "video/mp4" }),
            metadata,
            thumbnailUrl: null,
            waveformData: null,
          },
        ],
      },
    };
    await saveMediaBlob("p3", "m1", project.mediaLibrary.items[0].blob!, metadata);

    await saveProjectToProvider(project);
    const stored = JSON.parse(base.projects.get("p3")!.json) as Project;
    expect(stored.mediaLibrary.items[0].blob).toBeNull();

    const loaded = await loadProjectFromProvider("p3");
    const item = loaded!.mediaLibrary.items[0];
    expect(item.blob).toBeInstanceOf(File);
    expect((item.blob as File).name).toBe("clip.mp4");
    expect(item.isPlaceholder).toBeFalsy();
  });

  it("marks media the provider has no blob for as relinkable", async () => {
    const { provider } = hostProvider();
    setStorageProvider(provider);
    const project: Project = {
      ...createEmptyProject("Missing"),
      id: "p4",
      mediaLibrary: {
        items: [
          {
            id: "gone",
            name: "gone.mp4",
            type: "video",
            fileHandle: null,
            blob: null,
            metadata,
            thumbnailUrl: null,
            waveformData: null,
          },
        ],
      },
    };
    await saveProjectToProvider(project);
    const loaded = await loadProjectFromProvider("p4");
    expect(loaded!.mediaLibrary.items[0].isPlaceholder).toBe(true);
  });

  it("sends the last seen revision with the next save", async () => {
    const { provider } = hostProvider();
    setStorageProvider(provider);
    const project: Project = { ...createEmptyProject("Rev"), id: "p5" };
    await saveProjectToProvider(project);
    await saveProjectToProvider({ ...project, name: "Rev 2" });
    forgetKnownRevisions();
    // A fresh session without a known revision may overwrite; a stale one may not.
    await saveProjectToProvider({ ...project, name: "Rev 3" });
    await loadProjectFromProvider("p5");
    await provider.saveProject({ ...project, name: "Other writer" });
    await expect(
      saveProjectToProvider({ ...project, name: "Stale" }),
    ).rejects.toThrow(/changed/);
  });
});
