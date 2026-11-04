import { type LoopMessage } from "@openreel/agent";
import { executeEditingTool } from "../services/agent/editing-tools";
import { EditingSession } from "../services/agent/editing-session";
import { runExclusive } from "../services/agent/host-singleton";
import { executeWithHostTools } from "../services/agent/host-tools";
import { runUiAction, UI_ACTIONS } from "./bridge-ui";
import { useChatStore, type ChatMessage } from "../stores/chat-store";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { hostClipInfo } from "./host-clips";
import { getHostRuntime } from "./host-runtime";
import type { HostBridge } from "./types";

/** Bump when a key's shape changes incompatibly. */
export const BRIDGE_VERSION = 1;

/**
 * The namespaced keys the editor and a host share. Values are JSON.
 *
 * | key | owner | value |
 * | --- | --- | --- |
 * | `ai.config` | host | `{ models?, defaultModel?, systemPromptExtra?, allowedTools?, limits? }` |
 * | `ai.usage` | editor | `{ model, inputTokens, outputTokens, calls }` totals since mount |
 * | `ai.thread` | both | `{ id, role: 'user'|'assistant', text, at? }[]`, one conversation |
 * | `session` | host | `{ user?, permissions?, readOnly? }` |
 * | `selection` | editor | `{ clipIds, items, playhead, shotSeq }` |
 * | `project.meta` | editor | `{ id, name, revision, dirty, saved, readOnly }` |
 * | `settings` | host | `{ theme?, locale? }` |
 * | `queue` | host | staged changes, `{ id, label, status? }[]` |
 */
export const BRIDGE_KEYS = [
  "ai.config",
  "ai.usage",
  "ai.thread",
  "session",
  "selection",
  "project.meta",
  "settings",
  "queue",
  "timeline.viewport",
] as const;
export type BridgeKey = (typeof BRIDGE_KEYS)[number];

const EDITOR_OWNED = new Set<string>(["ai.usage", "selection", "project.meta"]);
const HOST_OWNED = ["ai.config", "session", "settings", "queue", "ai.thread", "timeline.viewport"] as const;

/** The list of features, with the available `ui` actions as `capabilities.ui`. */
export type BridgeCapabilities = readonly string[] & { readonly ui: readonly string[] };

const CAPABILITY_NAMES: readonly string[] = [
  "state.get",
  "state.set",
  "state.subscribe",
  "call.tool",
  "call.ui",
  "call.capabilities",
  "ai.thread",
  "selection",
  "project.meta",
  "queue",
];

export const BRIDGE_CAPABILITIES: BridgeCapabilities = Object.assign([...CAPABILITY_NAMES], {
  ui: UI_ACTIONS,
});

type Json = unknown;

function clone(value: Json): Json {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Json;
  } catch {
    throw new Error("Bridge values must be JSON serializable");
  }
}

function assertKey(key: string): asserts key is BridgeKey {
  if (!(BRIDGE_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Unknown bridge key "${key}"; known keys: ${BRIDGE_KEYS.join(", ")}`);
  }
}

/** What the host sees as `editor.bridge`. */
export interface EditorBridge {
  readonly version: number;
  readonly capabilities: BridgeCapabilities;
  get(key: string): Json;
  set(key: string, value: Json): Promise<void>;
  subscribe(key: string, cb: (value: Json) => void): () => void;
  /**
   * Host to editor RPC.
   * - `call('tool', { name, args })` runs a tool the way the editor's own AI
   *   does: built-in and host tools, one undoable step, validation and the
   *   same refusals; resolves the tool's result.
   * - `call('ui', { action, args })` runs a UI step in the open editor
   *   (`capabilities.ui` lists them) and resolves `{ ok, reason? }`.
   * - `call('capabilities')` lists features.
   */
  call(method: string, args?: Json): Promise<Json>;
}

export interface BridgeController {
  readonly bridge: EditorBridge;
  /** Editor-side publish of an editor-owned key (mirrors to the host's bridge). */
  publish(key: BridgeKey, value: Json): void;
  /** Editor-side merge into an object-valued editor-owned key. */
  patch(key: BridgeKey, patch: Record<string, Json>): void;
  /** Editor-side read: the value set through `editor.bridge`, else the host bridge's. */
  read(key: BridgeKey): Json;
  /** Editor to host RPC through the host's bridge; rejects when the host gave none. */
  callHost(method: string, args?: Json): Promise<Json>;
  dispose(): void;
}

function mirror(host: HostBridge | undefined, key: string, value: Json): void {
  if (!host) return;
  host.set(key, value).catch((error: unknown) => {
    console.error(`[OpenReel] bridge.set("${key}") failed:`, error);
  });
}

/**
 * The state-sharing layer between the editor and its host. Keys the host owns
 * are read from the host's `bridge` option (and follow its `subscribe`) or set
 * through `editor.bridge.set`; keys the editor owns are published here and
 * mirrored to the host's bridge. `ai.thread` is shared: the editor AI panel
 * and the host assistant read and append to one conversation.
 */
export function createBridge(hostBridge: HostBridge | undefined): BridgeController {
  const values = new Map<string, Json>();
  const listeners = new Map<string, Set<(value: Json) => void>>();
  const cleanups: Array<() => void> = [];

  const notify = (key: string) => {
    const value = values.get(key);
    for (const listener of [...(listeners.get(key) ?? [])]) {
      try {
        listener(clone(value));
      } catch (error) {
        console.error(`[OpenReel] A bridge listener for "${key}" failed:`, error);
      }
    }
  };

  const store = (key: string, value: Json): boolean => {
    const next = clone(value);
    if (JSON.stringify(values.get(key)) === JSON.stringify(next) && values.has(key)) return false;
    values.set(key, next);
    notify(key);
    return true;
  };

  // Keys the host owns follow the host's own channel.
  for (const key of HOST_OWNED) {
    if (!hostBridge) break;
    try {
      const initial = hostBridge.get(key);
      if (initial !== undefined) values.set(key, clone(initial));
      cleanups.push(
        hostBridge.subscribe(key, (value) => {
          store(key, value);
        }),
      );
    } catch (error) {
      console.error(`[OpenReel] bridge.get/subscribe("${key}") failed:`, error);
    }
  }

  const read = (key: BridgeKey): Json => {
    if (values.has(key)) return clone(values.get(key));
    try {
      return hostBridge ? clone(hostBridge.get(key)) : undefined;
    } catch {
      return undefined;
    }
  };

  const publish = (key: BridgeKey, value: Json) => {
    if (store(key, value)) mirror(hostBridge, key, clone(value));
  };

  const bridge: EditorBridge = {
    version: BRIDGE_VERSION,
    capabilities: BRIDGE_CAPABILITIES,
    get(key) {
      assertKey(key);
      return read(key);
    },
    async set(key, value) {
      assertKey(key);
      if (EDITOR_OWNED.has(key)) {
        throw new Error(`"${key}" is published by the editor and read-only for the host`);
      }
      store(key, value);
    },
    subscribe(key, cb) {
      assertKey(key);
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(cb);
      return () => {
        set?.delete(cb);
      };
    },
    async call(method, args) {
      if (method === "capabilities") {
        return {
          version: BRIDGE_VERSION,
          capabilities: [...BRIDGE_CAPABILITIES],
          ui: [...BRIDGE_CAPABILITIES.ui],
          keys: [...BRIDGE_KEYS],
        };
      }
      if (method === "tool") {
        const { name, args: toolArgs } = (args ?? {}) as { name?: unknown; args?: unknown };
        if (typeof name !== "string" || !name) throw new Error("call('tool') needs { name, args }");
        if (!useProjectStore.getState().hasOpenProject) throw new Error("No project is open");
        // The same path as a chat turn: a draft session, the host-tool registry, the editing
        // tools, then one atomic commit (one undo step, validated by the action system).
        const result = await runExclusive(async () => {
          const session = new EditingSession();
          const handle = session.beginTransaction();
          try {
            const outcome = await executeWithHostTools(
              name,
              (toolArgs ?? {}) as Record<string, unknown>,
              session,
              executeEditingTool,
            );
            if (!outcome.ok) {
              await session.rollbackTransaction();
              return outcome;
            }
            await session.commitTransaction(handle, `Assistant: ${name}`);
            return outcome;
          } catch (error) {
            await session.rollbackTransaction();
            return {
              ok: false,
              summary: "The tool could not run",
              error: { code: "TOOL_FAILED", message: error instanceof Error ? error.message : String(error) },
            };
          }
        });
        return clone(result);
      }
      if (method === "ui") {
        const { action, args: uiArgs } = (args ?? {}) as { action?: unknown; args?: unknown };
        return runUiAction(action, uiArgs);
      }
      throw new Error(`Unknown bridge method "${method}"`);
    },
  };

  // ---- editor-owned keys -------------------------------------------------------------------
  const publishSelection = () => {
    const ui = useUIStore.getState();
    const project = useProjectStore.getState().project;
    const items = ui.selectedItems.map(({ id, trackId, type }) => ({ id, trackId, type }));
    const first = ui.selectedItems.map((item) => hostClipInfo(project, item.id)).find(Boolean);
    const seq = first?.metadata?.shotSeq;
    publish("selection", {
      clipIds: items.map((item) => item.id),
      items,
      playhead: useTimelineStore.getState().playheadPosition,
      shotSeq: typeof seq === "number" ? seq : null,
    });
  };
  publishSelection();
  let playheadTimer: ReturnType<typeof setTimeout> | null = null;
  cleanups.push(
    useUIStore.subscribe((state) => state.selectedItems, publishSelection),
    useTimelineStore.subscribe(
      (state) => state.playheadPosition,
      () => {
        if (playheadTimer) return;
        playheadTimer = setTimeout(() => {
          playheadTimer = null;
          publishSelection();
        }, 100);
      },
    ),
    () => {
      if (playheadTimer) clearTimeout(playheadTimer);
    },
  );

  // ---- the timeline's view: zoom and scroll, so a host can restore it ----------------------------
  const scroller = () =>
    getHostRuntime()?.root.querySelector<HTMLElement>('[data-testid="timeline-tracks-scroll"]') ?? null;
  const publishViewport = () => {
    const element = scroller();
    publish("timeline.viewport", {
      zoom: useTimelineStore.getState().pixelsPerSecond,
      scrollLeft: Math.round(element?.scrollLeft ?? 0),
      scrollTop: Math.round(element?.scrollTop ?? 0),
    });
  };
  publishViewport();
  let viewportTimer: ReturnType<typeof setTimeout> | null = null;
  const onScroll = (event: Event) => {
    if ((event.target as HTMLElement | null)?.dataset?.testid !== "timeline-tracks-scroll" || viewportTimer) return;
    viewportTimer = setTimeout(() => {
      viewportTimer = null;
      publishViewport();
    }, 100);
  };
  const viewportRoot = getHostRuntime()?.root;
  viewportRoot?.addEventListener("scroll", onScroll, true);
  cleanups.push(
    useTimelineStore.subscribe((state) => state.pixelsPerSecond, publishViewport),
    () => viewportRoot?.removeEventListener("scroll", onScroll, true),
    () => {
      if (viewportTimer) clearTimeout(viewportTimer);
    },
  );
  // a viewport the host sets (or its channel pushes) is applied to the timeline
  const adoptViewport = (value: Json) => {
    if (!value || typeof value !== "object") return;
    const { zoom, scrollLeft, scrollTop } = value as { zoom?: unknown; scrollLeft?: unknown; scrollTop?: unknown };
    if (typeof zoom === "number" && zoom > 0 && Math.abs(zoom - useTimelineStore.getState().pixelsPerSecond) > 1e-6) {
      useTimelineStore.getState().setZoom(zoom);
    }
    const element = scroller();
    if (element && typeof scrollLeft === "number" && Math.abs(element.scrollLeft - scrollLeft) > 1) element.scrollLeft = scrollLeft;
    if (element && typeof scrollTop === "number" && Math.abs(element.scrollTop - scrollTop) > 1) element.scrollTop = scrollTop;
  };
  const viewportListeners = (listeners.get("timeline.viewport") ?? new Set()) as Set<(v: Json) => void>;
  listeners.set("timeline.viewport", viewportListeners);
  viewportListeners.add(adoptViewport);

  // ---- the shared AI thread ------------------------------------------------------------------
  interface ThreadMessage {
    id: string;
    role: "user" | "assistant";
    text: string;
    at?: number;
  }
  const toThread = (messages: readonly ChatMessage[]): ThreadMessage[] =>
    messages.map(({ id, role, text }) => ({ id, role, text }));
  const publishThread = (messages: readonly ChatMessage[]) => {
    const thread = toThread(messages);
    // keep host-supplied timestamps for messages we already know
    const known = new Map(
      ((values.get("ai.thread") as ThreadMessage[] | undefined) ?? []).map((m) => [m.id, m]),
    );
    const merged = thread.map((m) => ({ ...m, ...(known.get(m.id)?.at ? { at: known.get(m.id)?.at } : {}) }));
    if (store("ai.thread", merged)) mirror(hostBridge, "ai.thread", clone(merged));
  };
  publishThread(useChatStore.getState().messages);
  cleanups.push(
    useChatStore.subscribe((state, previous) => {
      if (state.messages !== previous.messages) publishThread(state.messages);
    }),
  );
  // Messages the host adds to `ai.thread` appear in the editor's AI panel and join the model's context.
  const adoptHostMessages = (value: Json) => {
    if (!Array.isArray(value)) return;
    const chat = useChatStore.getState();
    const have = new Set(chat.messages.map((m) => m.id));
    const added = (value as ThreadMessage[]).filter(
      (m) => m && typeof m.id === "string" && !have.has(m.id) && typeof m.text === "string" && (m.role === "user" || m.role === "assistant"),
    );
    if (added.length === 0) return;
    useChatStore.setState({
      messages: [
        ...chat.messages,
        ...added.map((m): ChatMessage => ({ id: m.id, role: m.role, text: m.text, toolCalls: [] })),
      ],
      conversation: [
        ...chat.conversation,
        ...added.map(
          (m): LoopMessage =>
            m.role === "user"
              ? { role: "user", content: m.text }
              : { role: "assistant", content: m.text, toolUses: [] },
        ),
      ],
    });
  };
  const threadListeners = (listeners.get("ai.thread") ?? new Set()) as Set<(v: Json) => void>;
  listeners.set("ai.thread", threadListeners);
  threadListeners.add(adoptHostMessages);
  adoptHostMessages(values.get("ai.thread"));

  return {
    bridge,
    publish,
    patch(key, patch) {
      const current = read(key);
      publish(key, { ...((current && typeof current === "object" ? current : {}) as Record<string, Json>), ...patch });
    },
    read,
    async callHost(method, args) {
      if (!hostBridge) throw new Error("The host passed no bridge");
      return hostBridge.call(method, args);
    },
    dispose() {
      cleanups.splice(0).forEach((cleanup) => cleanup());
      listeners.clear();
      values.clear();
    },
  };
}
