import { beforeEach, describe, expect, it } from "vitest";
import { ShuttleController, type ShuttleDeps } from "./shuttle-controller";

function setup(duration = 100, start = 10) {
  let position = start;
  let clock = 0;
  let playing = false;
  let rate = 1;
  const queue: Array<() => void> = [];
  const deps: ShuttleDeps = {
    getPosition: () => position,
    seek: (seconds) => { position = seconds; },
    getDuration: () => duration,
    getFrameSeconds: () => 0.5,
    play: () => { playing = true; },
    pause: () => { playing = false; },
    setPlaybackRate: (value) => { rate = value; },
    now: () => clock,
    schedule: (callback) => {
      queue.push(callback);
      return () => {
        const index = queue.indexOf(callback);
        if (index >= 0) queue.splice(index, 1);
      };
    },
  };
  return {
    controller: new ShuttleController(deps),
    /** Advance the clock and run one scheduled frame. */
    frame: (ms: number) => {
      clock += ms;
      queue.splice(0).forEach((callback) => callback());
    },
    get position() { return position; },
    get playing() { return playing; },
    get rate() { return rate; },
    get scrubbing() { return queue.length > 0; },
  };
}

let h: ReturnType<typeof setup>;
beforeEach(() => { h = setup(); });

describe("ShuttleController forward", () => {
  it("L plays forward at 1x, then 2x, 4x with the normal player", () => {
    h.controller.press("l");
    expect([h.playing, h.rate]).toEqual([true, 1]);
    h.controller.press("l");
    expect(h.rate).toBe(2);
    h.controller.press("l");
    expect(h.rate).toBe(4);
    expect(h.controller.getState()).toMatchObject({ direction: 1, speed: 4 });
  });

  it("the fourth L scrubs at 8x because the player tops out at 4x", () => {
    for (let index = 0; index < 4; index += 1) h.controller.press("l");
    expect(h.playing).toBe(false);
    expect(h.rate).toBe(1);
    expect(h.scrubbing).toBe(true);
    h.frame(500);
    expect(h.position).toBeCloseTo(10 + 8 * 0.5, 5);
  });

  it("further presses stay at 8x", () => {
    for (let index = 0; index < 6; index += 1) h.controller.press("l");
    expect(h.controller.getState().speed).toBe(8);
  });
});

describe("ShuttleController reverse", () => {
  it("J scrubs backwards at 1x then 2x, 4x and 8x", () => {
    h.controller.press("j");
    h.frame(1000);
    expect(h.position).toBeCloseTo(9, 5);
    h.controller.press("j");
    h.frame(1000);
    expect(h.position).toBeCloseTo(7, 5);
    h.controller.press("j");
    h.controller.press("j");
    expect(h.controller.getState()).toMatchObject({ direction: -1, speed: 8 });
    h.frame(500);
    expect(h.position).toBeCloseTo(3, 5);
  });

  it("stops at the start of the timeline", () => {
    h = setup(100, 0.5);
    h.controller.press("j");
    h.frame(2000);
    expect(h.position).toBe(0);
    expect(h.controller.getState().direction).toBe(0);
    expect(h.scrubbing).toBe(false);
  });

  it("forward scrubbing stops at the end", () => {
    h = setup(10, 9);
    for (let index = 0; index < 4; index += 1) h.controller.press("l");
    h.frame(1000);
    expect(h.position).toBe(10);
    expect(h.controller.getState().direction).toBe(0);
  });
});

describe("ShuttleController K and direction changes", () => {
  it("K stops forward playback and restores the player speed", () => {
    h.controller.press("l");
    h.controller.press("l");
    h.controller.press("k");
    expect(h.playing).toBe(false);
    expect(h.rate).toBe(1);
    expect(h.controller.getState().direction).toBe(0);
  });

  it("K stops reverse scrubbing", () => {
    h.controller.press("j");
    h.controller.press("k");
    expect(h.scrubbing).toBe(false);
    h.frame(1000);
    expect(h.position).toBe(10);
  });

  it("changing direction restarts at 1x", () => {
    h.controller.press("l");
    h.controller.press("l");
    h.controller.press("j");
    expect(h.controller.getState()).toMatchObject({ direction: -1, speed: 1 });
    expect(h.playing).toBe(false);
    h.controller.press("l");
    expect(h.controller.getState()).toMatchObject({ direction: 1, speed: 1 });
    expect(h.playing).toBe(true);
  });

  it("ignores auto-repeat of J and L when K is not held", () => {
    h.controller.press("l");
    h.controller.press("l", true);
    h.controller.press("l", true);
    expect(h.controller.getState().speed).toBe(1);
  });
});

describe("ShuttleController with K held", () => {
  it("a tap on L steps one frame forward and a tap on J one frame back", () => {
    h.controller.press("k");
    h.controller.press("l");
    expect(h.position).toBeCloseTo(10.5, 5);
    h.controller.release("l");
    h.controller.press("j");
    h.controller.release("j");
    h.controller.press("j");
    expect(h.position).toBeCloseTo(9.5, 5);
    expect(h.playing).toBe(false);
  });

  it("frame steps stay inside the timeline", () => {
    h = setup(100, 0.2);
    h.controller.press("k");
    h.controller.press("j");
    expect(h.position).toBe(0);
  });

  it("holding L plays at quarter speed until released", () => {
    h.controller.press("k");
    h.controller.press("l");
    h.controller.press("l", true);
    expect(h.controller.getState()).toMatchObject({ direction: 1, speed: 0.25 });
    h.frame(1000);
    expect(h.position).toBeCloseTo(10.5 + 0.25, 5);
    h.controller.release("l");
    expect(h.scrubbing).toBe(false);
    expect(h.controller.getState().direction).toBe(0);
  });

  it("holding J plays slowly in reverse", () => {
    h.controller.press("k");
    h.controller.press("j");
    h.controller.press("j", true);
    h.frame(2000);
    expect(h.position).toBeCloseTo(9.5 - 0.5, 5);
  });

  it("releasing K goes back to normal shuttle behaviour", () => {
    h.controller.press("k");
    h.controller.release("k");
    h.controller.press("l");
    expect(h.playing).toBe(true);
  });

  it("dispose stops everything", () => {
    h.controller.press("j");
    h.controller.dispose();
    expect(h.scrubbing).toBe(false);
    expect(h.controller.getState().kHeld).toBe(false);
  });
});
