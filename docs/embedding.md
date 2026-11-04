# Embedding the editor in a host application

OpenReel can be mounted into any page, with the host supplying storage, media,
agent tools and (see the sections below) theme and events. Nothing here is
specific to one host. With no options the standalone app behaves exactly as it
always did.

## Library build

```sh
pnpm --filter @openreel/web build:lib
```

writes `apps/web/dist-lib/`:

| File | What |
| --- | --- |
| `openreel-editor.js` + `chunks/`, `assets/` | ESM entry and lazy chunks, workers and wasm. React is bundled, so the host only needs the files. All URLs are relative to the bundle. |
| `openreel-editor.css` | Tailwind and Astryx styles. Design tokens are declared on `[data-openreel-root]` instead of `:root`, and `html`/`body` rules are removed (`vite-plugins/scope-root-css.ts`). Tailwind's preflight and Astryx's reset still apply page-wide, as they do for any Tailwind app. |
| `fonts/` | Files the 3D text renderer loads through `assetUrl()`; serve them at `basePath`. |
| `types/` | Declarations (`apps/web/dist-lib/types/apps/web/src/embed/index.d.ts`). They import `@openreel/core` and `@openreel/agent`; map those to `dist-lib/types/packages/*/src/index.d.ts` in the consumer's `tsconfig` `paths`. |

`@openreel/web` exposes them as `@openreel/web/embed` and
`@openreel/web/embed.css`. Load the Inter font yourself (the standalone app
does it from `index.html`).

## Try it: the harness

`apps/web/harness/` is a plain page with a fake host (in-memory storage with
every call recorded, generated audio and image assets, a host tool, event
logging) that mounts the library build and exercises each hook:

```sh
pnpm --filter @openreel/web build:lib
PREFIX=/tools/editor PORT=5199 pnpm --filter @openreel/web harness   # http://localhost:5199/tools/editor/
pnpm --filter @openreel/web test:e2e                                # Playwright smoke, Chromium and WebKit
```

## Usage

```ts
import { mountEditor } from "@openreel/web/embed";
import "@openreel/web/embed.css";

const editor = mountEditor(document.getElementById("slot")!, {
  storage, // StorageProvider (optional)
  media, // HostMediaSource (optional)
  tools, // HostToolDefinition[] (optional)
  projectId: "p1", // open a stored project, else a new one
});

editor.unmount();
```

`onboardingTour: false` turns off the first-run welcome tour (it is a full-screen
overlay that blocks clicks until dismissed).

`mountEditor(container, options)` renders into `container`, does not read or
write the URL (no router), and returns a `MountedEditor`. Only one editor can be
mounted per page: its state lives in module-level stores, so a second call
throws until the first is unmounted. `unmount()` removes the DOM, auto-save,
agent tools and the storage provider it installed, and is idempotent.

## Storage: `StorageProvider`

Defined in `@openreel/core` (`packages/core/src/storage/storage-provider.ts`).
The default is the browser's IndexedDB; a host replaces it to make its own
server the system of record.

| Method | Purpose |
| --- | --- |
| `listProjects()` / `loadProject(id)` / `saveProject(project, {expectedRevision})` / `deleteProject(id)` | Project documents. `saveProject` returns `{revision}`; a provider may throw `StorageConflictError` for a stale `expectedRevision`. |
| `putMedia(record)` / `getMedia(id)` / `deleteMedia(id)` / `listMedia(projectId)` | Binary media, keyed by the media item id. Return a `Blob` (a `File` is fine). |
| `snapshots?`, `recents?`, `handles?` | Optional parts (crash-recovery snapshots, recent list, local file handles). When omitted they fall back to the built-in IndexedDB versions, which suits a local working copy next to a server-side system of record. |
| `getUsage?()`, `clearAll?()`, `dispose?()` | Optional. |

Contract: saved projects are plain JSON. Media items inside carry `blob: null`,
no file handle, waveform or object-URL thumbnail; the editor stores the bytes
separately through `putMedia` when media is imported, and re-attaches them (as
`File`s) when a project is opened. Items the provider has no bytes for open as
relinkable placeholders. With a host provider, Ctrl/Cmd+S saves through
`saveProject` instead of opening a file picker.

`createMemoryStorageProvider()` is a complete in-memory reference
implementation.

## Media: `HostMediaSource`

```ts
interface HostMediaSource {
  list?(query?): Promise<readonly HostMediaAsset[]>;
  resolve(assetId: string): Promise<Blob>;
}
```

`editor.importAsset(id)` resolves an asset and imports it like a dropped file.

## Agent tools

The in-editor AI assistant calls tools. A host can add its own and extend the
arguments of existing ones, through `mountEditor` options or at runtime:

```ts
import { registerTool, extendToolSchema } from "@openreel/agent";

const remove = registerTool({
  name: "host_find_broll",
  description: "Find B-roll in the host library",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  readOnly: true,
  handler: async (args, host) => ({ ok: true, summary: "…", data: [] }),
});

extendToolSchema("add_marker", {
  properties: { note: { type: "string" } },
  description: "Include a note.",
  intercept: (args) => (args.note === "" ? { ok: false, summary: "Empty note" } : undefined),
});
```

- Names are `[a-zA-Z0-9_-]{1,64}`; built-in names cannot be replaced; duplicates
  throw. `registerTool` returns a remover; `unregisterTool(name)` also works.
- Flags: `readOnly` tools run without changing the project; `destructive` and
  `expensive` tools ask the user to confirm; `alwaysAvailable` keeps the tool in
  every turn's list (otherwise the tool router may drop it for Motion/3D
  prompts).
- `extendToolSchema` merges `properties`/`required`/`description` into a tool's
  schema. `intercept` runs first with all arguments and may answer the call; the
  extension's own arguments are removed before a built-in tool validates the
  call.
- Handlers receive an `EditingHost` (below). In the editor, a model turn runs on
  an isolated draft that commits atomically, so a handler must change the
  project only through `host.applyAction`.

## The `EditingHost` contract

Every tool executes against an `EditingHost` (`packages/agent/src/host.ts`).
The editor provides one for chat turns, `HeadlessHost` provides one for Node,
and a host application can implement its own (for example to run the same tools
on a server). Required members:

| Member | Contract |
| --- | --- |
| `getProject()` | The authoritative, serializable `Project`. Throws if none is open. |
| `applyAction(action)` | Apply an action through the action system; resolves `{success, error?}`. Records undo. The only way tools mutate the project. |
| `beginTransaction(label?)` / `commitTransaction(handle, label)` / `rollbackTransaction(handle)` | Group a turn's actions into one undo step; rollback restores the pre-turn project. |
| `runJob(kind, params)` | Long-running work: `exportVideo`, `exportAudio`, `exportFrame`. Resolves `{ok, data?, error?}`. |
| `capabilities()` | Machine-readable enums and ranges the agent may use. |
| `requireOpenProject()` | Throws when no project is open. |

Optional members are feature-detected by tools and the tool fails with a clear
message when absent: `createProject`, `openProject`, `listProjects`,
`saveProject`, `importMediaFromUrl`, `exportMotionScene`, `motionRenderQueue`,
`multicam`, `probeRiggingBackend`, `inspectModel`, `rigHumanoidModel`, and the
overlay helpers (`createTextOverlay`, `updateTextOverlay`, `createShapeOverlay`,
`updateShapeOverlay`, `createStickerOverlay`, `updateStickerOverlay`,
`createSvgOverlay`, `updateSvgOverlay`, `removeOverlay`). Overlay edits must go
through the engine-aware helpers: the raw `text/*`, `shape/*` actions only
change serialized arrays and do not reach the preview or export engines.

## Events

```ts
mountEditor(el, {
  events: {
    onSave: ({ project, revision }) => {},
    onChange: ({ project }) => {},
    onExport: async ({ blob, filename, mimeType, project }) => {},
    onSelectionChange: (selection) => {}, // [{ id, trackId, type }]
  },
});
```

- `onSave`: after a save through the storage provider (Ctrl/Cmd+S or
  `editor.saveProject()`), with the provider's revision.
- `onChange`: the project changed; trailing-debounced by about 250 ms.
- `onExport`: an export finished. While it is set, the editor hands the file to
  the host instead of downloading it or opening a save dialog. The file is held
  in memory (limit 1 GiB); if the callback rejects, the export fails.
- `onSelectionChange`: the timeline selection changed.

An exception thrown by a callback is logged and never breaks the editor.
Handlers are removed on unmount.

## Export: host targets and stills

Without options the Export button opens the editor's own export menu and dialog
and downloads the file (or hands it to `events.onExport` when that is set).

### `exportTargets`

```ts
mountEditor(el, {
  exportTargets: [
    {
      id: "library", label: "Save to library", group: "primary",
      settings: { format: "mp4", codec: "h264", width: 1080, height: 1920, fps: 30, bitrate: 12000 },
      async run({ renderBlob, progress, signal }) {
        const file = await renderBlob();                 // renders once, in the browser
        progress({ phase: "uploading", fraction: 0 });
        await upload(file.blob, { signal });
        progress({ phase: "saving" });
        return { message: "Saved to the library" };      // shown as the final status
      },
    },
    { id: "social", label: "Vertical for social", group: "Social", run: async (ctx) => { /* … */ } },
  ],
});
```

- The primary target (`group: "primary"`, else the first one) is the Export
  button. The chevron lists every other target, grouped by `group` (`"other"` or
  unset shows as "Other formats"), then "Custom export..." (the editor's own
  dialog; always kept).
- `settings` (`width`, `height`, `fps`, `format` `mp4|webm|mov`, `codec`,
  `bitrate` in kbit/s, `quality` 0 to 100) are what `renderBlob()` asks the
  engine for; unset fields use the project's size and frame rate.
- `renderBlob()` resolves `{ blob, filename, mimeType, project }` and renders at
  most once per run. Everything it reads is in memory (limit 1 GiB).
- `progress({ phase, fraction })`: phases `"rendering"` (reported by the editor
  itself), `"uploading"`, `"saving"` fill one bar (0 to 70 %, 70 to 92 %, 92 to
  100 %); the overlay shows the phase name. Other phase names are shown without
  moving the bar.
- Cancel (the Export button turns into a cancel button while running) aborts
  `signal` and stops the render. A rejection from `run` fails the export with
  its message; an aborted run ends silently.
- `events.onExport` keeps working and is independent: a target's `run` may call
  it itself.

### `hostChrome.exportAction`

`hostChrome: { exportAction: "host" }` sends every export (the Export button and
its format menu) to `events.onExport` only: no download, no save dialog.
`"editor"` (default) is unchanged.

### `editor.renderStill` and `editor.renderAudio`

```ts
const png = await editor.renderStill(12.5);   // PNG Blob of the frame at 12.5 s (default: the playhead)
const wav = await editor.renderAudio();       // WAV Blob of the mixed timeline audio
```

They use the same engine as export, so a host target can be made on the client
(a still as a poster, audio only). Both reject when the timeline is empty or the
engine cannot render.

## Theme

```ts
mountEditor(el, {
  theme: { mode: "dark", tokens: { "--accent": "#ff5a36", "--bg": "#101014" } },
});
editor.setTheme({ mode: "light" });
```

`mode` is `"light" | "dark" | "auto"`. `tokens` are CSS custom properties set on
the editor root only; the editor's colours are the variables in
`apps/web/src/index.css` (`--bg`, `--fg`, `--accent`, `--border`, `--playhead`,
`--preview-*`, `--graph-*`, and the Tailwind-facing HSL set). Light/dark markers
(`data-theme`, the `dark` class) go on the editor root, never on the host's
`<html>`. Colours that used to be hard-coded in the timeline playhead, preview
stage and keyframe graph now read these tokens. Note that the choice of mode is
remembered in `localStorage` (`openreel-theme`) like in the standalone app, and
that content colours (effects, user-chosen text colours, marker presets) stay
literal on purpose.

## Serving from a sub-path

- Standalone build: `OPENREEL_BASE=/tools/editor/ pnpm --filter @openreel/web build`
  sets Vite's `base`. Workers and wasm are located with `new URL(..., import.meta.url)`
  and follow the bundle; public files (the 3D text fonts) and the service worker
  use `assetUrl()`, which honours the base. The service worker is registered
  with the sub-path as its scope, and its shell cache is relative to `sw.js`.
- Embedded: `mountEditor(el, { basePath: "/tools/editor/" })` sets the prefix
  `assetUrl()` uses for files from `public/`. Copy the contents of
  `apps/web/public/` (at least `fonts/`) to that path.
- There is no router to configure: the standalone app routes with
  `location.hash` and the embedded editor does not route at all.

### Cross-origin isolation (COOP/COEP)

The editor does not require it. In the source the only code gated on
`crossOriginIsolated` is the video-stabilization engine
(`packages/core/src/video/stabilization/vidstab-engine.ts`), which uses the
multi-threaded ffmpeg core when the page is isolated and the single-threaded one
otherwise. The in-browser Whisper captioning runs on onnxruntime-web, which
(from its documented behaviour; not exercised here) falls back to one thread
without `SharedArrayBuffer`. The
standalone dev and preview servers and `public/_headers` send COOP/COEP; a host
that wants multi-threaded stabilization must send `Cross-Origin-Opener-Policy:
same-origin` and `Cross-Origin-Embedder-Policy: require-corp` itself.

## The editor's AI from the host: `ai`

By default the in-editor assistant sends its requests straight from the browser
to a provider, with a key the person types in. A host that has its own
providers, keys and billing passes `ai` instead (`apps/web/src/embed/ai-types.ts`):

```ts
mountEditor(el, {
  ai: {
    managed: true, // hide every provider / key / base-URL field
    transport: {
      // One chat-completions request (OpenAI shape): body = { model, messages, tools, ... }.
      // Resolve with the completion JSON; call onDelta with new text while it streams.
      async send(body, { signal, onDelta }) {
        const res = await fetch("/api/editor-ai", { method: "POST", body: JSON.stringify(body), signal });
        return res.json(); // { choices: [{ message, finish_reason }], usage?: { prompt_tokens, completion_tokens } }
      },
    },
    models: async () => [{ id: "fast", label: "Fast", note: "Cheapest" }, { id: "smart", label: "Smart" }],
    defaultModel: "fast",
    renderSettings: (el) => { el.textContent = "Billed to your plan."; return () => el.replaceChildren(); },
    settingsLink: { label: "Models and providers", href: "/settings/models" }, // used when renderSettings is absent
    systemPromptExtra: async () => "Prefer short cuts.", // or a string
    onUsage: ({ model, inputTokens, outputTokens }) => {},
  },
  events: {
    onAiMessage: ({ role, text }) => {},                  // "user" request, then the "assistant" answer
    onToolCall: ({ name, phase, ok }) => {},              // phase "start" | "end"; ok on "end"
  },
});
```

| Member | Behaviour |
| --- | --- |
| `transport.send(body, { signal, onDelta })` | Required. The only way the editor reaches a model: it makes no other network request for the assistant. The body always carries `model` (the person's pick). Reject to fail the turn; honour `signal` to cancel. |
| `models()` | Called once at mount. The chat header gets a model picker when there are two or more, and the cogwheel always shows it. Without `models`, `defaultModel` is the single model. |
| `defaultModel` | Selected until the person picks another; used if `models()` does not list the current one. |
| `managed: true` | No provider, key, base-URL or "Connect a model" UI; the API Keys settings tab is removed; the editor never reads or stores a browser key for the assistant. (Other services with their own keys, such as the Motion shader generator, image generation or text to speech, stay unconfigured since their key entry is gone.) |
| `renderSettings(el)` | Host content inside the cogwheel dialog, below the model picker. Return the teardown. |
| `settingsLink` | When `renderSettings` is absent the dialog shows "Managed by the host." and this link. |
| `systemPromptExtra` | Appended to the editing system prompt on every turn (string, or async function). |
| `onUsage` | After every model request that reports token use. |

Host tools (`tools`, `addTool`, or agent `registerTool`) stay available to the
assistant in both modes, and `onToolCall` reports each tool the assistant runs.
The bundle also exports `aiSupported = true` so a host can feature-detect it.
Without `ai` nothing changes: the person's own connection and key are used.

The harness mounts a fake transport with `?ai=managed` (a tool call, then a
streamed reply); `e2e/ai.spec.ts` checks the turn, the missing key UI, and that
no request leaves the page's origin.

## Keyboard shortcuts

When embedded, shortcuts react only to key events that originate inside the
editor root (which is focusable and focused on mount). Keys pressed elsewhere
on the page do nothing. Ctrl/Cmd+K (search) is scoped the same way.

## Host panels: media tabs, inspector tabs, clip menu

`hostPanels` lets the host draw its own UI inside the editor. Every part is
optional; with none passed the editor is exactly as before. A bundle that has
this exports `hostPanelsSupported === true`.

```ts
interface HostPanels {
  mediaTabs?: HostMediaTab[];          // extra tabs in the Media panel, after "Project Media"
  inspectorTabs?: HostInspectorTab[];  // extra tabs in the Inspector for the selected clip
  clipContextMenu?: (clip: HostClipInfo) => HostMenuItem[]; // extra items in the clip right-click menu
}
interface HostMediaTab { id: string; label: string; icon?: string; mount(el: HTMLElement, api: HostMediaTabApi): () => void }
interface HostMediaTabApi {
  importAssets(ids: string[], opts?: { trackId?: string; at?: number }): Promise<string[]>; // media.resolve each, import, place when opts is given; returns media ids
  importFiles(files: File[]): Promise<string[]>;
  setDragData(e: DragEvent, assets: HostDragAsset[]): void; // DataTransfer type 'application/x-openreel-host-assets'
  onThemeChange(cb: (theme: EditorTheme) => void): () => void;
}
interface HostDragAsset { id: string; name: string; kind: 'video' | 'image' | 'audio'; duration?: number }
interface HostInspectorTab { id: string; label: string; icon?: string; when?(clip: HostClipInfo): boolean; mount(el: HTMLElement, api: HostInspectorApi): () => void }
interface HostInspectorApi { readonly clip: HostClipInfo; onClipChange(cb: (c: HostClipInfo | null) => void): () => void; updateMetadata(patch: Record<string, unknown>): void }
interface HostClipInfo { id: string; trackId: string; type: 'video' | 'image' | 'audio' | 'text' | 'graphic' | 'placeholder'; start: number; duration: number; mediaId?: string; label?: string; metadata?: Record<string, unknown> }
interface HostMenuItem { id: string; label: string; icon?: string; danger?: boolean; disabled?: boolean; onSelect(clip: HostClipInfo): void }
```

- **Media tabs** appear in the Media panel's rail after "Media". `mount` runs
  once, the first time the tab is shown, with a scrollable container that uses
  the editor's theme tokens; the function it returns runs when the editor
  unmounts. The tab keeps its content when the person switches away.
- **Drag and drop**: call `api.setDragData(event, assets)` from `dragstart`.
  Dropped on the timeline, the assets are resolved through `media.resolve`,
  imported and placed at the drop point (on the track under the cursor, or on a
  new track), one after another.
- **Inspector tabs** add a tab bar to the Inspector when at least one host tab
  applies to the selected clip (`when`, default: every clip): "Properties" (the
  editor's own) first, then the host's. The tab mounts the first time it is
  opened and stays mounted; `api.onClipChange` reports another selection, edits
  to the clip (including its metadata) and `null` when nothing applies.
  `updateMetadata` merges into the clip's host metadata as one undo step.
  Arrow keys, Home and End move between tabs.
- **Clip menu**: the items come after a divider, in their own group, in the
  right-click menu of timeline clips (media and placeholder clips). `icon` is an
  image URL or a short text glyph, never HTML.
- A host callback that throws is logged and skipped; the editor goes on.

### Host metadata on clips

Every timeline clip can carry host-owned metadata, stored in the clip's
`metadata.host` object in the serialized project. The editor never reads it.
It is copied by split and duplicate, restored by undo and redo, and kept by save
and load.

```ts
editor.getClipMetadata(id);            // Record<string, unknown> | undefined
editor.setClipMetadata(id, { shotId: "s4", note: undefined }); // merge; undefined removes a key; one undo step
editor.selectClip(id);                 // fires events.onSelectionChange
```

Project schema (additions to `Clip.metadata` in `packages/core/src/types/timeline.ts`):
`host?: Record<string, unknown>` and `placeholder?: { label?, imageUrl?, pattern: 'bars' | 'hatch', progress? }`.
The new actions `clip/setMetadata` and `clip/replaceMedia` (`packages/core/src/actions/handlers/clip-host.ts`)
are undoable and available to agent tools through `applyAction`.

### Placeholder clips

A placeholder stands in for media that does not exist yet.

```ts
const id = editor.addPlaceholderClip({ trackId?, start, duration, label?, imageUrl?, pattern?: 'bars' | 'hatch', progress?, metadata? }); // returns the clip id at once
editor.updatePlaceholder(id, { label?, imageUrl?, pattern?, progress?, duration?, metadata? });
editor.replacePlaceholder(id, mediaId); // after importAssets / importAsset returned the media id
```

- It is a first-class clip: move, trim, split (both halves keep the metadata),
  delete and transitions all work, and it survives save and load.
- On the timeline it is drawn with the pattern (or the still `imageUrl`), its
  label and, with `progress` (0 to 1), a strip along the bottom. Style it with
  `--placeholder-bg`, `--placeholder-a` and `--placeholder-b`.
- In the preview and in an export it is an image: your `imageUrl` still, or a
  neutral card with the label. It is never black, never played as media, and an
  export of a timeline that still has placeholders does not fail; the host gets
  `events.onExportWarning(count)` when an export starts.
- The still is an image in the media library flagged `hostGenerated`; it is
  hidden from the Media panel. `imageUrl` is fetched with CORS, so it must allow
  the editor's origin; otherwise the card is used.
- `replacePlaceholder` keeps position, track, duration (shortened if the media
  is shorter), transitions and host metadata, and drops the placeholder marker.
  Calls run in order, so you can call `addPlaceholderClip` and then
  `updatePlaceholder` straight away.
- A read-only editor refuses these calls.

## Chrome the host replaces: `hostChrome`

```ts
mountEditor(el, {
  hostChrome: {
    hide: ["projectMenu", "newProject", "projectBackups", "settingsAndApiKeys", "projectJson", "screenRecorder", "localStorageWarnings"],
    importAction: "host", // the Media panel's Import button asks the host
  },
  hostActions: { import: () => openMyLibrary() }, // or events.onImportRequest
  labels: { import: "Library", manual: "Manual", aiEditing: "AI editing" },
});
```

- `hide` removes the project dropdown (`projectMenu`, or only its "New Project"
  and "Project backups" items), "Settings & API keys", "Project JSON" (the rail
  button and the menu item), the screen recorder (menu item and the Record
  button) and the warnings about browser storage. No option, nothing hidden.
- `importAction: "host"`: Import (and the empty-state and "Add media" buttons)
  call `hostActions.import` or `events.onImportRequest` and never open the OS
  picker; files dropped on the Media panel go to `events.onFilesDropped(files)`.
  Add them with `editor.importFile`, or reference your own library with
  `importAsset`/`media.resolve`.
- `labels` replaces some of the editor's words: `save`, `export`, `import`,
  `untitledProject`, `aiEditing`, `manual`, `readOnly`. Unset keys keep the
  editor's text.

## Read-only mode

`readOnly: true` (or `editor.setReadOnly(on)`) refuses every edit: actions, undo
and redo, media import and the agent's tools all fail with a `READ_ONLY` error;
menus, selection, playback and zoom still work, and a "Read only" banner shows.
`applyRemoteProject` still works, because it is the host changing the cut.
Direct manipulation that the editor performs outside its action system (a few
panel-local settings) is not blocked; treat read-only as a guard against
accidental edits, not as access control, which belongs on the server.

## State and control

Events (all optional, all throttled or deduplicated as noted):

| Event | When |
| --- | --- |
| `onDirtyChange(dirty)` | `true` after the first edit since the project was loaded, saved or replaced with `applyRemoteProject`; `false` again after each. Fires on change, plus once with `false` at start. Nothing counts as unsaved before an edit. |
| `onPlayheadChange(seconds)` | The playhead moved; at most every 100 ms. |
| `onHistoryChange({ canUndo, canRedo })` | Undo/redo availability changed. |
| `onError({ message, source })` | Opening, saving or applying a project failed. |
| `onExportWarning(count)` | An export starts while placeholders remain. |
| `onImportRequest()` / `onFilesDropped(files)` | See `hostChrome.importAction`. |

Methods on the mounted editor:

```ts
await editor.applyRemoteProject(project, { revision?, keepSelection?, keepPlayhead?, keepZoom? });
editor.seek(seconds); editor.play(); editor.pause(); editor.setZoom(pixelsPerSecond);
await editor.undo(); await editor.redo();
editor.getSelection(); editor.getPlayhead(); editor.focus(); editor.setReadOnly(true);
```

`applyRemoteProject` replaces the open project (for example after the cut
changed on the server) without a reload: one undo step labelled "Remote change",
media the editor already holds is reused and the rest is read from the storage
provider, selection (only items that still exist), playhead and zoom stay unless
the options say `false`, and the dirty state resets.

## Effect and transition previews: `effectPreviewMedia`

The Effects and Transitions libraries animate each card on a preview image. By
default that is a built-in demo still (a face-free landscape with bright sky,
a hot sun and deep shadows, so blur, vignette, chromatic, glitch and colour
effects read clearly); transitions animate between two samples, A (day) and B
(dusk). A "Preview on: Sample | Selected clip" toggle above the cards switches
to the selected clip's frame at the playhead (its filmstrip frame nearest the
playhead, else its poster; the next clip on the track is the incoming side of a
transition). With nothing selected, or a clip without an image, the sample is
used, never another clip. The choice is remembered in `localStorage`
(`openreel-effect-preview-mode`).

```ts
mountEditor(el, {
  effectPreviewMedia: { still: "/files/set/keyframe-1.jpg", stillB: "/files/set/keyframe-2.jpg" },
});
```

`still` replaces the effect sample and the outgoing side of transitions;
`stillB` the incoming side (default: `still`).

## Clip colours, placeholder colours and the Studio theme

Timeline clip colours are CSS tokens defined on the editor root for light and
dark (saturated, dark-friendly defaults, no pale pastels on dark). Override any
of them with `EditorTheme.tokens`:

| Token | Used for |
| --- | --- |
| `--clip-video`, `--clip-image`, `--clip-other` | Gradient fill of video, still and other clips; with `-border` and `-text` |
| `--clip-audio` | Voice and general audio clips; with `-border`, `-text`, `-wave` (waveform) |
| `--clip-music` | Audio on `music` and `ambience` tracks; with `-border`, `-text`, `-wave` |
| `--clip-text`, `--clip-graphic` | Text clips and shape, SVG and sticker clips; with `-border` |
| `--placeholder-bg`, `--placeholder-a`, `--placeholder-b` | Placeholder clips: base and the two stripe colours of the bars/hatch pattern |

A "Studio" theme is not a fourth mode: `EditorTheme.mode` stays
`"light" | "dark" | "auto"`. Studio is dark mode plus the host's tokens, for
example `{ mode: "dark", tokens: { "--bg": "#0b0c10", "--accent": "#ff8a3d", "--clip-video": "linear-gradient(160deg,#2c4a6b,#17283a)" } }`;
switch with `editor.setTheme(...)`.

## WebAssembly files

The beat-detection, FFT and WAV engines load `beat.wasm`, `fft.wasm` and
`wav.wasm` through `new URL("./build/<name>.wasm", import.meta.url)`. Those files
are build output (not committed), so `pnpm --filter @openreel/web build:lib`
builds them first (`@openreel/core build:wasm`, AssemblyScript). Vite then
inlines the three small modules into the bundle as `data:` URLs, so there is
nothing extra to copy or serve and they work from any `basePath`. If the wasm
step is skipped the bundle keeps a relative `./build/*.wasm` path that 404s from
the host and the engines silently fall back to their JavaScript versions.

## Bridge: shared state and RPC

The bridge is a small, versioned channel for state that both sides read and for
calls in both directions. All values are JSON; keys are namespaced; a bundle
with it exports `BRIDGE_VERSION` and `BRIDGE_CAPABILITIES`.

```ts
// the host's side, passed to mountEditor({ bridge })
interface HostBridge {
  get(key: string): unknown;
  set(key: string, value: unknown): Promise<void>;
  subscribe(key: string, cb: (value: unknown) => void): () => void;
  call(method: string, args?: unknown): Promise<unknown>; // editor -> host RPC
}
// the editor's side, editor.bridge
interface EditorBridge {
  readonly version: number;            // BRIDGE_VERSION, now 1
  readonly capabilities: readonly string[]; // "state.get", "state.set", "state.subscribe", "call.tool", "call.capabilities", "ai.thread", "selection", "project.meta", "queue"
  get(key: string): unknown;
  set(key: string, value: unknown): Promise<void>;           // host-owned and shared keys only
  subscribe(key: string, cb: (value: unknown) => void): () => void;
  call(method: "tool" | "capabilities", args?: unknown): Promise<unknown>;
}
```

| Key | Owner | Value |
| --- | --- | --- |
| `ai.config` | host | `{ models?, defaultModel?, systemPromptExtra?, allowedTools?, limits? }` (the editor only reads it) |
| `ai.usage` | editor | `{ model, inputTokens, outputTokens, calls }`, totals since mount |
| `ai.thread` | both | `{ id, role: "user" \| "assistant", text, at? }[]`: ONE conversation. The editor AI panel publishes its messages here; messages the host adds appear in the panel and join the model's context. |
| `session` | host | `{ user?, permissions?, readOnly? }` |
| `selection` | editor | `{ clipIds, items: [{ id, trackId, type }], playhead, shotSeq }` (`shotSeq` from the clip's host metadata `shotSeq`, else `null`) |
| `project.meta` | editor | `{ id, name, revision, dirty, saved, readOnly }` |
| `settings` | host | `{ theme?, locale? }` |
| `queue` | host | staged changes, `{ id, label, status? }[]` |

How it flows:

- **Host-owned keys** (`ai.config`, `session`, `settings`, `queue`, and
  `ai.thread` for the host's part) are read from `options.bridge.get` at mount
  and follow `options.bridge.subscribe`; a host without a channel can push with
  `editor.bridge.set`.
- **Editor-owned keys** (`ai.usage`, `selection`, `project.meta`) are published by
  the editor, readable and subscribable through `editor.bridge`, and mirrored to
  `options.bridge.set`. `editor.bridge.set` on them rejects.
- **Editor to host RPC**: the editor calls `options.bridge.call(method, args)`;
  the methods it uses are listed with each feature (for example
  `queue.action` for the staged-changes tray).
- **Host to editor RPC**: `editor.bridge.call("tool", { name, args })` runs a
  tool from the registry the editor's own AI uses (built-in and host tools, same
  validation and confirmation rules) on the open project and resolves its
  `ToolResult`, so a server-side assistant can move, trim or apply an effect in
  the open editor. `call("capabilities")` returns `{ version, capabilities, keys }`.
  The call goes through the path the editor's AI uses (a draft session, the
  host-tool registry, then one atomic commit), so it is one undo step, the
  action system validates it, a read-only editor refuses it, and a failed tool
  changes nothing.
- **UI steps**: `editor.bridge.call("ui", { action, args })` runs a client-side
  step in the open editor and resolves `{ ok, reason? }`; an unknown action or a
  target that is not on screen gives `ok: false` with a reason, never an
  exception. `editor.bridge.capabilities.ui` lists the actions:

  | action | args |
  | --- | --- |
  | `select_clip` / `select_clips` | `{ id }` / `{ ids }` |
  | `seek` | `{ seconds }` |
  | `play_range` | `{ start, end, loop? }` (plays, then pauses at `end` or loops) |
  | `play_preview` | `{ clipA, clipB, lead? }` (plays the join, `lead` seconds either side, default 1.5) |
  | `set_zoom` | `{ pixelsPerSecond }` |
  | `open_panel` | `{ name: "media" \| "text" \| "graphics" \| "effects" \| "transitions" \| "inspector" }` |
  | `open_inspector_tab` | `{ id }` (a host inspector tab, for a clip it applies to) |
  | `scroll_timeline_to` | `{ clip }` |
  | `highlight` | `{ target: { clip } \| { track } \| { control }, ms? }` (`control` is an aria-label) |
  | `show_toast` | `{ message, kind?: "info" \| "success" \| "warning" \| "error" }` |
  | `focus` | `{ control? }` (an aria-label; default the editor) |

- Unknown keys or methods throw; values that are not JSON throw.
- The events (`onDirtyChange`, `onPlayheadChange`, ...) stay as they are; the
  bridge keys are the same information in subscribable form.

### Hiding upstream configuration

`hostChrome.hide` also takes `"aiSettings"` (the cogwheel in the AI panel; it
stays only when `ai.renderSettings` is given and then shows just the host's
summary and the model picker), `"aiProviders"` (every provider, model id,
base-URL and key field, and the API Keys tab) and `"preferences"` (the General
settings tab and other upstream preferences). Hidden controls are not rendered,
not just invisible.

### Hiding the editor's top bar

`hostChrome.hide: ["header"]` removes the editor's whole top bar (brand, mode
toggle, project title, search, Save and Export) so a host with its own header
shows only that one. The stage and preview take the space, and when embedded the
timeline is sized as a percentage of the editor's own box instead of the
viewport, so all tracks stay inside the editor at any host layout. Finer
hiding (`brand`, `modeToggle`, `search` ...) and a `labels.search` are not built.
The Record button stays hidden with `hide: ["screenRecorder"]`; recordings are
not redirected to the host.

### Hiding the editor's own AI

`hostChrome.hide` also takes `"aiPanel"`: the AI chat panel, its rail button and
the Manual / AI editing toggle are not rendered. The tool registry stays
available through `editor.bridge.call("tool", ...)`, and `selection` and the
playhead are published on the bridge, so a host-rendered assistant can attach
page context and drive the open editor.

## Locked clip groups

A group is a named set of clips (for example a scene) that keeps its chain
intact. Groups are part of the project (`Project.clipGroups`, and
`Clip.groupId` on each member) and are set from the host:

```ts
await editor.setClipGroups([{ id: "scene-1", locked: true, label: "Scene 1", color: "#c2410c", collapsed: false }]);
await editor.setClipGroup(["clipA", "clipB", "clipC"], "scene-1"); // null takes clips out
editor.getClipGroups();
await editor.moveGroup("scene-1", 2.5);   // the whole group by seconds, as one unit
await editor.removeGroup("scene-1");      // every clip of the group, as one unit
mountEditor(el, { events: { onLockedAction: ({ groupId, action }) => offerBreakChain(groupId) } });
```

While a group is `locked`, the action system refuses (error code
`GROUP_LOCKED`, nothing changes, `events.onLockedAction` fires with
`action: "move" | "split" | "trim" | "delete" | "retime"`):

- moving, splitting, deleting (including ripple delete) or retiming (slip, slide,
  roll, trim to playhead, close gap, speed) a single member;
- trimming a boundary that is inside the group (any trim except the first
  member's start and the last member's end).

Allowed: trimming the group's outer start and end, per-clip effects, blend,
volume, colour, and any edit to clips outside the group. `clip/moveGroup` and
`clip/removeGroup` are the unit operations; all group changes are undoable. To
"break the chain" the host unlocks the group with `setClipGroups` and lets the
person retry.

The rules are enforced for every edit that goes through the action system (the
timeline, the AI, host tools and the bridge). On the timeline:

- a band over the group's clips in its colour, with a link icon, the group's name
  and a "locked" text cue (`[data-group-band]`), and a chevron that collapses the
  clips into one block ("Collapse Scene 1" / "Expand Scene 1"; stored in the
  group's `collapsed`, one undo step);
- every member gets a tint line in the group colour and a `not-allowed` cursor
  while the group is locked;
- clicking any member selects the whole group; dragging any member moves the
  whole group as a unit (`clip/moveGroup` on release, never before 0);
- pressing an inside trim handle, splitting inside the group or deleting a
  member is refused: nothing changes, a non-modal hint ("Scene 1 is locked: ...",
  `[data-locked-hint]`) shows for a few seconds, and `events.onLockedAction`
  fires. The group's outer start and end trim as usual.

## Hiding more chrome, and the `search` label

`hostChrome.hide` also takes `"search"` (the search button in the tool rail;
Cmd/Ctrl+K still opens search) and `"brand"` (the "Back to home" block at the top
of the rail, already absent when embedded). `labels.search` replaces the search
button's label and the search box's placeholder, so the box no longer says
"ask AI" when the host hides the AI panel.

## CSS isolation

The library stylesheet (`openreel-editor.css`) is scoped to the editor root:
`vite.lib.config.ts` runs `scopeRootCss({ scopeAll: true })`
(`vite-plugins/scope-root-css.ts`), which rewrites every rule so it can only match
inside `[data-openreel-root]`: Tailwind's preflight (`*`, `button`, `h1` ...), its
utilities (`.flex`, `.hidden`, `.bg-popover` ...), Astryx's reset and theme, the
`[data-theme=...]` and `.dark` rules (applied to the root itself and its
descendants), and the `:root` token blocks (moved onto the root). `html` and `body`
rules are dropped. Menus, popovers and dialogs render inside the root (see the
portal container), so they are covered too. Loading the stylesheet therefore
changes no computed style of any host element; `e2e/host-css.spec.ts` proves it by
comparing every computed property of probe elements that use Tailwind's class
names, before and after the stylesheet and the editor are loaded.

Not scoped: `@keyframes` names are global (rename-free, but a host keyframe of the
same name would be shadowed), and `@font-face` families.

Token precedence: `theme.tokens` are set as inline custom properties on the root
element, which beat the stylesheet's defaults on that same element, so a host's
token always wins and the editor's own `[data-theme]` blocks never override it.
The standalone build (`pnpm build`) is not scoped.

## Layer 2 hooks: inspector, layout, names, guard, export from the host's header

Every option here is optional and its default is the editor's own behaviour.

### The inspector column

```ts
hostPanels: {
  inspector: {
    mode: "replace",            // "tabs" (default): host tabs next to the editor's own properties
    tabs: [{                    // (defaults to hostPanels.inspectorTabs)
      id: "scene", label: "Scene", icon: "S",
      when(selection) { return selection !== null; },   // see HostSelection
      activateOnSelect: true,   // open by itself when a clip it applies to is selected
      mount(el, api) {
        api.selection;                            // HostSelection, a live getter
        api.onSelectionChange((selection) => {}); // not called for the selection it was mounted with
        api.current();                            // the selected clip, or null
        api.onClipChange((clip) => {});           // selection and metadata edits of that clip
        api.updateMetadata({ note: "x" });        // one undo step
        return () => {};
      },
    }],
  },
}
type HostSelection = null | HostClipInfo | HostClipInfo[] | { join: { between: [clipIdA, clipIdB] } };
```

- `mode: "replace"` does not render the editor's own inspector at all; tabs without
  `when` always show. In `tabs` mode a tab without `when` shows for a clip or clips.
- A `join` is a selected transition handle between two clips.
- `hostChrome.hide: ["inspector"]` removes the whole column (the stage takes its width).
- `editor.openInspectorTab(id)` and the bridge `ui` action `open_inspector_tab` open a tab
  as soon as it applies (for up to five seconds). Bundle flag `inspectorReplaceSupported`.

### Per-clip actions

```ts
await editor.updateClip(id, { volume: 0.8, fadeIn: 0.2, fadeOut: 0.4, name: "Scene 2" }); // one undo step
await editor.replaceClipMedia(clipId, mediaId | file | { assetId, name? }, { duration: "keep" | "media" });
await editor.removeClip(id, { ripple: true });
```

`name` is the display name the editor shows instead of the media's file name
(`metadata.host.label`, also set with `setClipMetadata(id, { label })`): the timeline, its
tooltip, the inspector header and `HostClipInfo.label`. `replaceClipMedia` keeps position,
track, transitions and metadata, and the duration (shortened if the media is shorter).

### Layout

```ts
layout: {
  preset: "compact" | "comfortable",   // starting values; explicit fields win
  timelineHeight: "auto" | 42,         // "auto": fit minVisibleTracks; a number is a % of the editor
  minVisibleTracks: 4 | "all",         // rows shrink (never below 40 px) so this many fit in 60% of the editor
  trackHeight: 56,                     // preferred row height, px
  previewMinHeight: 200,               // the stage never gets shorter
  panels: { mediaWidth: 320, inspectorWidth: 300 },
  insets: { bottom: 40, right: 20 },   // empty space inside the root, for UI the host floats over it
  reservedCorners: { bottomRight: { width: 120, height: 60 } }, // no editor control is placed under it
}
```

Bottom corners narrow the timeline panel by their `width`; top corners pad the top bar (or,
with it hidden, the workspace). The timeline scrolls vertically inside its box beyond the
fitted rows. `compact` is 4 tracks at up to 48 px, `comfortable` 4 to 5 at up to 56 px.

### Chrome and words

`hostChrome.hide` also takes `"save"` (the editor has no Save button; Ctrl/Cmd+S still raises
`onSave`), `"export"` (the Export button and its menu), `"saveState"` (the "Saved!" message) and
`"projectMenu"` now also hides the project title. `labels.save`, `labels.export` and
`labels.untitledProject` are applied (the Saved message, the Export button, a new project's name).

With the top bar hidden the host header starts exports itself:

```ts
editor.openExport();        // the primary export target, or the export dialog (bundle flag openExportSupported)
await editor.save();        // like Ctrl/Cmd+S
editor.getSaveState();      // { dirty, saving, savedAt, revision }
```

### Veto an edit: `beforeEdit`

```ts
mountEditor(el, { beforeEdit: (op) => op.type === "clip/split" ? { ok: false, reason: "Not here" } : undefined });
```

Asked before every action (not undo and redo). A veto fails the action with code `HOST_VETO`
and `reason` as its message, and the editor shows `reason` as a notice. A guard that throws
does not stop editing.

### Recording, read-only, stills, viewport

- `hostActions.record(file)` sees a finished recording first; return the file to import (or
  `undefined` for the recording itself). Without it the recording is imported as before.
- Read-only sets `data-readonly` on the root; editing inputs, sliders, switches and the import
  and record buttons in the panels and top bar stop taking input.
- `addPlaceholderClip({ imageCrossOrigin })` sets the CORS mode for `imageUrl` (`null` for none;
  `data:` and `blob:` URLs never need it). Stills no clip uses any more are not saved.
- Bridge key `timeline.viewport` `{ zoom, scrollLeft, scrollTop }` is published by the editor and
  applied when the host sets it, so a host can restore the view.
- Groups: arrow keys move a locked group (0.1 s, Shift 1 s) and a drag shows every member and
  the band following the pointer.

### Defining groups with their members

`setClipGroups([{ id, locked, label, color, clipIds: [...] }])` also assigns the members:
the listed clips get the group id, and every other clip of that group is released (one undo
step). `clipIds` is not stored on the group.

### Behaviour on open

A freshly opened project draws its first frame without play or seek (the editor nudges the
playhead a hair past 0 and back, up to three times, while it is at 0 and not playing).

### CSS names

`@keyframes` and `@font-face` family names in `openreel-editor.css` are prefixed with
`openreel-` (and every use is rewritten), so they cannot collide with the host's.

### Setup that leaves no trace, joins, dirty state

- `editor.batchHostSetup(fn)` runs the host's post-load setup (labels, groups, placeholders) so
  it leaves no undo entries and no unsaved change; it also waits for placeholder work queued
  inside `fn`, and drops every undo entry made while it ran (work queued before the call that
  happens to finish inside it included). `{ history: false }` as the last argument of
  `setClipMetadata`, `updatePlaceholder`, `setClipGroups` and `applyRemoteProject` does the same
  for that one call.
- Dirty state is content-based: the cut, overlays, groups, settings and media list. A bumped
  `modifiedAt` alone (an export, a regenerated thumbnail) is not an unsaved change, and
  `getSaveState().dirty` is live. `onDirtyChange` follows within about 120 ms.
- With host inspector tabs (`hostPanels.inspector` or `inspectorTabs`), the first click on a join
  handle selects it (the selection item id is `join:<clipA>:<clipB>`, published to tabs as
  `{ join: { between } }`); a second click or a double click opens the transition picker.
  Without host inspector tabs a click opens the picker as upstream does.
- The "Relink the original media before exporting" message names clips by their host display
  name (`metadata.host.label`), and is cleared by the editor once nothing is missing any more.

## Rows keep their kind

A clip, group or loaded project never lands on a free row of another kind (a video on the Text row), in projects that carry the universal-tracks capability too.

- Dropping a clip or locked group on an occupied span, or on a row of another kind (Text, Audio), makes a NEW row of the clip's own kind. The new row goes directly above the highest existing row of that kind and below text/graphics rows, which stay on top. Rows are named by kind and count (`Video 2`, `Video 3`, each above the previous). Example order after one drop: `Text, Video 2, Video, Voice, Music`.
- While dragging, the row under the pointer shows a `New video track` indicator (`[data-drop-indicator]`) when the drop makes a new row.
- `clip/moveGroup` takes optional `fromTrackId` and `targetTrackId`: a row's members move together to the target row of the same kind when the span is free, otherwise ALL of them go to one new row of that kind. Undo restores the rows.
- Loading a project, or `applyRemoteProject`, settles clips that overlap on one row: the later clip moves to a new row of the same kind (clips joined by a transition may overlap and stay). Core exports `normalizeLoadedOverlaps`, `createEmptyRow`, `nextRowName`, `topRowIndex`, and `TimelinePlacementRequest.itemType`.
- Unnamed rows are labelled by kind and their place among rows of that kind counted from the bottom (`Video`, `Video 2`), never by list index, so adding rows above does not relabel them. Track headers expose `data-track-name` and `data-track-kind`.
- The plain "Add track" button (and `track/add` without a `name`) names the new row the same way: by kind and count (`Video 2`, `Audio 2`, `Text 2`), never `Track N` and never a label another row already has.

## Editor craft for hosts

Bundle flag: `hostCraftSupported`. Nothing here changes the editor until the host uses it, except the
row names above and waveforms, which now always draw.

### Moving a selection over several rows

Selected clips on several rows dragged up or down move together and keep their relative rows: every
source row shifts by the same offset as the row the grabbed clip goes to. A row's clips land on the
row at that offset when it is of their kind, unlocked and free for all of them; otherwise on a new row
of their kind, made like placement makes rows (directly above the highest row of that kind, below
text, named `Video 3`, ...), one new row per source row so their order stays. One undo step. Store:
`moveTimelineSelection(moves, anchorTrackId, targetTrackId)`. A horizontal-only drag behaves as before.

### Waveforms

Audio clips (voice, music, any audio media) draw their waveform. Peaks are not saved with a project, so
for a reopened or host-loaded project the editor computes them again from the media bytes (once per
media item, not an edit, never an unsaved change). The clip's waveform `<svg>` has
`data-waveform="ready"` once drawn.

### Loudness meter: `meters`

```ts
mountEditor(el, { meters: { loudness: true } });
```

Draws integrated loudness (LUFS, BS.1770-4 / EBU R128 gating) and true peak (dBTP, 4x oversampled) of
the preview mix over the player's top-right corner; the true peak turns red above -1 dBTP. It taps the
preview's master bus after the mixer, so a muted preview reads silence. Click it to start measuring
again. The element is `[data-loudness-meter]` with `data-integrated` and `data-true-peak` (empty until
there is a reading). Off by default.

### Edit locks: rows and clips

```ts
await editor.setTrackLocked(trackId, true);                 // Track.locked, the editor's own row lock
await editor.setClipLocks(clipId, { move: true });          // Clip.locks; { trim: true }; null clears
```

- `Track.locked`: nothing on the row is moved, trimmed, split, slipped, retimed or deleted.
- `Clip.locks.move`: the clip is not moved in time or to another row (drag, keys, the AI's tools,
  `clip/move`, `clip/slide`, group moves, and a ripple delete that would shift it). It does not drag.
- `Clip.locks.trim`: the clip is not trimmed, slipped, rolled, retimed or split. Its edges do not drag.
- A refused edit fails with `CLIP_LOCKED` or `TRACK_LOCKED`. Undo and redo are never refused. Core
  exports `editLockViolation(action, project)`; the undoable action is
  `clip/setLocks { clipId, locks?: { move?, trim? } }`.
- Locks are part of the project: saved, loaded, copied by split and duplicate. `applyRemoteProject`
  keeps them when the incoming project leaves them out (a row without `locked`, a clip without
  `locks`); a value the incoming project states wins, so the host can change them that way too.
  `replacePlaceholder` keeps them. The host's own placeholder changes (`updatePlaceholder` duration,
  proxies) pass `hostEdit: true` and are not refused by clip locks.

### Markers and comments on the ruler

```ts
editor.setMarkers([{ id: "c12", time: 4.2, label: "Colour too warm", color: "#e11d48" }]); // replaces the set
editor.getMarkers();
mountEditor(el, { events: { onMarkerClick(marker) { openComment(marker.id); } } });
```

Host markers are drawn on the ruler (`[data-host-marker="<id>"]`, the label as tooltip and accessible
name, `color` any CSS colour, default the accent). A click moves the playhead there and calls
`events.onMarkerClick(marker)`. They belong to the host: not saved with the project, no undo, never an
unsaved change, untouched by `applyRemoteProject`, cleared on unmount. The editor's own project markers
are unchanged.

### Proxy playback while rendering: `previewUrl`

```ts
const id = editor.addPlaceholderClip({ start: 0, duration: 4, label: "Shot 3", previewUrl: "https://cdn.example/shot3-proxy.mp4" });
editor.updatePlaceholder(id, { previewUrl: animaticUrl });   // a newer proxy
editor.replacePlaceholder(id, finalMediaId);                 // the real media takes over
```

The proxy (a low-res render or an animatic, fetched with CORS; `blob:` URLs work) is imported as
hidden media (`hostGenerated`, not in the Media panel) and the placeholder points at it, keeping its
position, row, length, label and host metadata, so it plays in the preview (and an export) instead of
the still until `replacePlaceholder`. The timeline still draws it as a placeholder. While a proxy is
set, label and pattern changes only redraw the timeline. Make the proxy at least as long as the clip;
it is not looped.
