// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { createMemoryStorageProvider } from "@openreel/core";

vi.mock("../components/editor/EditorInterface", () => ({
  EditorInterface: () => <div data-testid="editor-interface">editor</div>,
}));
vi.mock("../components/editor/SearchModal", () => ({ SearchModal: () => <div /> }));
vi.mock("../components/editor/ScriptViewDialog", () => ({ ScriptViewDialog: () => <div /> }));

import { mountEditor } from "./mount";
import { useProjectStore } from "../stores/project-store";

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
let container: HTMLElement | null = null;
let editor: ReturnType<typeof mountEditor> | null = null;

async function setup(onDirtyChange = vi.fn()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  editor = mountEditor(container, {
    storage: createMemoryStorageProvider(),
    newProject: { name: "Setup", settings: { width: 1280, height: 720, frameRate: 30 } },
    events: { onDirtyChange },
  });
  await flush();
  return { editor, onDirtyChange };
}

afterEach(async () => {
  await act(async () => { editor?.unmount(); });
  container?.remove();
  editor = null;
  container = null;
});

const undoSize = () => useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();
const clips = () => useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips);

describe("host setup leaves no trace in the person's history", () => {
  it("batchHostSetup drops the undo entries and keeps a clean project clean", async () => {
    const { editor: e, onDirtyChange } = await setup();
    const a = e.addPlaceholderClip({ start: 0, duration: 2, label: "A" });
    await e.batchHostSetup(async () => undefined); // let the add finish
    await vi.waitFor(() => expect(clips().some((c) => c.id === a)).toBe(true));
    // the person starts from a clean, empty history: the add above was the host's
    await e.batchHostSetup(async () => {
      e.setClipMetadata(a, { label: "Scene 2" });
      await e.setClipGroups([{ id: "g", locked: true, label: "Scene", clipIds: [a] }]);
      e.updatePlaceholder(a, { label: "Scene 2" });
    });
    const depth = undoSize();
    expect(clips().find((c) => c.id === a)?.metadata?.host).toMatchObject({ label: "Scene 2" });
    expect(useProjectStore.getState().project.clipGroups).toHaveLength(1);
    expect(e.getSaveState().dirty).toBe(false);
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);

    // a real edit afterwards is an undo step and does make the project dirty
    await useProjectStore.getState().addTrack("audio");
    expect(undoSize()).toBe(depth + 1);
    expect(e.getSaveState().dirty).toBe(true);
  });

  it("{ history: false } on each setup call does the same, and the default still records", async () => {
    const { editor: e } = await setup();
    const a = e.addPlaceholderClip({ start: 0, duration: 2, label: "A" });
    await e.batchHostSetup(async () => undefined);
    await vi.waitFor(() => expect(clips().some((c) => c.id === a)).toBe(true));
    const before = undoSize();

    e.setClipMetadata(a, { label: "x" }, { history: false });
    await e.setClipGroups([{ id: "g", locked: false }], { history: false });
    e.updatePlaceholder(a, { label: "y" }, { history: false });
    await e.batchHostSetup(async () => undefined);
    expect(undoSize()).toBe(before);
    expect(e.getSaveState().dirty).toBe(false);

    e.setClipMetadata(a, { label: "z" }); // the default: an undo step
    await new Promise((resolve) => setTimeout(resolve, 100)); // queued work runs on its own, outside any batch
    expect(undoSize()).toBeGreaterThan(before);
  });
});
