import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import {
  createMemoryStorageProvider,
  type Project,
} from "@openreel/core";

vi.mock("../components/editor/EditorInterface", () => ({
  EditorInterface: () => <div data-testid="editor-interface">editor</div>,
}));

vi.mock("../components/editor/SearchModal", () => ({
  SearchModal: () => <div data-testid="search-modal" />,
}));
vi.mock("../components/editor/ScriptViewDialog", () => ({
  ScriptViewDialog: () => <div data-testid="script-dialog" />,
}));

import { getTool, listTools } from "@openreel/agent";
import { mountEditor } from "./mount";
import { useUIStore } from "../stores/ui-store";
import { getHostRuntime } from "./host-runtime";
import { useProjectStore } from "../stores/project-store";
import {
  getStorageProvider,
  hasHostStorageProvider,
} from "../services/storage/storage-context";
import { createEmptyProject } from "../stores/project/project-helpers";

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let container: HTMLElement | null = null;
let editor: ReturnType<typeof mountEditor> | null = null;

function setup(options: Parameters<typeof mountEditor>[1] = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  editor = mountEditor(container, options);
  return editor;
}

afterEach(async () => {
  await act(async () => { editor?.unmount(); });
  container?.remove();
  editor = null;
  container = null;
});

describe("mountEditor", () => {
  it("renders into the container and opens a new project", async () => {
    setup({ newProject: { name: "Embedded" } });
    await flush();

    expect(container!.querySelector("[data-openreel-root]")).not.toBeNull();
    expect(container!.querySelector('[data-testid="editor-interface"]')).not.toBeNull();
    expect(useProjectStore.getState().project.name).toBe("Embedded");
    expect(getHostRuntime()?.root).toBe(editor!.root);
  });

  it("installs the host storage provider and removes it on unmount", async () => {
    const storage = createMemoryStorageProvider();
    setup({ storage });
    await flush();
    expect(hasHostStorageProvider()).toBe(true);
    expect(getStorageProvider()).toBe(storage);

    await act(async () => { editor!.unmount(); });
    expect(hasHostStorageProvider()).toBe(false);
    expect(getHostRuntime()).toBeNull();
  });

  it("opens a stored project and saves back through the provider", async () => {
    const storage = createMemoryStorageProvider();
    const stored: Project = { ...createEmptyProject("Stored"), id: "stored-1" };
    await storage.saveProject(stored);
    setup({ storage, projectId: "stored-1" });
    await flush();
    expect(useProjectStore.getState().project.id).toBe("stored-1");

    const result = await editor!.saveProject();
    expect(result.revision).toBe("2");
    expect(editor!.getProject().name).toBe("Stored");
  });

  it("does not touch the URL", async () => {
    window.location.hash = "#/unchanged";
    setup();
    await flush();
    await act(async () => { editor!.unmount(); });
    expect(window.location.hash).toBe("#/unchanged");
  });

  it("removes its DOM and resets editor state on unmount, and can mount again", async () => {
    setup({ newProject: { name: "First" } });
    await flush();
    await act(async () => { editor!.unmount(); });

    expect(container!.querySelector("[data-openreel-root]")).toBeNull();
    expect(useProjectStore.getState().hasOpenProject).toBe(false);

    editor = mountEditor(container!, { newProject: { name: "Second" } });
    await flush();
    expect(useProjectStore.getState().project.name).toBe("Second");
  });

  it("rejects a second concurrent mount", () => {
    setup();
    const other = document.createElement("div");
    expect(() => mountEditor(other)).toThrow(/already mounted/);
  });

  it("unmount is idempotent", async () => {
    setup();
    await flush();
    await act(async () => {
      editor!.unmount();
      editor!.unmount();
    });
    expect(getHostRuntime()).toBeNull();
  });

  it("imports an asset from the host media source", async () => {
    const resolve = vi.fn().mockResolvedValue(new File(["x"], "a.mp4", { type: "video/mp4" }));
    setup({ media: { resolve } });
    await flush();
    const importMedia = vi.fn().mockResolvedValue({ success: true });
    useProjectStore.setState({ importMedia });

    await editor!.importAsset("asset-1");

    expect(resolve).toHaveBeenCalledWith("asset-1");
    expect(importMedia).toHaveBeenCalledOnce();
    expect((importMedia.mock.calls[0][0] as File).name).toBe("a.mp4");
  });

  it("fails importAsset clearly when no media source was given", async () => {
    setup();
    await flush();
    await expect(editor!.importAsset("x")).rejects.toThrow(/No media source/);
  });

  it("makes the root focusable and focuses it so scoped shortcuts receive keys", async () => {
    setup();
    await flush();
    expect(editor!.root.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(editor!.root);
  });

  it("opens search with Ctrl+K pressed inside the editor but not elsewhere", async () => {
    setup();
    await flush();
    const press = (target: EventTarget) =>
      act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })); });

    press(window);
    expect(useUIStore.getState().activeModal).toBeNull();

    press(editor!.root);
    await flush();
    expect(useUIStore.getState().activeModal).toBe("search");
    await act(async () => { useUIStore.getState().closeModal(); });
  });

  it("registers host tools for the agent and removes them on unmount", async () => {
    const baseline = listTools().length;
    const tool = {
      name: "host_ping",
      description: "Ping",
      inputSchema: { type: "object" },
      handler: () => ({ ok: true, summary: "pong" }),
    };
    setup({ tools: [tool] });
    await flush();
    expect(getTool("host_ping")).toBeDefined();
    expect(listTools()).toHaveLength(baseline + 1);

    await act(async () => { editor!.unmount(); });
    expect(getTool("host_ping")).toBeUndefined();
    expect(listTools()).toHaveLength(baseline);
  });

  it("adds, extends and removes tools through the handle", async () => {
    setup();
    await flush();
    const remove = editor!.addTool({
      name: "host_late",
      description: "Late",
      inputSchema: { type: "object" },
      handler: () => ({ ok: true, summary: "late" }),
    });
    expect(getTool("host_late")).toBeDefined();
    const undo = editor!.extendTool("host_late", { properties: { x: { type: "number" } } });
    expect((getTool("host_late")!.inputSchema.properties as Record<string, unknown>).x).toEqual({ type: "number" });
    undo();
    expect(editor!.removeTool("host_late")).toBe(true);
    expect(editor!.removeTool("list_clips")).toBe(false);
    expect(getTool("host_late")).toBeUndefined();
    remove();
  });

  it("does not render and leaves no tools behind when a tool definition is invalid", () => {
    container = document.createElement("div");
    const baseline = listTools().length;
    const good = { name: "host_good", description: "g", inputSchema: {}, handler: () => ({ ok: true, summary: "g" }) };
    expect(() =>
      mountEditor(container!, { tools: [good, { ...good, name: "bad name" }] }),
    ).toThrow(/Invalid tool name/);
    expect(listTools()).toHaveLength(baseline);
    expect(container.childElementCount).toBe(0);
  });
});
