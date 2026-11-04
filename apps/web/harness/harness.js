// Dev harness: a fake host with in-memory storage and generated media, proving
// each embedding hook against the library build (./lib/openreel-editor.js).
import {
  mountEditor,
  createMemoryStorageProvider,
  executeTool,
  listTools,
} from "./lib/openreel-editor.js";

// The editor's stylesheet: injected here so a test can load the host page without it (?nocss=1).
if (!new URLSearchParams(location.search).get("nocss")) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./lib/openreel-editor.css";
  document.head.append(link);
}

const $ = (id) => document.getElementById(id);
const logEl = $("log");
const basePath = new URL(".", location.href).pathname;

const state = {
  editor: null,
  storageCalls: [],
  events: [],
  toolCalls: 0,
  exports: [],
  errors: [],
  hostPanels: { replaceMounts: [], menuSelections: [], inspectorMounts: 0, inspectorClips: [], mediaTabMounts: 0, themes: [] },
  warnings: [],
  dirty: [],
  history: [],
  imports: 0,
  dropped: [],
  locked: [],
  recorded: [],
  markerClicks: [],
  exportTarget: { runs: [], sizes: [], aborted: 0 },
};
const query = new URLSearchParams(location.search);
window.addEventListener("error", (event) => state.errors.push(String(event.message)));
window.addEventListener("unhandledrejection", (event) => state.errors.push(String(event.reason)));

function log(line) {
  logEl.textContent += `${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

// ---- fake host storage: the memory provider, with every call recorded -------
const memory = createMemoryStorageProvider();
const storage = new Proxy(memory, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== "function" || typeof prop !== "string") return value;
    if (!["saveProject", "loadProject", "putMedia", "getMedia", "listMedia", "deleteMedia"].includes(prop)) {
      return value.bind(target);
    }
    return (...args) => {
      state.storageCalls.push(prop);
      return value.apply(target, args);
    };
  },
});

// ---- fake host media: generated on demand -----------------------------------
function makeWav(seconds = 1, rate = 8000) {
  const samples = seconds * rate;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 440 * i) / rate) * 12000, true);
  }
  return new File([buffer], "tone.wav", { type: "audio/wav" });
}

async function makePng() {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#c2410c";
  ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = "#fff";
  ctx.font = "32px sans-serif";
  ctx.fillText("card", 110, 100);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new File([blob], "card.png", { type: "image/png" });
}

// A tiny generated video (WebM from a canvas); only where MediaRecorder can encode it (not WebKit).
async function makeWebm() {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const ctx = canvas.getContext("2d");
  const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: "video/webm" });
  const chunks = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const done = new Promise((resolve) => (recorder.onstop = resolve));
  recorder.start();
  for (let i = 0; i < 12; i += 1) {
    ctx.fillStyle = `hsl(${i * 25}, 70%, 45%)`;
    ctx.fillRect(0, 0, 160, 90);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  recorder.stop();
  await done;
  return new File(chunks, "clip.webm", { type: "video/webm" });
}

const media = {
  async list() {
    return [
      { id: "tone", name: "tone.wav", type: "audio", durationSec: 1 },
      { id: "card", name: "card.png", type: "image" },
      { id: "clip", name: "clip.webm", type: "video" },
    ];
  },
  async resolve(id) {
    if (id === "clip") return makeWebm();
    return id === "tone" ? makeWav() : makePng();
  },
};

// ---- a host tool for the in-editor assistant ---------------------------------
const hostTool = {
  name: "host_ping",
  description: "Answers pong. Registered by the harness host.",
  inputSchema: { type: "object", properties: { who: { type: "string" } } },
  readOnly: true,
  handler: (args) => {
    state.toolCalls += 1;
    return { ok: true, summary: `pong ${args.who ?? ""}`.trim() };
  },
};

const events = {
  onDirtyChange: (dirty) => state.dirty.push(dirty),
  onLockedAction: (event) => state.locked.push(event),
  onMarkerClick: (marker) => state.markerClicks.push(marker.id),
  onHistoryChange: (history) => state.history.push(history),
  onImportRequest: () => {
    state.imports += 1;
    log("onImportRequest");
  },
  onFilesDropped: (files) => state.dropped.push(files.map((file) => file.name)),
  onSave: ({ project, revision }) => {
    state.events.push({ type: "save", id: project.id, revision });
    log(`onSave ${project.id} rev ${revision}`);
  },
  onChange: ({ project }) => {
    state.events.push({ type: "change", tracks: project.timeline.tracks.length });
  },
  onSelectionChange: (selection) => {
    state.events.push({ type: "selection", count: selection.length });
  },
  onAiMessage: (message) => state.ai.messages.push(message),
  onToolCall: (call) => state.ai.toolCalls.push(call),
  onExportWarning: (count) => {
    state.warnings.push(count);
    log(`onExportWarning ${count}`);
  },
  onExport: ({ blob, filename, mimeType }) => {
    state.exports.push({ size: blob.size, filename, mimeType });
    log(`onExport ${filename} ${blob.size} bytes`);
  },
};

// ---- host panels: a media tab, an inspector tab and a clip menu item --------
const hostPanels = {
  mediaTabs: [
    {
      id: "fake-library",
      label: "Fake library",
      icon: "L",
      mount(el, api) {
        state.hostPanels.mediaTabMounts += 1;
        el.innerHTML = "";
        el.style.padding = "12px";
        const list = document.createElement("ul");
        list.setAttribute("aria-label", "Fake library assets");
        list.style.cssText = "list-style:none;margin:0;padding:0;display:grid;gap:8px";
        const assets = [
          { id: "tone", name: "tone.wav", kind: "audio", duration: 1 },
          { id: "card", name: "card.png", kind: "image" },
          { id: "clip", name: "clip.webm", kind: "video", duration: 1 },
        ];
        for (const asset of assets) {
          const item = document.createElement("li");
          item.draggable = true;
          item.dataset.assetId = asset.id;
          item.textContent = asset.name;
          item.style.cssText = "padding:10px;border:1px solid var(--border);border-radius:8px;cursor:grab;color:var(--fg);background:var(--bg-2)";
          item.addEventListener("dragstart", (event) => api.setDragData(event, [asset]));
          const add = document.createElement("button");
          add.type = "button";
          add.textContent = `Add ${asset.name}`;
          add.style.marginLeft = "8px";
          add.addEventListener("click", () => {
            api.importAssets([asset.id], { at: 0 }).then(
              (ids) => log(`media tab placed ${ids.join(",")}`),
              (error) => log(`media tab failed ${error}`),
            );
          });
          item.append(add);
          list.append(item);
        }
        el.append(list);
        const off = api.onThemeChange((theme) => state.hostPanels.themes.push(theme.mode ?? null));
        return () => {
          off();
          el.innerHTML = "";
        };
      },
    },
  ],
  inspectorTabs: [
    {
      id: "fake-scene",
      label: "Scene",
      icon: "S",
      when: (clip) => Boolean(clip) && !Array.isArray(clip) && !clip.join && (clip.type === "placeholder" || Boolean(clip.metadata?.shotId)),
      mount(el, api) {
        state.hostPanels.inspectorMounts += 1;
        const label = document.createElement("div");
        label.setAttribute("data-scene-label", "");
        const paint = (clip) => {
          label.textContent = clip ? `Scene ${clip.metadata?.shotId ?? "?"} (${clip.type})${clip.metadata?.reviewed ? " reviewed" : ""}` : "No scene";
          label.dataset.clipId = clip ? clip.id : "";
          if (clip) state.hostPanels.inspectorClips.push(clip.id);
        };
        const save = document.createElement("button");
        save.type = "button";
        save.textContent = "Mark reviewed";
        save.addEventListener("click", () => api.updateMetadata({ reviewed: true }));
        el.append(label, save);
        paint(api.clip);
        const off = api.onClipChange(paint);
        return () => {
          off();
          el.replaceChildren();
        };
      },
    },
  ],
  clipContextMenu: (clip) => [
    {
      id: "fake-open-scene",
      label: "Open scene details",
      onSelect: (target) => state.hostPanels.menuSelections.push(target.id),
      disabled: false,
    },
  ],
};

// ---- host export targets: a primary action and one in another group ----------
function fakeTarget(id, label, group, settings, slow = false) {
  return {
    id,
    label,
    group,
    description: `${label} (fake host)`,
    settings,
    async run({ renderBlob, progress, signal }) {
      state.exportTarget.runs.push({ id, phases: ["rendering"] });
      const run = state.exportTarget.runs.at(-1);
      signal.addEventListener("abort", () => (state.exportTarget.aborted += 1));
      const file = await renderBlob();
      state.exportTarget.sizes.push(file.blob.size);
      run.phases.push("uploading");
      progress({ phase: "uploading", fraction: 0.5 });
      await new Promise((resolve) => setTimeout(resolve, slow ? 4000 : 400));
      if (signal.aborted) return;
      run.phases.push("saving");
      progress({ phase: "saving" });
      return { message: `Saved ${file.filename} to the fake library` };
    },
  };
}
const exportTargets = [
  fakeTarget("library", "Save to library", "primary", { format: "webm", codec: "vp9", width: 320, height: 180, fps: 10, bitrate: 500 }),
  fakeTarget("social", "Vertical for social", "Social", { format: "webm", codec: "vp9", width: 180, height: 320, fps: 10, bitrate: 500 }),
  fakeTarget("slow", "Slow upload", "Social", { format: "webm", codec: "vp9", width: 320, height: 180, fps: 10, bitrate: 500 }, true),
];

// ---- the host's AI: a fake transport (?ai=managed) ---------------------------------------
// One request answers with a tool call (host_ping), the next streams a reply.
state.ai = { requests: 0, usage: [], toolCalls: [], messages: [], externalFetches: [] };
const aiParam = new URLSearchParams(location.search).get("ai");
const nativeFetch = window.fetch.bind(window);
if (aiParam) {
  // Anything fetched outside this page's own origin would be a provider call.
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/^https?:/.test(url) && !url.startsWith(location.origin)) state.ai.externalFetches.push(url);
    return nativeFetch(input, init);
  };
}
const fakeTransport = {
  async send(body, opts) {
    state.ai.requests += 1;
    const usage = { prompt_tokens: 20, completion_tokens: 8 };
    if (state.ai.requests % 2 === 1) {
      return {
        choices: [{ message: { content: "", tool_calls: [{ id: `call-${state.ai.requests}`, type: "function", function: { name: "host_ping", arguments: JSON.stringify({ who: "ai" }) } }] }, finish_reason: "tool_calls" }],
        usage,
      };
    }
    for (const piece of ["Pinged ", "the host."]) {
      opts?.onDelta?.(piece);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { choices: [{ message: { content: "Pinged the host." }, finish_reason: "stop" }], usage };
  },
};
const hostAi = aiParam
  ? {
      transport: fakeTransport,
      managed: aiParam === "managed",
      defaultModel: "host-fast",
      models: async () => [
        { id: "host-fast", label: "Host Fast", note: "Quick edits" },
        { id: "host-smart", label: "Host Smart" },
      ],
      settingsLink: { label: "Open host settings", href: "https://host.example/settings" },
      systemPromptExtra: "Harness host: keep edits short.",
      onUsage: (usage) => state.ai.usage.push(usage),
    }
  : undefined;

function layoutOption() {
  const layout = {};
  if (query.get("layout") === "all") Object.assign(layout, { preset: "compact", minVisibleTracks: "all" });
  else if (query.get("layout")) layout.preset = query.get("layout");
  if (query.get("corner")) layout.reservedCorners = { bottomRight: { width: 120, height: 60 } };
  if (query.get("insets")) layout.insets = { bottom: 40, right: 20 };
  return Object.keys(layout).length ? layout : null;
}

const replaceTabs = [
  {
    id: "project",
    label: "Project",
    when: (selection) => selection === null,
    mount(el, api) {
      state.hostPanels.replaceMounts.push("project");
      el.textContent = "Project (nothing selected)";
      return () => el.replaceChildren();
    },
  },
  {
    id: "item",
    label: "Item",
    when: (selection) => selection !== null,
    mount(el, api) {
      state.hostPanels.replaceMounts.push("item");
      const paint = (selection) => {
        const ids = Array.isArray(selection) ? selection.map((c) => c.id) : selection?.join ? selection.join.between : [selection?.id];
        el.textContent = `Item ${ids.join(",")}`;
      };
      paint(api.selection);
      const off = api.onSelectionChange(paint);
      return () => {
        off();
        el.replaceChildren();
      };
    },
  },
];

function hostChromeOption() {
  const chrome = {};
  if (query.get("exportAction") === "host") chrome.exportAction = "host";
  if (query.get("chrome")) {
    chrome.hide = [...(query.get("noheader") ? ["header"] : []), "projectMenu", "settingsAndApiKeys", "projectJson", "screenRecorder", "localStorageWarnings"];
    chrome.importAction = "host";
  }
  if (query.get("hide")) chrome.hide = [...(chrome.hide ?? []), ...query.get("hide").split(",")];
  return Object.keys(chrome).length ? chrome : null;
}

// ?fill=1: the slot fills the window (the editor is the whole page, as in a host's editor route)
if (query.get("fill")) document.getElementById("slot").style.cssText += "height: calc(100vh - 170px); min-height: 0;";
// ?activate=1: the Scene tab opens by itself when a clip it applies to is selected
if (query.get("activate")) hostPanels.inspectorTabs[0].activateOnSelect = true;

function mount(projectId) {
  if (state.editor) return;
  state.editor = mountEditor($("slot"), {
    storage,
    media,
    basePath,
    projectId,
    tools: [hostTool],
    hostPanels: query.get("inspector") === "replace" ? { ...hostPanels, inspector: { mode: "replace", tabs: replaceTabs } } : hostPanels,
    ...(layoutOption() ? { layout: layoutOption() } : {}),
    ...(query.get("guard")
      ? { beforeEdit: (op) => (op.type === "clip/split" ? { ok: false, reason: "The host does not allow splitting here" } : undefined) }
      : {}),
    ...(query.get("record") ? { hostActions: { record: (file) => { state.recorded.push(file.name); return undefined; } } } : {}),
    ai: hostAi,
    // ?targets=1 mounts with host export targets; ?exportAction=host routes Export to events.onExport.
    ...(query.get("targets") ? { exportTargets } : {}),
    ...(hostChromeOption() ? { hostChrome: hostChromeOption() } : {}),
    // ?chrome=1 also takes over Import (hostChrome.importAction) and renames the button.
    ...(query.get("chrome") ? { labels: { import: "Library" } } : {}),
    ...(query.get("readonly") ? { readOnly: true } : {}),
    // ?meters=1 draws the loudness meter over the player
    ...(query.get("meters") ? { meters: { loudness: true } } : {}),
    events,
    theme: { mode: "light" },
    onboardingTour: false,
    newProject: { name: "Harness project", settings: { width: 1280, height: 720, frameRate: 30 } },
  });
  log(`mounted${projectId ? ` (stored ${projectId})` : ""}`);
}

function unmount() {
  state.editor?.unmount();
  state.editor = null;
  log("unmounted");
}

$("mount").onclick = () => mount();
$("remount-stored").onclick = async () => {
  const [first] = await memory.listProjects();
  if (first) mount(first.id);
};
$("unmount").onclick = unmount;
$("import-tone").onclick = () => state.editor?.importAsset("tone").then(() => log("imported tone"), (e) => log(`import failed ${e}`));
$("import-card").onclick = () => state.editor?.importAsset("card").then(() => log("imported card"), (e) => log(`import failed ${e}`));
$("save").onclick = () => state.editor?.saveProject().then((r) => log(`saved rev ${r.revision}`), (e) => log(`save failed ${e}`));
$("theme-dark").onclick = () => state.editor?.setTheme({ mode: "dark", tokens: { "--accent": "#ff5a36" } });
$("theme-light").onclick = () => state.editor?.setTheme({ mode: "light" });
$("run-tool").onclick = async () => {
  const result = await executeTool("host_ping", { who: "harness" }, {});
  log(`tool: ${result.summary}`);
};

$("add-placeholder").onclick = () => {
  const id = state.editor?.addPlaceholderClip({
    start: 0,
    duration: 3,
    label: "Shot 1",
    pattern: "hatch",
    progress: 0.4,
    metadata: { shotId: "shot-1" },
  });
  state.placeholderId = id;
  log(`placeholder ${id}`);
};
$("swap-placeholder").onclick = async () => {
  if (!state.placeholderId) return;
  const [mediaId] = await state.editor.importAsset("card").then(
    () => state.editor.getProject().mediaLibrary.items.filter((item) => !item.hostGenerated).slice(-1).map((item) => item.id),
  );
  state.editor.replacePlaceholder(state.placeholderId, mediaId);
  log(`swapped ${state.placeholderId} for ${mediaId}`);
};

async function waitForClip(id) {
  for (let i = 0; i < 200; i += 1) {
    if (state.editor.getProject().timeline.tracks.some((track) => track.clips.some((clip) => clip.id === id))) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`clip ${id} never appeared`);
}

window.harness = {
  /** Give a timeline clip a host name (shown instead of the file name). */
  setLabel: (id, label) => state.editor.setClipMetadata(id, { label }),
  selection: () => state.editor?.getSelection().map((item) => item.id),
  seek: (seconds) => state.editor?.seek(seconds),
  /**
   * The shape of a host's server state: a locked series of three consecutive clips with a linked
   * caption clip under each on a second track, defined by ONE setClipGroups call that lists the members.
   */
  makeSeries: async () => {
    const editor = state.editor;
    const main = ["S2", "S3", "S4"].map((label, i) => editor.addPlaceholderClip({ start: i * 2, duration: 2, label }));
    await waitForClip(main[0]);
    const mainTrack = editor.getProject().timeline.tracks.find((t) => t.clips.some((c) => c.id === main[0])).id;
    const rest = main.slice(1).map((_, i) => editor.addPlaceholderClip({ trackId: mainTrack, start: (i + 1) * 2, duration: 2, label: `S${i + 3}` }));
    const firstCaption = editor.addPlaceholderClip({ start: 0, duration: 2, label: "Caption 2" });
    await waitForClip(firstCaption);
    const captionTrack = editor.getProject().timeline.tracks.find((t) => t.clips.some((c) => c.id === firstCaption)).id;
    const moreCaptions = [1, 2].map((i) => editor.addPlaceholderClip({ trackId: captionTrack, start: i * 2, duration: 2, label: `Caption ${i + 2}` }));
    const captions = [firstCaption, ...moreCaptions];
    await waitForClip(captions[2]);
    const ids = [main[0], ...rest, ...captions];
    await editor.setClipGroups([{ id: "series", locked: true, label: "Scenes 2-4", color: "#2563eb", clipIds: ids }]);
    return ids;
  },
  /** A video track with a clip, and a text row that is free where the video will be dropped. */
  makeVideoAndTextRows: async () => {
    const editor = state.editor;
    const video = editor.addPlaceholderClip({ start: 0, duration: 4, label: "Existing" });
    await waitForClip(video);
    return editor.getProject().timeline.tracks.find((t) => t.clips.some((c) => c.id === video)).id;
  },
  /** Three placeholders in a row on one track, in a locked group "Scene 1". Returns their ids. */
  makeGroup: async () => {
    const first = state.editor.addPlaceholderClip({ start: 0, duration: 2, label: "S1 A" });
    await waitForClip(first);
    const trackId = state.editor.getProject().timeline.tracks.find((t) => t.clips.some((c) => c.id === first)).id;
    const second = state.editor.addPlaceholderClip({ trackId, start: 2, duration: 2, label: "S1 B" });
    const third = state.editor.addPlaceholderClip({ trackId, start: 4, duration: 2, label: "S1 C" });
    await waitForClip(third);
    await state.editor.setClipGroups([{ id: "g1", locked: true, label: "Scene 1", color: "#c2410c" }]);
    await state.editor.setClipGroup([first, second, third], "g1");
    return [first, second, third];
  },
  /**
   * Rows the way a host lays them out: Text on top, then video, then Voice and Music (audio).
   * "stack": one video row "Video" holding S1..S3 (2 s each, in a locked group "g1" when `grouped`).
   * "occupied": a second video row "Video 2" above it holds a long clip over where the group will land.
   * "overlap": two video clips that overlap in time on ONE row, loaded in one project.
   */
  makeRows: async (scenario, grouped = false) => {
    const editor = state.editor;
    const first = editor.addPlaceholderClip({ start: 0, duration: 2, label: "S1" });
    await waitForClip(first);
    const videoId = editor.getProject().timeline.tracks.find((t) => t.clips.some((c) => c.id === first)).id;
    const ids = [first];
    if (scenario === "overlap") {
      ids.push(editor.addPlaceholderClip({ trackId: videoId, start: 2, duration: 2, label: "S2" }));
    } else {
      ids.push(editor.addPlaceholderClip({ trackId: videoId, start: 2, duration: 2, label: "S2" }));
      ids.push(editor.addPlaceholderClip({ trackId: videoId, start: 4, duration: 2, label: "S3" }));
    }
    await waitForClip(ids[ids.length - 1]);
    let longId = null;
    if (scenario === "occupied") {
      longId = editor.addPlaceholderClip({ start: 10, duration: 6, label: "Long" });
      await waitForClip(longId);
    }
    const remote = JSON.parse(JSON.stringify(editor.getProject()));
    const row = (id, type, name, clips = []) => ({ id, type, name, clips, transitions: [], locked: false, hidden: false, muted: false, solo: false });
    const video = remote.timeline.tracks.find((t) => t.id === videoId);
    video.name = "Video";
    video.type = "video"; // placeholders sit on an image row; a host lays out video rows
    const rows = [row("row-text", "text", "Text")];
    if (longId) {
      const upper = remote.timeline.tracks.find((t) => t.clips.some((c) => c.id === longId));
      upper.name = "Video 2";
      upper.type = "video";
      rows.push(upper);
    }
    rows.push(video, row("row-voice", "audio", "Voice"), row("row-music", "audio", "Music"));
    if (scenario === "overlap") {
      // the second clip overlaps the first on the same row, as a loaded project may carry them
      video.clips[1].startTime = 1;
    }
    remote.timeline.tracks = rows;
    if (grouped) {
      remote.clipGroups = [{ id: "g1", locked: true, label: "Scene 1", color: "#c2410c" }];
      for (const clip of video.clips) clip.groupId = "g1";
    }
    await editor.applyRemoteProject(remote, { revision: "1" });
    return { ids, longId, videoId };
  },
  setReadOnly: (on) => state.editor?.setReadOnly(on),
  /** A blob: URL of a tiny generated video, for a placeholder's previewUrl. */
  makeVideoUrl: async () => URL.createObjectURL(await makeWebm()),
  /** Import the tone and put it on the timeline (a placeholder replaced by it); resolves with the clip id. */
  makeToneClip: async (start = 0) => {
    const editor = state.editor;
    const before = new Set(editor.getProject().mediaLibrary.items.map((item) => item.id));
    await editor.importAsset("tone");
    const tone = editor.getProject().mediaLibrary.items.find((item) => !before.has(item.id));
    const id = editor.addPlaceholderClip({ start, duration: 1, label: "Tone" });
    await waitForClip(id);
    editor.replacePlaceholder(id, tone.id);
    for (let i = 0; i < 200; i += 1) {
      const clip = editor.getProject().timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
      if (clip && clip.mediaId === tone.id) return id;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("the tone never replaced the placeholder");
  },
  /** Replace the cut from "the server": the same project without its first clip, renamed. */
  applyRemote: async (name) => {
    const remote = JSON.parse(JSON.stringify(state.editor.getProject()));
    const track = remote.timeline.tracks.find((t) => t.clips.length > 0);
    if (track) track.clips = track.clips.slice(1);
    remote.name = name;
    await state.editor.applyRemoteProject(remote, { revision: "9" });
  },
  state,
  memory,
  mount,
  unmount,
  hasTool: () => listTools().some((tool) => tool.name === "host_ping"),
  project: () => state.editor?.getProject(),
};

if (!query.get("nomount")) mount();
