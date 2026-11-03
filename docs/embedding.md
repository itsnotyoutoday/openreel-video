# Embedding the editor in a host application

OpenReel can be mounted into any page, with the host supplying storage, media,
agent tools and (see the sections below) theme and events. Nothing here is
specific to one host. With no options the standalone app behaves exactly as it
always did.

```ts
import { mountEditor } from "@openreel/web/embed";

const editor = mountEditor(document.getElementById("slot")!, {
  storage, // StorageProvider (optional)
  media, // HostMediaSource (optional)
  tools, // HostToolDefinition[] (optional)
  projectId: "p1", // open a stored project, else a new one
});

editor.unmount();
```

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

## Keyboard shortcuts

When embedded, shortcuts react only to key events that originate inside the
editor root (which is focusable and focused on mount). Keys pressed elsewhere
on the page do nothing. Ctrl/Cmd+K (search) is scoped the same way.
