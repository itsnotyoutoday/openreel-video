// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorageProvider } from "@openreel/core";
import { registerTool } from "@openreel/agent";

import { setStorageProvider } from "../services/storage/storage-context";
import { useChatStore } from "../stores/chat-store";
import { useProjectStore } from "../stores/project-store";
import { useUIStore } from "../stores/ui-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useNotificationStore } from "../stores/notification-store";
import { BRIDGE_CAPABILITIES, BRIDGE_KEYS, BRIDGE_VERSION, createBridge } from "./bridge";
import { createPlaceholderController } from "./placeholders";
import type { HostBridge } from "./types";

function fakeHostBridge(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const host: HostBridge & { values: Map<string, unknown>; push(key: string, value: unknown): void; calls: unknown[] } = {
    values,
    calls: [],
    get: (key) => values.get(key),
    async set(key, value) {
      values.set(key, value);
    },
    subscribe(key, cb) {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(cb);
      return () => set.delete(cb);
    },
    async call(method, args) {
      host.calls.push({ method, args });
      return { ok: true };
    },
    push(key, value) {
      values.set(key, value);
      for (const cb of listeners.get(key) ?? []) cb(value);
    },
  };
  return host;
}

beforeEach(() => {
  setStorageProvider(createMemoryStorageProvider());
  useProjectStore.getState().createNewProject("Bridge", { width: 1280, height: 720, frameRate: 30 });
  useChatStore.getState().reset();
});

afterEach(() => {
  setStorageProvider(null);
  useUIStore.getState().clearSelection();
});

describe("bridge state", () => {
  it("has a version, capabilities and the agreed keys", () => {
    const { bridge, dispose } = createBridge(undefined);
    expect(bridge.version).toBe(BRIDGE_VERSION);
    expect(bridge.capabilities).toEqual(BRIDGE_CAPABILITIES);
    expect(BRIDGE_KEYS).toEqual([
      "ai.config",
      "ai.usage",
      "ai.thread",
      "session",
      "selection",
      "project.meta",
      "settings",
      "queue",
      "timeline.viewport",
    ]);
    dispose();
  });

  it("round-trips a host-owned key through set, get and subscribe", async () => {
    const { bridge, dispose } = createBridge(undefined);
    const seen: unknown[] = [];
    const off = bridge.subscribe("settings", (value) => seen.push(value));
    await bridge.set("settings", { theme: "dark", locale: "en" });
    expect(bridge.get("settings")).toEqual({ theme: "dark", locale: "en" });
    expect(seen).toEqual([{ theme: "dark", locale: "en" }]);
    // a copy: changing what you got does not change the bridge
    (bridge.get("settings") as { theme: string }).theme = "light";
    expect((bridge.get("settings") as { theme: string }).theme).toBe("dark");
    off();
    await bridge.set("settings", { theme: "light" });
    expect(seen).toHaveLength(1);
    dispose();
  });

  it("rejects unknown keys, editor-owned keys and values that are not JSON", async () => {
    const { bridge, dispose } = createBridge(undefined);
    await expect(bridge.set("nope", 1)).rejects.toThrow(/Unknown bridge key/);
    await expect(bridge.set("selection", {})).rejects.toThrow(/read-only for the host/);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(bridge.set("queue", circular)).rejects.toThrow(/JSON/);
    expect(() => bridge.get("nope")).toThrow(/Unknown bridge key/);
    dispose();
  });

  it("reads and follows host-owned keys on the host's own channel, and mirrors editor-owned keys to it", async () => {
    const host = fakeHostBridge({ session: { user: "u1", readOnly: false } });
    const { bridge, publish, dispose } = createBridge(host);
    expect(bridge.get("session")).toEqual({ user: "u1", readOnly: false });
    const seen: unknown[] = [];
    bridge.subscribe("queue", (value) => seen.push(value));
    host.push("queue", [{ id: "q1", label: "Trim shot 2" }]);
    expect(seen).toEqual([[{ id: "q1", label: "Trim shot 2" }]]);

    publish("project.meta", { id: "p", dirty: true });
    await Promise.resolve();
    expect(host.values.get("project.meta")).toEqual({ id: "p", dirty: true });
    dispose();
  });

  it("publishes the selection (clip ids, playhead, shot) as the person selects", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({ start: 0, duration: 2, label: "S", metadata: { shotSeq: 3 } });
    await placeholders.idle();
    const { bridge, dispose } = createBridge(undefined);
    useUIStore.getState().select({ type: "clip", id });
    expect(bridge.get("selection")).toMatchObject({ clipIds: [id], shotSeq: 3 });
    dispose();
  });
});

describe("shared AI thread", () => {
  it("shows what the editor says to the host, and what the host adds in the editor's panel and context", async () => {
    const host = fakeHostBridge();
    const { bridge, dispose } = createBridge(host);

    useChatStore.setState({
      messages: [{ id: "m1", role: "user", text: "trim the intro", toolCalls: [] }],
    });
    expect(bridge.get("ai.thread")).toEqual([{ id: "m1", role: "user", text: "trim the intro" }]);
    await Promise.resolve();
    expect(host.values.get("ai.thread")).toEqual([{ id: "m1", role: "user", text: "trim the intro" }]);

    await bridge.set("ai.thread", [
      { id: "m1", role: "user", text: "trim the intro" },
      { id: "h1", role: "assistant", text: "Done on the server: cut 2 seconds." },
    ]);
    const chat = useChatStore.getState();
    expect(chat.messages.map((m) => m.id)).toEqual(["m1", "h1"]);
    expect(chat.conversation.at(-1)).toMatchObject({ role: "assistant", content: "Done on the server: cut 2 seconds." });
    dispose();
  });
});

describe("bridge RPC", () => {
  it("host to editor: runs a registered tool through the editor's registry", async () => {
    const calls: unknown[] = [];
    const remove = registerTool({
      name: "bridge_test_tool",
      description: "test",
      inputSchema: { type: "object", properties: { n: { type: "number" } } },
      readOnly: true,
      handler: (args) => {
        calls.push(args);
        return { ok: true, summary: `n=${String(args.n)}` };
      },
    });
    const { bridge, dispose } = createBridge(undefined);
    const result = await bridge.call("tool", { name: "bridge_test_tool", args: { n: 4 } });
    expect(result).toMatchObject({ ok: true, summary: "n=4" });
    expect(calls).toEqual([{ n: 4 }]);
    await expect(bridge.call("nope")).rejects.toThrow(/Unknown bridge method/);
    expect(await bridge.call("capabilities")).toMatchObject({ version: BRIDGE_VERSION });
    remove();
    dispose();
  });

  it("editor to host: callHost goes through the host's bridge, and fails clearly without one", async () => {
    const host = fakeHostBridge();
    const withHost = createBridge(host);
    expect(await withHost.callHost("queue.action", { id: "q1", action: "apply" })).toEqual({ ok: true });
    expect(host.calls).toEqual([{ method: "queue.action", args: { id: "q1", action: "apply" } }]);
    withHost.dispose();
    const without = createBridge(undefined);
    await expect(without.callHost("x")).rejects.toThrow(/no bridge/);
    without.dispose();
  });
});

describe("bridge tool path", () => {
  it("runs a host tool through the editor's own path: one undo step, validation, rollback on failure", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({ start: 0, duration: 2, label: "Tool" });
    await placeholders.idle();
    const remove = registerTool({
      name: "bridge_mark_clip",
      description: "sets host metadata through the action system",
      inputSchema: { type: "object", properties: { clipId: { type: "string" } }, required: ["clipId"] },
      handler: async (args, host) => {
        const result = await host.applyAction({
          type: "clip/setMetadata",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: { clipId: String(args.clipId), metadata: { host: { marked: true } } },
        } as never);
        return result.success ? { ok: true, summary: "marked" } : { ok: false, summary: "refused" };
      },
    });
    const { bridge, dispose } = createBridge(undefined);

    const result = await bridge.call("tool", { name: "bridge_mark_clip", args: { clipId: id } });
    expect(result).toMatchObject({ ok: true, summary: "marked" });
    const clipOf = () => useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    expect(clipOf()?.metadata?.host).toEqual({ marked: true });

    // a validated action: an unknown clip is refused by the action system and nothing changes
    const refused = await bridge.call("tool", { name: "bridge_mark_clip", args: { clipId: "nope" } });
    expect(refused).toMatchObject({ ok: false });

    // one undo step brings the clip back to before the tool
    await useProjectStore.getState().undo();
    expect(clipOf()?.metadata?.host).toBeUndefined();
    remove();
    dispose();
  });

  it("applies read-only: a changing tool is refused", async () => {
    const placeholders = createPlaceholderController();
    const id = placeholders.add({ start: 0, duration: 2 });
    await placeholders.idle();
    const remove = registerTool({
      name: "bridge_mark_clip_2",
      description: "x",
      inputSchema: { type: "object", properties: { clipId: { type: "string" } } },
      handler: async (args, host) => {
        const result = await host.applyAction({
          type: "clip/setMetadata",
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          params: { clipId: String(args.clipId), metadata: { host: { marked: true } } },
        } as never);
        return { ok: result.success, summary: result.success ? "marked" : "refused" };
      },
    });
    const { bridge, dispose } = createBridge(undefined);
    useProjectStore.getState().actionExecutor.setReadOnly(true);
    const result = (await bridge.call("tool", { name: "bridge_mark_clip_2", args: { clipId: id } })) as { ok: boolean };
    useProjectStore.getState().actionExecutor.setReadOnly(false);
    expect(result.ok).toBe(false);
    remove();
    dispose();
  });
});

describe("bridge ui actions", () => {
  it("lists its actions in capabilities.ui and as call('capabilities').ui", async () => {
    const { bridge, dispose } = createBridge(undefined);
    expect(bridge.capabilities.ui).toEqual(
      expect.arrayContaining([
        "select_clip", "select_clips", "seek", "play_range", "set_zoom", "open_panel", "open_inspector_tab",
        "scroll_timeline_to", "highlight", "show_toast", "focus", "play_preview",
      ]),
    );
    expect(await bridge.call("capabilities")).toMatchObject({ ui: expect.arrayContaining(["seek"]) });
    dispose();
  });

  it("selects, seeks, zooms, plays a range and shows a toast", async () => {
    const placeholders = createPlaceholderController();
    const a = placeholders.add({ start: 0, duration: 2, label: "A" });
    const b = placeholders.add({ start: 2, duration: 2, label: "B" });
    await placeholders.idle();
    const { bridge, dispose } = createBridge(undefined);
    const ui = (action: string, args?: unknown) => bridge.call("ui", { action, args });

    expect(await ui("select_clip", { id: a })).toEqual({ ok: true });
    expect(useUIStore.getState().selectedItems.map((i) => i.id)).toEqual([a]);
    expect(await ui("select_clips", { ids: [a, b, "gone"] })).toEqual({ ok: true });
    expect(useUIStore.getState().selectedItems.map((i) => i.id)).toEqual([a, b]);
    expect(await ui("select_clip", { id: "gone" })).toMatchObject({ ok: false, reason: expect.any(String) });

    expect(await ui("seek", { seconds: 3.5 })).toEqual({ ok: true });
    expect(useTimelineStore.getState().playheadPosition).toBe(3.5);
    expect(await ui("seek", { seconds: "x" })).toMatchObject({ ok: false });

    expect(await ui("set_zoom", { pixelsPerSecond: 90 })).toEqual({ ok: true });
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(90);

    expect(await ui("play_range", { start: 1, end: 2 })).toEqual({ ok: true });
    expect(useTimelineStore.getState().playheadPosition).toBe(1);
    useTimelineStore.getState().pause();
    expect(await ui("play_range", { start: 2, end: 1 })).toMatchObject({ ok: false });
    expect(await ui("play_preview", { clipA: a, clipB: b })).toEqual({ ok: true });
    useTimelineStore.getState().pause();

    expect(await ui("show_toast", { message: "Hello", kind: "success" })).toEqual({ ok: true });
    expect(useNotificationStore.getState().notifications.at(-1)).toMatchObject({ title: "Hello", type: "success" });

    expect(await ui("highlight", { target: { clip: a } })).toMatchObject({ ok: false }); // nothing on screen in this test
    dispose();
  });

  it("says why an unknown action did nothing", async () => {
    const { bridge, dispose } = createBridge(undefined);
    expect(await bridge.call("ui", { action: "dance" })).toMatchObject({ ok: false, reason: expect.stringContaining("Unknown ui action") });
    expect(await bridge.call("ui", {})).toMatchObject({ ok: false });
    dispose();
  });
});
