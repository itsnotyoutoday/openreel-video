import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

vi.mock("../components/editor/EditorInterface", () => ({
  EditorInterface: () => <div data-testid="editor-interface" />,
}));

import { mountEditor } from "./mount";
import { createThemeController, validateTheme } from "./theme";
import { useThemeStore } from "../stores/theme-store";
import { applyThemeAttributes } from "../utils/theme-target";
import { readCssVar } from "../utils/css-token";
import { Playhead } from "../components/editor/timeline/Playhead";
import { setHostRuntime } from "./host-runtime";

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

let container: HTMLElement;
let editor: ReturnType<typeof mountEditor> | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.classList.remove("dark");
  useThemeStore.setState({ mode: "light", isDark: false });
});
afterEach(async () => {
  await act(async () => { editor?.unmount(); });
  editor = null;
  container.remove();
  setHostRuntime(null);
});

describe("editor theme", () => {
  it("applies tokens and mode to the editor root only, never to the host page", async () => {
    editor = mountEditor(container, { theme: { mode: "dark", tokens: { "--accent": "#ff5a36" } } });
    await flush();

    expect(editor.root.style.getPropertyValue("--accent")).toBe("#ff5a36");
    expect(editor.root.dataset.theme).toBe("dark");
    expect(editor.root.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("setTheme replaces the previous tokens", async () => {
    editor = mountEditor(container, { theme: { tokens: { "--bg": "#111111" } } });
    await flush();
    editor.setTheme({ mode: "light", tokens: { "--fg": "#222222" } });

    expect(editor.root.style.getPropertyValue("--bg")).toBe("");
    expect(editor.root.style.getPropertyValue("--fg")).toBe("#222222");
    expect(editor.root.dataset.theme).toBe("light");
  });

  it("rejects an invalid token name before mounting anything", () => {
    expect(() => mountEditor(container, { theme: { tokens: { accent: "red" } } })).toThrow(/Invalid theme token/);
    expect(container.childElementCount).toBe(0);
    expect(() => validateTheme({ mode: "neon" as never })).toThrow(/Invalid theme mode/);
  });

  it("follows the toolbar's theme toggle on the root while embedded", async () => {
    editor = mountEditor(container, { theme: { mode: "light" } });
    await flush();
    act(() => useThemeStore.getState().setMode("dark"));
    expect(editor.root.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("the standalone app still themes the document element", () => {
    useThemeStore.getState().setMode("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    useThemeStore.getState().setMode("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("applyThemeAttributes leaves the page alone in the embeddable build before mount", () => {
    globalThis.__OPENREEL_EMBEDDED__ = true;
    try {
      applyThemeAttributes(true);
      expect(document.documentElement.dataset.theme).toBeUndefined();
    } finally {
      globalThis.__OPENREEL_EMBEDDED__ = undefined;
    }
  });

  it("the controller removes its tokens on dispose", () => {
    const root = document.createElement("div");
    const controller = createThemeController(root);
    controller.apply({ tokens: { "--x": "1" } });
    expect(root.style.getPropertyValue("--x")).toBe("1");
    controller.dispose();
    expect(root.style.getPropertyValue("--x")).toBe("");
  });
});

describe("host page protection", () => {
  it("leaves the host's own html attributes alone while mounted and after unmount", async () => {
    document.documentElement.setAttribute("data-theme", "host-theme");
    document.documentElement.removeAttribute("data-astryx-theme");

    editor = mountEditor(container, { theme: { mode: "dark" } });
    await flush();
    expect(document.documentElement.getAttribute("data-theme")).toBe("host-theme");
    expect(document.documentElement.hasAttribute("data-astryx-theme")).toBe(false);

    editor.setTheme({ mode: "light" });
    await flush();
    expect(document.documentElement.getAttribute("data-theme")).toBe("host-theme");

    await act(async () => { editor!.unmount(); });
    editor = null;
    expect(document.documentElement.getAttribute("data-theme")).toBe("host-theme");
    document.documentElement.removeAttribute("data-theme");
  });
});

describe("colour tokens", () => {
  it("readCssVar returns the fallback when the token is undefined and the value when it is", () => {
    expect(readCssVar("--not-defined-here", "#123456")).toBe("#123456");
    document.documentElement.style.setProperty("--defined-here", " #abcdef ");
    expect(readCssVar("--defined-here", "#123456")).toBe("#abcdef");
    document.documentElement.style.removeProperty("--defined-here");
  });

  it("readCssVar resolves against the embedded root", async () => {
    editor = mountEditor(container, { theme: { tokens: { "--preview-empty-bg": "#010203" } } });
    await flush();
    expect(readCssVar("--preview-empty-bg", "#ffffff")).toBe("#010203");
  });

  it("the playhead takes its colour from a token instead of a hard-coded value", () => {
    const { container: view } = render(
      <Playhead position={1} pixelsPerSecond={10} scrollX={0} headerOffset={0} />,
    );
    const styled = [...view.querySelectorAll<HTMLElement>("[style]")].map((el) => el.style.background);
    expect(styled).toContain("var(--playhead)");
    expect(styled.some((value) => value.includes("#1d1d1f"))).toBe(false);
  });
});
