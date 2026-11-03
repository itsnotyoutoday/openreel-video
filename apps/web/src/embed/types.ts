import type {
  Project,
  ProjectSettings,
  SaveProjectResult,
  StorageProvider,
} from "@openreel/core";

/** An asset a host offers to the editor (for example from its own library). */
export interface HostMediaAsset {
  readonly id: string;
  readonly name: string;
  readonly type?: "video" | "audio" | "image";
  readonly durationSec?: number;
  readonly thumbnailUrl?: string;
}

/**
 * Where a host's own media lives. The editor never sees the host's storage
 * layout: it asks for a listing and for the bytes of one asset.
 */
export interface HostMediaSource {
  list?(query?: {
    readonly search?: string;
    readonly type?: HostMediaAsset["type"];
  }): Promise<readonly HostMediaAsset[]>;
  /** The bytes of an asset. A `File` keeps its name and type. */
  resolve(assetId: string): Promise<Blob>;
}

/** What a host passes to {@link mountEditor}. Every field is optional. */
export interface EditorHostOptions {
  /** Replaces the built-in IndexedDB storage. */
  readonly storage?: StorageProvider;
  /** The host's media library; see {@link MountedEditor.importAsset}. */
  readonly media?: HostMediaSource;
  /**
   * URL prefix the page is served under (for example `/tools/editor/`). Assets
   * the editor loads at runtime (workers, wasm, fonts) resolve against it.
   */
  readonly basePath?: string;
  /** Open this stored project on mount; otherwise a new project is created. */
  readonly projectId?: string;
  /** Settings for the new project when `projectId` is not given. */
  readonly newProject?: {
    readonly name?: string;
    readonly settings?: Partial<ProjectSettings>;
  };
}

/** The handle {@link mountEditor} returns. */
export interface MountedEditor {
  /** The element the editor renders into. */
  readonly root: HTMLElement;
  /** Remove the editor and release everything it registered. Idempotent. */
  unmount(): void;
  /** Open a project from the storage provider. */
  openProject(id: string): Promise<void>;
  /** Replace the open project with a new empty one. */
  createProject(options?: EditorHostOptions["newProject"]): void;
  /** Save the open project through the storage provider. */
  saveProject(): Promise<SaveProjectResult>;
  /** The open project, including title and graphics clips. */
  getProject(): Project;
  /** Import a file into the open project's media library. */
  importFile(file: File): Promise<void>;
  /** Fetch an asset from `media.resolve` and import it. */
  importAsset(assetId: string): Promise<void>;
}
