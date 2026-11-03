import type { Project } from "../types";
import type {
  IStorageEngine,
  MediaRecord,
  ProjectSummary,
  StorageUsage,
} from "./types";

/**
 * A project read back from a provider, with the opaque revision it was read at.
 */
export interface LoadedProject {
  readonly project: Project;
  /** Opaque token; passed back as `expectedRevision` for optimistic concurrency. */
  readonly revision?: string;
}

export interface SaveProjectOptions {
  /** The revision the caller last saw. A provider may reject a stale save. */
  readonly expectedRevision?: string;
}

export interface SaveProjectResult {
  /** The revision of the stored copy after this save. */
  readonly revision?: string;
}

/**
 * Thrown by a provider when `expectedRevision` is stale. The editor surfaces it
 * as a failed save and keeps the local copy.
 */
export class StorageConflictError extends Error {
  readonly code = "REVISION_CONFLICT";
  constructor(
    message = "The stored project changed since it was loaded",
    readonly currentRevision?: string,
  ) {
    super(message);
    this.name = "StorageConflictError";
  }
}

/** One rotating crash-recovery snapshot of a project. */
export interface SnapshotRecord {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly timestamp: number;
  readonly slot: number;
  /** Serialized project JSON with binary media stripped. */
  readonly data: string;
}

/** Rotating crash-recovery snapshots (the editor's local working copy). */
export interface SnapshotStore {
  /** Optional warm-up (open a connection). A rejection disables snapshots. */
  init?(): Promise<void>;
  /**
   * Store a snapshot. The store must also drop this project's snapshots whose
   * slot is `>= retainSlots`.
   */
  put(record: SnapshotRecord, retainSlots: number): Promise<void>;
  /** Every snapshot, or only those of `projectId`. Order is not significant. */
  list(projectId?: string): Promise<SnapshotRecord[]>;
  get(id: string): Promise<SnapshotRecord | null>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  close?(): void;
}

export interface NativeFileRef {
  readonly kind: "native";
  readonly path: string;
}

/** An entry of the "recent projects" list. */
export interface RecentProjectRecord {
  id: string;
  name: string;
  lastOpened: number;
  thumbnail?: string;
  fileHandle?: FileSystemFileHandle | NativeFileRef;
  duration?: number;
  trackCount?: number;
}

export interface RecentProjectStore {
  /** Entries ordered by `lastOpened`, newest first. */
  list(): Promise<RecentProjectRecord[]>;
  put(entry: RecentProjectRecord): Promise<void>;
  get(id: string): Promise<RecentProjectRecord | null>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  /** Optional warm-up. */
  init?(): Promise<void>;
  close?(): void;
}

/** Browser file handles that let a local desktop file be found again. */
export interface FileHandleStore {
  saveFileHandle(name: string, size: number, handle: FileSystemFileHandle): Promise<void>;
  loadFileHandle(name: string, size: number): Promise<FileSystemFileHandle | null>;
  saveDirectoryHandle(projectId: string, handle: FileSystemDirectoryHandle): Promise<void>;
  loadDirectoryHandle(
    projectId: string,
  ): Promise<{ handle: FileSystemDirectoryHandle; folderName: string } | null>;
}

/**
 * Where the editor keeps its data. The default implementation is the browser's
 * IndexedDB; a host replaces it to make its own server the system of record.
 *
 * Contract:
 * - Projects are plain JSON. Media items inside a saved project carry
 *   `blob: null`, no file handle, no waveform and no object-URL thumbnails;
 *   binary media travels separately through the media methods, keyed by
 *   `MediaRecord.id` (the project's media item id).
 * - `getMedia`/`listMedia` return a `Blob` (a `File` is fine). The editor
 *   re-attaches it to the media item when a project is opened.
 * - Methods reject on failure; the editor reports the failure and keeps the
 *   in-memory copy.
 */
export interface StorageProvider {
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<LoadedProject | null>;
  saveProject(
    project: Project,
    options?: SaveProjectOptions,
  ): Promise<SaveProjectResult>;
  deleteProject(id: string): Promise<void>;

  putMedia(record: MediaRecord): Promise<void>;
  getMedia(mediaId: string): Promise<MediaRecord | null>;
  deleteMedia(mediaId: string): Promise<void>;
  listMedia(projectId: string): Promise<MediaRecord[]>;

  /**
   * Optional parts. A part left out falls back to the editor's default local
   * (IndexedDB) implementation, which is the right choice for a local working
   * copy next to a server-side system of record.
   */
  snapshots?: SnapshotStore;
  recents?: RecentProjectStore;
  handles?: FileHandleStore;
  getUsage?(): Promise<StorageUsage>;
  /** Remove everything the editor stored (Settings > Clear data). */
  clearAll?(): Promise<void>;
  /** Called when the editor that owns this provider unmounts. */
  dispose?(): void | Promise<void>;
}

/**
 * Adapt an {@link IStorageEngine} (the IndexedDB engine) to a provider. This is
 * the default behaviour of the standalone app.
 */
export function createEngineStorageProvider(
  engine: IStorageEngine,
): StorageProvider {
  return {
    listProjects: () => engine.listProjects(),
    loadProject: async (id) => {
      const project = await engine.loadProject(id);
      return project ? { project } : null;
    },
    saveProject: async (project) => {
      await engine.saveProject(project);
      return {};
    },
    deleteProject: (id) => engine.deleteProject(id),
    putMedia: (record) => engine.saveMedia(record),
    getMedia: (mediaId) => engine.loadMedia(mediaId),
    deleteMedia: (mediaId) => engine.deleteMedia(mediaId),
    listMedia: (projectId) => engine.getMediaByProject(projectId),
    handles: {
      saveFileHandle: (name, size, handle) =>
        engine.saveFileHandle(name, size, handle),
      loadFileHandle: (name, size) => engine.loadFileHandle(name, size),
      saveDirectoryHandle: (projectId, handle) =>
        engine.saveDirectoryHandle(projectId, handle),
      loadDirectoryHandle: (projectId) => engine.loadDirectoryHandle(projectId),
    },
    getUsage: () => engine.getStorageUsage(),
    clearAll: () => engine.clearAllData(),
    dispose: () => engine.close(),
  };
}

/**
 * A provider that keeps everything in memory. Useful for tests, previews and as
 * a reference implementation of the contract. Revisions are a counter per
 * project, and a stale `expectedRevision` throws {@link StorageConflictError}.
 */
export function createMemoryStorageProvider(): StorageProvider & {
  readonly projects: ReadonlyMap<string, { json: string; revision: number }>;
  readonly media: ReadonlyMap<string, MediaRecord>;
} {
  const projects = new Map<string, { json: string; revision: number }>();
  const media = new Map<string, MediaRecord>();

  return {
    projects,
    media,
    async listProjects() {
      return [...projects.values()]
        .map(({ json }) => JSON.parse(json) as Project)
        .map((p) => ({
          id: p.id,
          name: p.name,
          createdAt: p.createdAt,
          modifiedAt: p.modifiedAt,
        }))
        .sort((a, b) => b.modifiedAt - a.modifiedAt);
    },
    async loadProject(id) {
      const entry = projects.get(id);
      if (!entry) return null;
      return {
        project: JSON.parse(entry.json) as Project,
        revision: String(entry.revision),
      };
    },
    async saveProject(project, options) {
      const current = projects.get(project.id);
      if (
        options?.expectedRevision !== undefined &&
        current &&
        String(current.revision) !== options.expectedRevision
      ) {
        throw new StorageConflictError(undefined, String(current.revision));
      }
      const revision = (current?.revision ?? 0) + 1;
      projects.set(project.id, { json: JSON.stringify(project), revision });
      return { revision: String(revision) };
    },
    async deleteProject(id) {
      projects.delete(id);
      for (const [mediaId, record] of media) {
        if (record.projectId === id) media.delete(mediaId);
      }
    },
    async putMedia(record) {
      media.set(record.id, record);
    },
    async getMedia(mediaId) {
      return media.get(mediaId) ?? null;
    },
    async deleteMedia(mediaId) {
      media.delete(mediaId);
    },
    async listMedia(projectId) {
      return [...media.values()].filter((m) => m.projectId === projectId);
    },
    async getUsage() {
      let used = 0;
      for (const record of media.values()) used += record.blob.size;
      return { used, quota: Number.MAX_SAFE_INTEGER, projects: projects.size, mediaItems: media.size };
    },
    async clearAll() {
      projects.clear();
      media.clear();
    },
  };
}
