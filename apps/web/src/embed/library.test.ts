import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as embed from "./index";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("library entry", () => {
  it("exports the public embedding API", () => {
    for (const name of [
      "mountEditor",
      "createMemoryStorageProvider",
      "StorageConflictError",
      "registerTool",
      "unregisterTool",
      "extendToolSchema",
      "executeTool",
      "getTool",
      "listTools",
    ]) {
      expect(typeof (embed as Record<string, unknown>)[name], name).toBe("function");
    }
  });

  it("loads the embedded-mode prelude before anything else", () => {
    const imports = read("./library.ts")
      .split("\n")
      .filter((line) => line.startsWith("import "));
    expect(imports[0]).toBe('import "./prelude";');
    expect(imports.some((line) => line.includes("index.css"))).toBe(true);
  });

  it("is built by a separate config and exposed through package exports", () => {
    const pkg = JSON.parse(read("../../package.json")) as {
      scripts: Record<string, string>;
      exports: Record<string, unknown>;
    };
    expect(pkg.scripts["build:lib"]).toContain("vite.lib.config.ts");
    expect(pkg.exports["./embed"]).toMatchObject({ import: "./dist-lib/openreel-editor.js" });
    expect(pkg.exports["./embed.css"]).toBe("./dist-lib/openreel-editor.css");
    expect(read("../../vite.lib.config.ts")).toContain("scopeRootCss()");
  });

  it("the harness page loads the library build's stylesheet and module", () => {
    expect(read("../../harness/index.html")).toContain('href="./lib/openreel-editor.css"');
    expect(read("../../harness/harness.js")).toContain('"./lib/openreel-editor.js"');
  });
});
