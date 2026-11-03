import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { keyboardShortcuts } from "./keyboard-shortcuts";

// vitest runs with apps/web as the working directory.
const doc = readFileSync(resolve(process.cwd(), "../../docs/keyboard-shortcuts.md"), "utf8");

describe("keyboard map (docs/keyboard-shortcuts.md)", () => {
  it("lists every default shortcut by name", () => {
    const missing = keyboardShortcuts
      .getAllShortcuts()
      .filter((shortcut) => !doc.includes(`| ${shortcut.name} |`))
      .map((shortcut) => shortcut.name);
    expect(missing).toEqual([]);
  });

  it("documents the shuttle keys and the K-held behaviour", () => {
    expect(doc).toContain("## Shuttle (J, K, L)");
    expect(doc).toContain("Hold `K`, tap `L` or `J`");
    expect(doc).toContain("quarter speed");
  });
});
