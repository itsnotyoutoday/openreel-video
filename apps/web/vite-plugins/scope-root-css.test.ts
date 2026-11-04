import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { scopeRootCss } from "./scope-root-css";

const run = async (css: string) =>
  (await postcss([scopeRootCss()]).process(css, { from: undefined })).css;
const runAll = async (css: string) =>
  (await postcss([scopeRootCss({ scopeAll: true })]).process(css, { from: undefined })).css;

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

  describe("scopeAll", () => {
    it("prefixes element, class and universal rules so they cannot match host elements", async () => {
      const out = await runAll(`*, ::before, ::after { box-sizing: border-box; } button { margin: 0; } .flex { display: flex; } h1, h2 { font: inherit; }`);
      expect(out).toContain("[data-openreel-root] button");
      expect(out).toContain("[data-openreel-root] .flex");
      expect(out).toContain("[data-openreel-root] h1, [data-openreel-root] h2");
      expect(out).toContain("[data-openreel-root] *");
      expect(out).toContain("[data-openreel-root]::before");
      // nothing unscoped is left: every selector in the output starts with the root
      for (const selector of out.match(/(^|\})\s*([^{}@]+)\{/g) ?? []) {
        for (const part of selector.replace(/^\}/, "").replace(/\{$/, "").split(",")) {
          expect(part.trim().startsWith("[data-openreel-root]"), part).toBe(true);
        }
      }
    });

    it("applies theme selectors to the root itself and to descendants, and rewrites :root", async () => {
      const out = await runAll(`[data-theme="dark"] .dark\\:bg-x { color: red; } :root { --a: 1; } .dark .y { color: blue; }`);
      expect(out).toContain('[data-openreel-root][data-theme="dark"] .dark\\:bg-x');
      expect(out).toContain('[data-openreel-root] [data-theme="dark"] .dark\\:bg-x');
      expect(out).toMatch(/\[data-openreel-root\]\s*\{\s*--a/);
      expect(out).toContain("[data-openreel-root].dark .y");
      expect(out).toContain("[data-openreel-root] .dark .y");
    });

    it("scopes rules inside media queries, leaves keyframes alone, and is idempotent", async () => {
      const out = await runAll(`@media (min-width: 10px) { .a { color: red; } } @keyframes spin { from { opacity: 0 } to { opacity: 1 } }`);
      expect(out).toContain("[data-openreel-root] .a");
      expect(out).toContain("@keyframes spin { from { opacity: 0 } to { opacity: 1 } }");
      expect(await runAll(out)).toBe(out);
    });
  });
});
