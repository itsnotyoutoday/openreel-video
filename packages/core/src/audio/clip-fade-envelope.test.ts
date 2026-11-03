import { describe, expect, it } from "vitest";
import { getClipFadeEnvelopePoints } from "./clip-fade-envelope";

describe("clip fade envelopes", () => {
  it("keeps fade timing clip-local when rendering a middle chunk", () => {
    expect(getClipFadeEnvelopePoints({ clipOffset: 4, rangeDuration: 2, clipDuration: 10, fadeIn: 2, fadeOut: 2 })).toEqual([
      { time: 0, value: 1 },
      { time: 2, value: 1 },
    ]);
  });

  it("returns the correct partial fade when playback begins inside it", () => {
    expect(getClipFadeEnvelopePoints({ clipOffset: 1, rangeDuration: 2, clipDuration: 10, fadeIn: 2 })).toEqual([
      { time: 0, value: 0.5 },
      { time: 1, value: 1 },
      { time: 2, value: 1 },
    ]);
  });

  it("schedules a clip-end fade relative to the requested range", () => {
    expect(getClipFadeEnvelopePoints({ clipOffset: 7, rangeDuration: 3, clipDuration: 10, fadeOut: 2 })).toEqual([
      { time: 0, value: 1 },
      { time: 1, value: 1 },
      { time: 3, value: 0 },
    ]);
  });

  it("peaks where overlapping fades cross instead of cutting the corner", () => {
    // A 4 s clip with 3 s fades: the ramps meet at 2 s at two thirds, not at 1/3.
    const points = getClipFadeEnvelopePoints({ clipOffset: 0, rangeDuration: 4, clipDuration: 4, fadeIn: 3, fadeOut: 3 });
    expect(points.map((point) => point.time)).toEqual([0, 1, 2, 3, 4]);
    expect(points[2].value).toBeCloseTo(2 / 3, 5);
    expect(points[0].value).toBe(0);
    expect(points[4].value).toBe(0);
  });

  it("does not add a crossing point outside the requested range", () => {
    const points = getClipFadeEnvelopePoints({ clipOffset: 3, rangeDuration: 1, clipDuration: 4, fadeIn: 3, fadeOut: 3 });
    expect(points.map((point) => point.time)).toEqual([0, 1]);
  });
});
