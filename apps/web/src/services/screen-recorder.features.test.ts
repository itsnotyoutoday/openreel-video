import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenRecorderService } from "./screen-recorder";

afterEach(() => { vi.unstubAllGlobals(); });

describe("ScreenRecorderService.getSupportedFeatures", () => {
  it("does not throw where MediaRecorder does not exist", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const features = ScreenRecorderService.getSupportedFeatures();
    expect(features.vp9).toBe(false);
    expect(typeof features.h264).toBe("boolean");
  });

  it("asks MediaRecorder when it exists", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (type: string) => type.includes("vp9") });
    expect(ScreenRecorderService.getSupportedFeatures().vp9).toBe(true);
  });
});
