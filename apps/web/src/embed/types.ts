import type { EditorBridge } from "./bridge";
import type { EditorTheme } from "./theme";
import type { HostAiOptions } from "./ai-types";
import type {
  HostToolDefinition,
  ToolSchemaExtension,
} from "@openreel/agent";
import type {
  ClipGroup,
  Project,
  ProjectSettings,
  SaveProjectResult,
  StorageProvider,
} from "@openreel/core";

/** A reference to media in the host's library, resolved with `media.resolve(assetId)`. */
export interface HostMediaRef {
  readonly assetId: string;
  /** File name to give the imported media. */
  readonly name?: string;
}

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
  /**
   * An export is starting while the timeline still holds placeholder clips.
   * They export as their still or card for their duration; this lets the host
   * warn the person.
   */
  onExportWarning?(placeholdersCount: number): void;
  /** A message in the editor's AI chat: the person's request, then the assistant's answer. */
  onAiMessage?(event: { role: "user" | "assistant"; text: string }): void;
  /** The editor's AI started a tool (`phase: "start"`) or finished it (`"end"`, with `ok`). */
  onToolCall?(event: { name: string; phase: "start" | "end"; ok?: boolean }): void;
  /** The playhead moved. Seconds; throttled to about 100 ms. */
  onPlayheadChange?(seconds: number): void;
  /** Undo/redo availability or the history changed. */
  onHistoryChange?(history: { canUndo: boolean; canRedo: boolean }): void;
  /**
   * `true` once there are changes since the project was loaded, saved or
   * replaced with `applyRemoteProject`; `false` again after each of those.
   * Fires on change only, and once with `false` when the editor is ready.
   */
  onDirtyChange?(dirty: boolean): void;
  /** Something failed that the person may need to hear about (open, save, import). */
  onError?(error: { message: string; source?: string }): void;
  /** The person pressed Import in the Media panel while `hostChrome.importAction` is `"host"`. */
  onImportRequest?(): void;
  /**
   * An edit was refused because it would break a locked clip group apart (see
   * {@link MountedEditor.setClipGroups}). Offer the person "Break chain here" by
   * unlocking the group (`setClipGroups`) and letting them retry.
   */
  onLockedAction?(event: { groupId: string; action: "move" | "split" | "trim" | "delete" | "retime" }): void;
  /** Files were dropped on the Media panel while `hostChrome.importAction` is `"host"`. */
  onFilesDropped?(files: readonly File[]): void;
  /** The person clicked a host marker on the ruler (see {@link MountedEditor.setMarkers}). The playhead moves there too. */
  onMarkerClick?(marker: HostMarker): void;
}

/** A marker or comment the host shows on the timeline ruler. */
export interface HostMarker {
  readonly id: string;
  /** Seconds on the timeline. */
  readonly time: number;
  /** Shown on hover and as the marker's accessible name. */
  readonly label?: string;
  /** Any CSS colour (default: the accent colour). */
  readonly color?: string;
}

/** Live meters drawn over the player. */
export interface HostMeters {
  /** Integrated loudness (LUFS) and true peak (dBTP) of the preview mix. Click it to reset. */
  readonly loudness?: boolean;
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
  /** Light/dark mode and CSS tokens, scoped to the editor root. */
  readonly theme?: EditorTheme;
  /** Callbacks for save, change, export and selection. */
  readonly events?: EditorEvents;
  /** Tools the in-editor agent may call; removed again on unmount. */
  readonly tools?: readonly HostToolDefinition[];
  /** Extra arguments for existing tools, keyed by tool name. */
  readonly toolExtensions?: Readonly<Record<string, ToolSchemaExtension>>;
  /**
   * Show the first-run welcome tour. Defaults to true, as in the standalone
   * app; a host that has its own onboarding passes false.
   */
  readonly onboardingTour?: boolean;
  /**
   * Stills the Effects and Transitions cards preview on (image URLs). `still`
   * is the outgoing side and the effect sample; `stillB` is the incoming side
   * of transitions (defaults to `still`). Without it the editor uses its built-in
   * demo samples.
   */
  readonly effectPreviewMedia?: { readonly still?: string; readonly stillB?: string };
  /** Host-drawn panels: media tabs, inspector tabs, clip context-menu items. */
  readonly hostPanels?: HostPanels;
  /**
   * Host-owned export actions. With targets, the toolbar Export button runs the
   * primary target and a chevron menu lists the others plus "Custom export...".
   */
  readonly exportTargets?: readonly HostExportTarget[];
  /** Chrome the host replaces; every field is optional. */
  readonly hostChrome?: HostChrome;
  /**
   * A state-sharing channel with the host: the editor reads host-owned keys
   * from it, publishes its own, and calls host methods through it. See
   * `docs/embedding.md` ("Bridge") for the keys.
   */
  readonly bridge?: HostBridge;
  /** Host actions the editor calls instead of its own (same as `events.onImportRequest`). */
  readonly hostActions?: {
    readonly import?: () => void;
    /**
     * Take a finished recording (webcam, screen) instead of keeping it in the
     * project: resolve with the media to use, or `undefined` to let the editor
     * import the file itself. Fires before the file is imported.
     */
    readonly record?: (file: File) => Promise<File | undefined> | File | undefined;
  };
  /**
   * Veto an edit before it happens: return `{ ok: false, reason }` to refuse it
   * (the action fails with code `HOST_VETO` and `reason` as its message, and the
   * editor shows the reason) or nothing to allow it. Called for every action the
   * person, the AI or the host makes; not for undo and redo.
   */
  readonly beforeEdit?: (op: BeforeEditOp) => { readonly ok: false; readonly reason: string } | void;
  /** Panel sizes and the timeline's room. Every field is optional; omitted fields keep the editor's own layout. */
  readonly layout?: HostLayout;
  /**
   * Start read-only: no edits, drops or tool use; menus still open, and a
   * "Read only" banner shows. Change it later with `setReadOnly`.
   */
  readonly readOnly?: boolean;
  /**
   * Replace some of the editor's own words. Keys: `save`, `export`, `import`,
   * `untitledProject`, `aiEditing`, `manual`, `search` (the search button's label and the search box's placeholder), `readOnly`.
   */
  readonly labels?: Readonly<Partial<Record<HostLabelKey, string>>>;
  /**
   * The editor's AI from the host: its transport, models and settings. Without
   * it the AI works as before, with keys the person enters in the browser.
   */
  readonly ai?: HostAiOptions;
  /** Meters over the player; none by default. */
  readonly meters?: HostMeters;
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
  /** Change the theme; tokens from the previous theme are removed. */
  setTheme(theme: EditorTheme | undefined): void;
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
  /**
   * Put a placeholder clip on the timeline for media that does not exist yet.
   * Returns the clip id. It is a real clip: it can be moved, trimmed, split,
   * deleted and given transitions, and it exports as its still or card.
   */
  addPlaceholderClip(options: AddPlaceholderOptions): string;
  /** Change a placeholder's label, still, pattern, progress, duration or metadata. `{ history: false }`: no undo entry, no unsaved change. */
  updatePlaceholder(id: string, patch: PlaceholderPatch, opts?: HostSetupOptions): void;
  /**
   * Swap a placeholder for an imported media item. Position, track, duration
   * (shortened if the media is shorter), transitions and metadata stay.
   */
  replacePlaceholder(id: string, mediaId: string): void;
  /** Host metadata of a timeline clip (`undefined` if none or no such clip). */
  getClipMetadata(id: string): Record<string, unknown> | undefined;
  /** Merge `patch` into a clip's host metadata (a key set to `undefined` is removed). `{ history: false }`: no undo entry, no unsaved change. */
  setClipMetadata(id: string, patch: Record<string, unknown>, opts?: HostSetupOptions): void;
  /**
   * Run the host's post-load setup (labels, groups, placeholders) so it leaves
   * no trace in the person's history: the undo entries it made are dropped, and
   * the project stays "clean" if it was clean before. Waits for queued
   * placeholder work started inside `fn`.
   */
  batchHostSetup<T>(fn: () => T | Promise<T>): Promise<T>;
  /** Select one timeline clip (fires `events.onSelectionChange`). */
  selectClip(id: string): void;
  /**
   * Replace the open project from the host (for example the cut changed on the
   * server) without a reload. Selection, playhead and zoom stay unless the
   * options say otherwise; media the editor already holds is reused, and the
   * rest is read from the storage provider. One undo step labelled "Remote
   * change". Resets the dirty state.
   */
  applyRemoteProject(
    project: Project,
    options?: {
      readonly revision?: string;
      readonly keepSelection?: boolean;
      readonly keepPlayhead?: boolean;
      readonly keepZoom?: boolean;
      /** `false`: no "Remote change" undo entry. */
      readonly history?: boolean;
    },
  ): Promise<void>;
  /** Move the playhead (seconds). */
  seek(seconds: number): void;
  play(): void;
  pause(): void;
  /** Timeline zoom in pixels per second. */
  setZoom(pixelsPerSecond: number): void;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** The selected timeline items. */
  getSelection(): readonly SelectedTimelineItem[];
  /** Playhead position in seconds. */
  getPlayhead(): number;
  /** Put keyboard focus in the editor. */
  focus(): void;
  /**
   * State sharing and RPC with the host: `get`/`set`/`subscribe` on namespaced
   * keys, `call('tool', { name, args })` to drive the open editor through the
   * tool registry the editor's AI uses, `version` and `capabilities`.
   */
  readonly bridge: EditorBridge;
  /**
   * Define the project's clip groups. In a locked group the clips move, delete
   * and retime as a unit: inside boundaries cannot be moved, trimmed, split or
   * rippled (the edit is refused and `events.onLockedAction` fires), the outer
   * start and end can be trimmed, and per-clip effects, volume and colour stay
   * editable. One undo step.
   */
  setClipGroups(groups: readonly ClipGroup[], opts?: HostSetupOptions): Promise<void>;
  getClipGroups(): readonly ClipGroup[];
  /** Put clips in a group (`null` takes them out). One undo step. */
  setClipGroup(clipIds: readonly string[], groupId: string | null): Promise<void>;
  /** Move every clip of a group by `delta` seconds as a unit. */
  moveGroup(groupId: string, delta: number): Promise<void>;
  /** Remove every clip of a group as a unit. */
  removeGroup(groupId: string): Promise<void>;
  /** Turn read-only mode on or off. */
  setReadOnly(readOnly: boolean): void;
  /**
   * Start an export from the host's own header: the primary export target when
   * `exportTargets` is set, otherwise the editor's export dialog. Works with the
   * editor's top bar hidden.
   */
  openExport(): void;
  /** Save through the storage provider (same as Ctrl/Cmd+S); resolves with the provider's result. */
  save(): Promise<SaveProjectResult>;
  /** Whether there are unsaved changes, whether a save is running, and when and at what revision the last one finished. */
  getSaveState(): { dirty: boolean; saving: boolean; savedAt: number | null; revision?: string };
  /** Open a host inspector tab by id (as soon as it applies to the selection). */
  openInspectorTab(id: string): void;
  /**
   * Change a clip's volume (linear, 1 = unity), fades (seconds) and display name
   * in one undo step.
   */
  updateClip(id: string, patch: { volume?: number; fadeIn?: number; fadeOut?: number; name?: string }): Promise<void>;
  /**
   * Point a clip at other media: a media id already in the project, a `File`
   * (imported first) or a {@link HostMediaRef} (resolved through `media.resolve`
   * and imported). Position, track, transitions and metadata stay; the duration
   * stays too (shortened if the media is shorter) unless `opts.duration` is
   * `"media"`. One undo step.
   */
  replaceClipMedia(
    clipId: string,
    media: string | File | HostMediaRef,
    opts?: { duration?: "keep" | "media" },
  ): Promise<void>;
  /** Remove a clip; with `ripple` the clips after it close the gap. One undo step. */
  removeClip(id: string, opts?: { ripple?: boolean }): Promise<void>;
  /** Render one frame as a PNG (default: at the playhead). */
  renderStill(atSeconds?: number): Promise<Blob>;
  /** Render the mixed audio of the timeline as a WAV. */
  renderAudio(): Promise<Blob>;
  /**
   * Lock or unlock a row: nothing on it can be moved, trimmed, split or deleted
   * by any edit path until it is unlocked. One undo step.
   */
  setTrackLocked(trackId: string, locked: boolean): Promise<void>;
  /**
   * Set a clip's own locks (`move`: not moved in time or between rows; `trim`:
   * not trimmed, slipped, retimed or split). `{}` or `null` clears them. One undo step.
   * Locks are kept by `applyRemoteProject` when the incoming project leaves them out.
   */
  setClipLocks(clipId: string, locks: { readonly move?: boolean; readonly trim?: boolean } | null): Promise<void>;
  /** Show these markers on the ruler, replacing the previous set. Not part of the project: no undo, no unsaved change. */
  setMarkers(markers: readonly HostMarker[]): void;
  /** The markers set with {@link setMarkers}. */
  getMarkers(): readonly HostMarker[];
}

/** Chrome the host replaces. */
/** The host's side of the bridge. Values are JSON; keys are namespaced (`ai.config`, `session`, ...). */
export interface HostBridge {
  get(key: string): unknown;
  set(key: string, value: unknown): Promise<void>;
  subscribe(key: string, cb: (value: unknown) => void): () => void;
  /** Editor to host RPC, for example `call("queue.action", { id, action })`. */
  call(method: string, args?: unknown): Promise<unknown>;
}

export type HostLabelKey =
  | "save"
  | "export"
  | "import"
  | "untitledProject"
  | "aiEditing"
  | "manual"
  | "search"
  | "readOnly";

export interface HostChrome {
  /** Editor chrome to remove (the host has its own). */
  readonly hide?: readonly HostChromeItem[];
  /**
   * `"host"`: the Media panel's Import button asks the host (`hostActions.import`
   * or `events.onImportRequest`) and never opens the OS file picker; dropping
   * files on the panel hands them to `events.onFilesDropped`.
   */
  readonly importAction?: "host" | "editor";
  /**
   * `"host"`: the Export button hands the file to `events.onExport` only (no
   * download or save dialog). `"editor"` (default): unchanged.
   */
  readonly exportAction?: "host" | "editor";
}

/** Pieces of editor chrome a host can hide. */
export type HostChromeItem =
  | "projectMenu"
  | "newProject"
  | "projectBackups"
  | "settingsAndApiKeys"
  | "projectJson"
  | "screenRecorder"
  | "localStorageWarnings"
  /** The cogwheel in the AI chat header (kept when `ai.renderSettings` is given, then showing only the host summary and the model picker). */
  | "aiSettings"
  /** Every provider, model-id, base-URL and key field, and the API Keys settings tab. */
  | "aiProviders"
  /** The General settings tab and other editor preferences the host replaces. */
  | "preferences"
  /** The editor's own AI panel, its rail button and the Manual / AI editing toggle. */
  | "aiPanel"
  /** The editor's whole top bar (the host draws its own). The stage and timeline take the space. */
  | "header"
  /** The search / command button in the tool rail (Cmd+K still opens search). */
  | "search"
  /** The brand block: the "Back to home" button at the top of the tool rail. */
  | "brand"
  /** The right-hand column (the host draws its own, outside the editor). */
  | "inspector"
  /** The editor's Save control (it has none by default; Ctrl/Cmd+S still raises onSave). */
  | "save"
  /** The editor's own Export button and its menu. */
  | "export"
  /** The "Saved!" / progress message that replaces the Export button. */
  | "saveState";

/** Phases a host export target reports through `progress`. */
export type ExportTargetPhase = "rendering" | "uploading" | "saving";

/** Settings an export target asks the engine for; unset fields use the project's. */
export interface HostExportSettings {
  readonly width?: number;
  readonly height?: number;
  /** Frames per second. */
  readonly fps?: number;
  readonly format?: "mp4" | "webm" | "mov";
  readonly codec?: "h264" | "h265" | "vp9" | "av1" | "prores";
  /** kbit/s. */
  readonly bitrate?: number;
  /** 0 to 100. */
  readonly quality?: number;
}

/** One host-owned export action. */
export interface HostExportTarget {
  readonly id: string;
  readonly label: string;
  /** `"primary"` marks the main action (else the first target is primary); other values name a menu group. */
  readonly group?: "primary" | "other" | (string & {});
  readonly description?: string;
  readonly icon?: string;
  /** Engine settings used when `renderBlob` renders. */
  readonly settings?: HostExportSettings;
  /**
   * Run the export. Call `ctx.renderBlob()` to render the timeline in the
   * browser, report phases with `ctx.progress`, and stop when `ctx.signal`
   * aborts (the person pressed cancel). A returned `message` is shown as the
   * final status.
   */
  run(ctx: {
    renderBlob(): Promise<ExportedFile>;
    progress(p: { phase: ExportTargetPhase | (string & {}); fraction?: number }): void;
    signal: AbortSignal;
  }): Promise<void | { message?: string; url?: string }>;
}

/** For setup calls that should leave no undo entry and no unsaved change. */
export interface HostSetupOptions {
  /** `false`: the change is not an undo step and does not make the project dirty. Default true. */
  readonly history?: boolean;
}

/** Options for {@link MountedEditor.addPlaceholderClip}. */
/** What `beforeEdit` is asked about. */
export interface BeforeEditOp {
  /** The action type, for example `clip/move`, `clip/split`, `track/remove`. */
  readonly type: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Layout of the editor's panels; see `docs/embedding.md` ("Layout"). */
export interface HostLayout {
  /** Starting values for a named look; explicit fields below win. */
  readonly preset?: "compact" | "comfortable";
  /** The timeline's height as a percentage of the editor's height, or `"auto"` to fit `minVisibleTracks`. */
  readonly timelineHeight?: number | "auto";
  /**
   * Tracks the timeline must show without scrolling (with `timelineHeight: "auto"`).
   * `"all"` shows every track: the timeline is sized to the track count and the
   * track rows shrink (never below 40 px, never above `trackHeight`) so they fit
   * in 60% of the editor; only beyond that does the timeline scroll.
   */
  readonly minVisibleTracks?: number | "all";
  /** Height of one track row in px. */
  readonly trackHeight?: number;
  /**
   * Empty space (px) kept free along the edges inside the editor root, for UI
   * the host floats over the editor. Default 0 on every side.
   */
  readonly insets?: { readonly top?: number; readonly right?: number; readonly bottom?: number; readonly left?: number };
  /**
   * Corners (px) the host covers with its own floating widget. No editor
   * control is placed under them: bottom corners narrow the timeline panel by
   * `width` on that side, top corners pad the top bar (or, with the top bar
   * hidden, the whole workspace) by `width` and `height`. Default none.
   */
  readonly reservedCorners?: {
    readonly bottomRight?: { readonly width: number; readonly height: number };
    readonly bottomLeft?: { readonly width: number; readonly height: number };
    readonly topRight?: { readonly width: number; readonly height: number };
    readonly topLeft?: { readonly width: number; readonly height: number };
  };
  /** The preview stage never gets shorter than this (px). */
  readonly previewMinHeight?: number;
  readonly panels?: { readonly mediaWidth?: number; readonly inspectorWidth?: number };
}

export interface AddPlaceholderOptions {
  /** `crossOrigin` for loading `imageUrl` (default `"anonymous"`; `null` for none). */
  readonly imageCrossOrigin?: "anonymous" | "use-credentials" | null;
  /** Track to put the clip on; a new track is made when omitted. */
  readonly trackId?: string;
  /** Start on the timeline, in seconds. */
  readonly start: number;
  /** Length in seconds. */
  readonly duration: number;
  readonly label?: string;
  /** A still shown on the clip and in the preview instead of the generic card. */
  readonly imageUrl?: string;
  readonly pattern?: "bars" | "hatch";
  /** 0 to 1, drawn as a strip on the clip. */
  readonly progress?: number;
  /**
   * A low-res proxy or animatic (video URL, fetched with CORS) that plays in the
   * preview and export instead of the still until `replacePlaceholder`.
   */
  readonly previewUrl?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Fields {@link MountedEditor.updatePlaceholder} can change. */
export interface PlaceholderPatch {
  readonly label?: string;
  readonly imageUrl?: string;
  readonly pattern?: "bars" | "hatch";
  readonly progress?: number;
  /** A proxy or animatic to play in place of the still (see {@link AddPlaceholderOptions.previewUrl}). */
  readonly previewUrl?: string;
  readonly duration?: number;
  readonly metadata?: Record<string, unknown>;
}

/** Everything a host can add to the editor's own panels. All parts are optional. */
export interface HostPanels {
  /** Extra tabs in the Media panel, after "Project Media". */
  readonly mediaTabs?: readonly HostMediaTab[];
  /** Extra tabs in the Inspector for the selected clip. */
  readonly inspectorTabs?: readonly HostInspectorTab[];
  /**
   * Who owns the right-hand column. `mode: "tabs"` (default) keeps the editor's
   * own properties and adds `inspectorTabs` next to them. `mode: "replace"` shows
   * only the host's tabs (`tabs`, or `inspectorTabs` when omitted): the editor's
   * own inspector is not rendered, and tabs can apply with nothing selected.
   */
  readonly inspector?: HostInspector;
  /** Extra items in the clip right-click menu, in their own group. */
  readonly clipContextMenu?: (clip: HostClipInfo) => readonly HostMenuItem[];
}

/** A tab the host draws in the Media panel. */
export interface HostMediaTab {
  readonly id: string;
  readonly label: string;
  /** An image URL, or a short text glyph. */
  readonly icon?: string;
  /**
   * Called once, the first time the tab is shown, with an empty container
   * styled as a panel. Return the function that tears the content down; it
   * runs when the editor unmounts.
   */
  mount(el: HTMLElement, api: HostMediaTabApi): () => void;
}

/** What a media tab can do in the editor. */
export interface HostMediaTabApi {
  /**
   * Resolve each asset through `media.resolve`, import it like a dropped file
   * and, when `opts` is given, place it on the timeline. Returns media ids.
   */
  importAssets(
    ids: string[],
    opts?: { trackId?: string; at?: number },
  ): Promise<string[]>;
  /** Import files like a dropped file. Returns media ids. */
  importFiles(files: File[]): Promise<string[]>;
  /**
   * Call from a `dragstart` handler: puts the assets in the DataTransfer under
   * `application/x-openreel-host-assets`. Dropped on the timeline they are
   * resolved, imported and placed at the drop point and track.
   */
  setDragData(e: DragEvent, assets: HostDragAsset[]): void;
  /** Called when the host theme changes (not on subscribe). */
  onThemeChange(cb: (theme: EditorTheme) => void): () => void;
}

/** One asset in a drag from a host media tab. */
export interface HostDragAsset {
  readonly id: string;
  readonly name: string;
  readonly kind: "video" | "image" | "audio";
  readonly duration?: number;
}

/**
 * What is selected, as the host's inspector sees it: nothing (`null`), one clip,
 * several clips, or a join: the transition handle between two clips.
 */
export type HostSelection =
  | null
  | HostClipInfo
  | readonly HostClipInfo[]
  | { readonly join: { readonly between: readonly [string, string] } };

/** How the host takes over the inspector column. */
export interface HostInspector {
  readonly mode?: "tabs" | "replace";
  readonly tabs?: readonly HostInspectorTab[];
}

/** A tab the host draws in the Inspector. */
export interface HostInspectorTab {
  readonly id: string;
  readonly label: string;
  /** An image URL, or a short text glyph. */
  readonly icon?: string;
  /**
   * Show the tab only when this returns true for the selection (see
   * {@link HostSelection}: `null`, one clip, an array of clips or a join). Without it a tab
   * shows for a selected clip or clips, and in `replace` mode always.
   */
  when?(selection: HostSelection): boolean;
  /**
   * Open this tab by itself whenever the person selects another clip it applies
   * to (for example a "Scene" tab for a placeholder). Default false.
   */
  readonly activateOnSelect?: boolean;
  /**
   * Called the first time the tab is shown. It stays mounted while the
   * inspector is open; `api.onClipChange` reports selection and metadata changes.
   */
  mount(el: HTMLElement, api: HostInspectorApi): () => void;
}

/** What an inspector tab can do. */
export interface HostInspectorApi {
  /** The clip shown now (a live getter); only meaningful while a clip is selected, see `current`. */
  readonly clip: HostClipInfo;
  /** The clip shown now, or `null` when nothing (or something that is not a clip) is selected. */
  current(): HostClipInfo | null;
  /** The selection now (a live getter). */
  readonly selection: HostSelection;
  /** Fires when the selection changes. */
  onSelectionChange(cb: (selection: HostSelection) => void): () => void;
  /** Fires when another clip is selected or the clip changes; `null` when none applies. */
  onClipChange(cb: (clip: HostClipInfo | null) => void): () => void;
  /** Merge `patch` into the clip's host metadata (one undo step). */
  updateMetadata(patch: Record<string, unknown>): void;
}

/** A timeline clip as the host sees it. */
export interface HostClipInfo {
  readonly id: string;
  readonly trackId: string;
  readonly type: "video" | "image" | "audio" | "text" | "graphic" | "placeholder";
  /** Seconds. */
  readonly start: number;
  /** Seconds. */
  readonly duration: number;
  readonly mediaId?: string;
  readonly label?: string;
  readonly metadata?: Record<string, unknown>;
}

/** An item the host adds to the clip context menu. */
export interface HostMenuItem {
  readonly id: string;
  readonly label: string;
  /** An image URL, or a short text glyph. */
  readonly icon?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  onSelect(clip: HostClipInfo): void;
}
