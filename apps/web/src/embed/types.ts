import type {
  HostToolDefinition,
  ToolSchemaExtension,
} from "@openreel/agent";
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

/** A finished export handed to {@link EditorEvents.onExport}. */
export interface ExportedFile {
  readonly blob: Blob;
  readonly filename: string;
  readonly mimeType: string;
  /** The project as it was exported. */
  readonly project: Project;
}

/** One selected item on the timeline. */
export interface SelectedTimelineItem {
  readonly id: string;
  readonly trackId?: string;
  readonly type: string;
}

/**
 * Callbacks the editor invokes. All are optional, and an exception thrown by a
 * callback is logged and never breaks the editor.
 */
export interface EditorEvents {
  /** The project was saved through the storage provider. */
  onSave?(event: { project: Project; revision?: string }): void | Promise<void>;
  /** The project changed. Trailing-debounced (about 250 ms). */
  onChange?(event: { project: Project }): void;
  /**
   * An export finished. While this is set the editor hands the file to the
   * host instead of downloading it or opening a save dialog. The file is held
   * in memory, so exports above 1 GiB fail. A rejection fails the export.
   */
  onExport?(file: ExportedFile): void | Promise<void>;
  /** The timeline selection changed. */
  onSelectionChange?(selection: readonly SelectedTimelineItem[]): void;
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
  /** Callbacks for save, change, export and selection. */
  readonly events?: EditorEvents;
  /** Tools the in-editor agent may call; removed again on unmount. */
  readonly tools?: readonly HostToolDefinition[];
  /** Extra arguments for existing tools, keyed by tool name. */
  readonly toolExtensions?: Readonly<Record<string, ToolSchemaExtension>>;
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
  /** Register another agent tool; returns a function that removes it. */
  addTool(tool: HostToolDefinition): () => void;
  /** Remove an agent tool registered by this editor. */
  removeTool(name: string): boolean;
  /** Extend an existing tool's arguments; returns a function that undoes it. */
  extendTool(toolName: string, extension: ToolSchemaExtension): () => void;
  /** Import a file into the open project's media library. */
  importFile(file: File): Promise<void>;
  /** Fetch an asset from `media.resolve` and import it. */
  importAsset(assetId: string): Promise<void>;
}
