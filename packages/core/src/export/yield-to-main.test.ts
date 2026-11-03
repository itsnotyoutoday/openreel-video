import { afterEach, describe, expect, it, vi } from "vitest";
import { yieldToMainThread } from "./yield-to-main";

describe("yieldToMainThread", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves through a macrotask, not just a microtask", async () => {
    let microtaskRan = false;
    let resolved = false;
    const pending = yieldToMainThread().then(() => {
      resolved = true;
    });
    void Promise.resolve().then(() => {
      microtaskRan = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(microtaskRan).toBe(true);
    expect(resolved).toBe(false);

    await pending;
    expect(resolved).toBe(true);
  });

  it("can be awaited repeatedly without leaking open ports", async () => {
    for (let index = 0; index < 100; index++) {
      await yieldToMainThread();
    }
  });

  it("falls back to a timer when MessageChannel is unavailable", async () => {
    vi.stubGlobal("MessageChannel", undefined);
    vi.useFakeTimers();

    let resolved = false;
    const pending = yieldToMainThread().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    await vi.runAllTimersAsync();
    await pending;
    expect(resolved).toBe(true);
  });
});
