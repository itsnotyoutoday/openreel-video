// Dev harness: a fake host with in-memory storage and generated media, proving
// each embedding hook against the library build (./lib/openreel-editor.js).
import {
  mountEditor,
  createMemoryStorageProvider,
  executeTool,
  listTools,
} from "./lib/openreel-editor.js";

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
};
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

const media = {
  async list() {
    return [
      { id: "tone", name: "tone.wav", type: "audio", durationSec: 1 },
      { id: "card", name: "card.png", type: "image" },
    ];
  },
  async resolve(id) {
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
  onExport: ({ blob, filename, mimeType }) => {
    state.exports.push({ size: blob.size, filename, mimeType });
    log(`onExport ${filename} ${blob.size} bytes`);
  },
};

function mount(projectId) {
  if (state.editor) return;
  state.editor = mountEditor($("slot"), {
    storage,
    media,
    basePath,
    projectId,
    tools: [hostTool],
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

window.harness = {
  state,
  memory,
  mount,
  unmount,
  hasTool: () => listTools().some((tool) => tool.name === "host_ping"),
  project: () => state.editor?.getProject(),
};

mount();
