import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { scopeRootCss } from "./scope-root-css";

const run = async (css: string) =>
  (await postcss([scopeRootCss()]).process(css, { from: undefined })).css;

describe("scopeRootCss", () => {
  it("moves :root token blocks to the editor root", async () => {
    const out = await run(`:root { --bg: #fff; }`);
    expect(out).toContain("[data-openreel-root]");
    expect(out).not.toContain(":root");
  });

  it("keeps theme selectors and rewrites :root inside lists", async () => {
    const out = await run(`:root, [data-theme="light"] { --bg: #fff; }`);
    expect(out).toContain('[data-openreel-root], [data-theme="light"]');
  });

  it("drops page-level html and body rules but keeps the rest of a list", async () => {
    expect(await run(`html, body { margin: 0; }`)).toBe("");
    const out = await run(`html, .keep { margin: 0; }`);
    expect(out).toContain(".keep");
    expect(out).not.toMatch(/\bhtml\b/);
  });

  it("does not touch ordinary rules or keyframes", async () => {
    const css = `.a { color: red; } @keyframes spin { from { opacity: 0 } to { opacity: 1 } }`;
    expect(await run(css)).toBe(css);
  });

  it("works inside at-rules such as @layer", async () => {
    const out = await run(`@layer base { :root { --x: 1; } body { margin: 0; } }`);
    expect(out).toContain("[data-openreel-root]");
    expect(out).not.toContain("body");
  });
});
