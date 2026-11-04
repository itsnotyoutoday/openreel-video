import { useNotificationStore } from "../stores/notification-store";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { getHostRuntime } from "./host-runtime";
import { requestInspectorTab } from "./host-state";
import { hostClipInfo } from "./host-clips";

/** What a UI action returns. `reason` says why `ok` is false. */
export interface UiResult {
  readonly ok: boolean;
  readonly reason?: string;
}

type Args = Record<string, unknown>;
type UiAction = (args: Args) => UiResult | Promise<UiResult>;

const ok: UiResult = { ok: true };
const fail = (reason: string): UiResult => ({ ok: false, reason });

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const str = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

function root(): HTMLElement | null {
  return getHostRuntime()?.root ?? null;
}

function clipRange(id: string): { start: number; end: number; trackId: string } | null {
  const info = hostClipInfo(useProjectStore.getState().project, id);
  return info ? { start: info.start, end: info.start + info.duration, trackId: info.trackId } : null;
}

function selectionItem(id: string) {
  const info = hostClipInfo(useProjectStore.getState().project, id);
  if (!info) return null;
  return {
    type: info.type === "text" ? ("text-clip" as const) : ("clip" as const),
    id,
    trackId: info.trackId,
  };
}

let stopRange: (() => void) | null = null;

/** Play `[start, end]`, then pause (or jump back to `start` when `loop`). */
function playRange(start: number, end: number, loop: boolean): void {
  stopRange?.();
  const timeline = useTimelineStore.getState();
  timeline.seekTo(start);
  timeline.play();
  const off = useTimelineStore.subscribe(
    (state) => state.playheadPosition,
    (position) => {
      if (position < end) return;
      if (loop) {
        useTimelineStore.getState().seekTo(start);
      } else {
        useTimelineStore.getState().pause();
        off();
        stopRange = null;
      }
    },
  );
  stopRange = off;
}

const PANELS: Record<string, string> = {
  media: "Media",
  text: "Text",
  graphics: "Graphics",
  effects: "Effects",
  transitions: "Transitions",
};

function control(name: string): HTMLElement | null {
  const el = root();
  if (!el) return null;
  return (
    [...el.querySelectorAll<HTMLElement>("[aria-label], [data-host-tab]")].find(
      (node) => node.getAttribute("aria-label") === name || node.dataset.hostTab === name,
    ) ?? null
  );
}

function highlightTarget(target: Args): HTMLElement | null {
  const el = root();
  if (!el) return null;
  const clip = str(target.clip);
  if (clip) return el.querySelector<HTMLElement>(`[data-clip-id="${CSS.escape(clip)}"]`);
  const track = str(target.track);
  if (track) return el.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(track)}"]`);
  const name = str(target.control);
  return name ? control(name) : null;
}

/** The host-callable UI actions, by name. */
const ACTIONS: Record<string, UiAction> = {
  select_clip(args) {
    const id = str(args.id);
    const item = id ? selectionItem(id) : null;
    if (!item) return fail("No such clip");
    useUIStore.getState().select(item);
    return ok;
  },
  select_clips(args) {
    const ids = Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === "string") : [];
    const items = ids.map(selectionItem).filter((item): item is NonNullable<typeof item> => item !== null);
    if (items.length === 0) return fail("None of the clips exist");
    useUIStore.getState().selectMultiple(items);
    return ok;
  },
  seek(args) {
    const seconds = num(args.seconds);
    if (seconds === null) return fail("seconds must be a number");
    useTimelineStore.getState().seekTo(seconds);
    return ok;
  },
  play_range(args) {
    const start = num(args.start);
    const end = num(args.end);
    if (start === null || end === null || end <= start) return fail("start and end must be numbers with end after start");
    playRange(Math.max(0, start), end, args.loop === true);
    return ok;
  },
  set_zoom(args) {
    const level = num(args.pixelsPerSecond ?? args.level);
    if (level === null || level <= 0) return fail("pixelsPerSecond must be a positive number");
    useTimelineStore.getState().setZoom(level);
    return ok;
  },
  open_panel(args) {
    const name = str(args.name ?? args.panel);
    if (name === "inspector") {
      useUIStore.getState().setPanelVisible("inspector", true);
      return ok;
    }
    const label = name ? PANELS[name] : undefined;
    if (!label) return fail(`Unknown panel; try ${Object.keys(PANELS).join(", ")}, inspector`);
    const button = control(label);
    if (!button) return fail("The panel's button is not on screen");
    button.click();
    return ok;
  },
  open_inspector_tab(args) {
    const id = str(args.id);
    if (!id) return fail("id is required");
    const panels = getHostRuntime()?.options.hostPanels;
    const known = [...(panels?.inspector?.tabs ?? []), ...(panels?.inspectorTabs ?? [])].some((tab) => tab.id === id);
    if (!known) return fail(`No host inspector tab "${id}"`);
    requestInspectorTab(id);
    return ok;
  },
  scroll_timeline_to(args) {
    const id = str(args.clip);
    const range = id ? clipRange(id) : null;
    if (!range) return fail("No such clip");
    const scroller = root()?.querySelector<HTMLElement>('[data-testid="timeline-tracks-scroll"]');
    if (!scroller) return fail("The timeline is not on screen");
    const left = range.start * useTimelineStore.getState().pixelsPerSecond;
    scroller.scrollTo({ left: Math.max(0, left - 60) });
    return ok;
  },
  highlight(args) {
    const target = highlightTarget(typeof args.target === "object" && args.target ? (args.target as Args) : args);
    if (!target) return fail("Nothing on screen matches");
    const ms = num(args.ms) ?? 1500;
    const previous = { outline: target.style.outline, offset: target.style.outlineOffset };
    target.style.outline = "3px solid var(--accent, #ff5a36)";
    target.style.outlineOffset = "2px";
    setTimeout(() => {
      target.style.outline = previous.outline;
      target.style.outlineOffset = previous.offset;
    }, Math.min(ms, 10_000));
    return ok;
  },
  show_toast(args) {
    const message = str(args.message);
    if (!message) return fail("message is required");
    const kind = ["info", "success", "warning", "error"].includes(String(args.kind)) ? String(args.kind) : "info";
    useNotificationStore.getState().addNotification({
      type: kind as "info" | "success" | "warning" | "error",
      title: message,
      duration: 4000,
    });
    return ok;
  },
  focus(args) {
    const name = str(args.control);
    const el = name ? control(name) : root();
    if (!el) return fail("Nothing on screen matches");
    el.focus({ preventScroll: false });
    return ok;
  },
  play_preview(args) {
    const a = str(args.clipA);
    const b = str(args.clipB);
    const second = b ? clipRange(b) : null;
    const first = a ? clipRange(a) : null;
    if (!first || !second) return fail("Both clips must exist");
    const join = second.start;
    const lead = num(args.lead) ?? 1.5;
    playRange(Math.max(0, join - lead), join + lead, false);
    return ok;
  },
};

export const UI_ACTIONS: readonly string[] = Object.keys(ACTIONS);

/** Run one UI action; never throws. Unknown actions return `{ ok: false, reason }`. */
export async function runUiAction(action: unknown, args: unknown): Promise<UiResult> {
  if (typeof action !== "string") return fail("action must be a string");
  const handler = ACTIONS[action];
  if (!handler) return fail(`Unknown ui action "${action}"; known: ${UI_ACTIONS.join(", ")}`);
  try {
    return await handler(args && typeof args === "object" ? (args as Args) : {});
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
