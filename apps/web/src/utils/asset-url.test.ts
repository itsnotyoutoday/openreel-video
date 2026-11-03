import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assetUrl, getBasePath } from "./asset-url";
import { setHostRuntime } from "../embed/host-runtime";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const runtimeWith = (basePath?: string) => ({
  options: { basePath },
  root: document.createElement("div"),
  getProject: () => ({}) as never,
});

afterEach(() => {
  setHostRuntime(null);
  vi.unstubAllEnvs();
});

describe("assetUrl", () => {
  it("is unchanged for the standalone app served from the root", () => {
    expect(getBasePath()).toBe("/");
    expect(assetUrl("fonts/helvetiker_regular.typeface.json")).toBe("/fonts/helvetiker_regular.typeface.json");
    expect(assetUrl("/sw.js")).toBe("/sw.js");
  });

  it("follows the Vite base of a sub-path build", () => {
    vi.stubEnv("BASE_URL", "/tools/editor/");
    expect(assetUrl("fonts/a.json")).toBe("/tools/editor/fonts/a.json");
  });

  it("follows the host's basePath, with or without a trailing slash", () => {
    setHostRuntime(runtimeWith("/tools/editor"));
    expect(assetUrl("fonts/a.json")).toBe("/tools/editor/fonts/a.json");
    setHostRuntime(runtimeWith("/tools/editor/"));
    expect(assetUrl("fonts/a.json")).toBe("/tools/editor/fonts/a.json");
  });

  it("prefers the host's basePath over the build's base", () => {
    vi.stubEnv("BASE_URL", "/built/");
    setHostRuntime(runtimeWith("/host/"));
    expect(getBasePath()).toBe("/host/");
  });

  it("an embedded host without basePath uses the build's base", () => {
    vi.stubEnv("BASE_URL", "/built/");
    setHostRuntime(runtimeWith(undefined));
    expect(getBasePath()).toBe("/built/");
  });
});

describe("service worker registration", () => {
  async function registerWith(env?: string) {
    vi.useFakeTimers();
    if (env) vi.stubEnv("BASE_URL", env);
    const register = vi.fn().mockResolvedValue({ addEventListener: vi.fn() });
    Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
    const { serviceWorkerManager } = await import("../services/service-worker");
    await serviceWorkerManager.register();
    vi.useRealTimers();
    return register;
  }

  it("registers /sw.js with scope / at the site root, as before", async () => {
    const register = await registerWith();
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("registers under the build's sub-path", async () => {
    const register = await registerWith("/tools/editor/");
    expect(register).toHaveBeenCalledWith("/tools/editor/sw.js", { scope: "/tools/editor/" });
  });
});

describe("sub-path support in static files", () => {
  it("the service worker caches its shell relative to its own location", () => {
    const sw = read("../../public/sw.js");
    expect(sw).toContain('const STATIC_ASSETS = ["./", "./index.html", "./manifest.json"]');
  });

  it("the 3D text renderer no longer hard-codes root-absolute font paths", () => {
    const source = read("../components/editor/preview/threejs-layer-renderer.ts");
    expect(source).not.toMatch(/["']\/fonts\//);
  });
});
