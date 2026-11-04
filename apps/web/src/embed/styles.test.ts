import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("stylesheets", () => {
  const index = read("../index.css");

  it("keeps page-level html/body rules out of the shared stylesheet", () => {
    expect(index).not.toMatch(/^\s*(html|body)\b[^{]*\{/m);
    expect(read("../standalone.css")).toMatch(/body\s*\{/);
  });

  it("the standalone entry loads the page-level rules", () => {
    expect(read("../main.tsx")).toContain('import "./standalone.css"');
  });

  it("defines the chrome colour tokens that components read", () => {
    for (const token of [
      "--playhead",
      "--preview-empty-bg",
      "--preview-empty-text",
      "--preview-text-primary",
      "--preview-text-secondary",
      "--preview-frame-bg",
      "--graph-bg",
      "--graph-grid",
      "--graph-axis",
      "--graph-label",
      "--graph-line",
    ]) {
      expect(index, token).toContain(`${token}:`);
    }
  });

  it("scopes embedded typography to the editor root", () => {
    expect(read("./embed.css")).toMatch(/\[data-openreel-root\]\s*\{/);
  });
});
