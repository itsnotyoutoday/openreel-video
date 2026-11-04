/**
 * J/K/L shuttle: J plays in reverse, K stops, L plays forward. Repeated presses
 * in one direction step up through 1x, 2x, 4x and 8x. With K held, a tap on J or
 * L steps one frame, and holding J or L plays at quarter speed.
 *
 * Forward playback up to 4x uses the normal player. Reverse and 8x forward have
 * no decoder behind them, so they move the playhead frame by frame instead
 * (scrubbing, without sound), which is what the preview does for any seek.
 */

export const SHUTTLE_SPEEDS = [1, 2, 4, 8] as const;
export const SLOW_SHUTTLE_SPEED = 0.25;
/** The fastest speed the normal player is asked for. */
export const MAX_NATIVE_SPEED = 4;

export type ShuttleKey = "j" | "k" | "l";
export type ShuttleDirection = -1 | 0 | 1;

export interface ShuttleDeps {
  getPosition(): number;
  seek(seconds: number): void;
  /** End of the timeline in seconds. */
  getDuration(): number;
  /** Length of one frame in seconds. */
  getFrameSeconds(): number;
  play(): void;
  pause(): void;
  setPlaybackRate(rate: number): void;
  now(): number;
  /** Run `callback` before the next frame; returns a cancel function. */
  schedule(callback: () => void): () => void;
}

export interface ShuttleState {
  readonly direction: ShuttleDirection;
  /** Speed multiplier in the current direction, 0 when stopped. */
  readonly speed: number;
  readonly kHeld: boolean;
}

export class ShuttleController {
  private direction: ShuttleDirection = 0;
  private level = 0;
  private slow = false;
  private kHeld = false;
  private native = false;
  private cancelScrub: (() => void) | null = null;
  private lastTick = 0;
  private heldMotionKey: ShuttleKey | null = null;

  constructor(private readonly deps: ShuttleDeps) {}

  getState(): ShuttleState {
    return {
      direction: this.direction,
      speed: this.direction === 0 ? 0 : this.currentSpeed(),
      kHeld: this.kHeld,
    };
  }

  press(key: ShuttleKey, repeat = false): void {
    if (key === "k") {
      this.kHeld = true;
      this.halt();
      return;
    }
    const direction: ShuttleDirection = key === "l" ? 1 : -1;
    if (this.kHeld) {
      if (!repeat) {
        this.halt();
        this.stepFrame(direction);
      } else if (this.heldMotionKey !== key) {
        this.heldMotionKey = key;
        this.slow = true;
        this.level = 0;
        this.start(direction);
      }
      return;
    }
    if (repeat) return;
    this.slow = false;
    this.level =
      this.direction === direction ? Math.min(this.level + 1, SHUTTLE_SPEEDS.length - 1) : 0;
    this.start(direction);
  }

  release(key: ShuttleKey): void {
    if (key === "k") {
      this.kHeld = false;
      return;
    }
    if (this.heldMotionKey === key) {
      this.heldMotionKey = null;
      this.halt();
    }
  }

  /** Stop moving and give the player back its normal speed. */
  halt(): void {
    this.cancelScrub?.();
    this.cancelScrub = null;
    if (this.native) {
      this.deps.pause();
      this.deps.setPlaybackRate(1);
    }
    this.native = false;
    this.direction = 0;
    this.level = 0;
    this.slow = false;
  }

  dispose(): void {
    this.heldMotionKey = null;
    this.kHeld = false;
    this.halt();
  }

  private currentSpeed(): number {
    return this.slow ? SLOW_SHUTTLE_SPEED : SHUTTLE_SPEEDS[this.level];
  }

  private stepFrame(direction: ShuttleDirection): void {
    const next = this.deps.getPosition() + direction * this.deps.getFrameSeconds();
    this.deps.seek(Math.min(this.deps.getDuration(), Math.max(0, next)));
  }

  private start(direction: ShuttleDirection): void {
    this.cancelScrub?.();
    this.cancelScrub = null;
    this.direction = direction;
    const speed = this.currentSpeed();
    if (direction === 1 && !this.slow && speed <= MAX_NATIVE_SPEED) {
      this.native = true;
      this.deps.setPlaybackRate(speed);
      this.deps.play();
      return;
    }
    if (this.native) {
      this.deps.pause();
      this.deps.setPlaybackRate(1);
      this.native = false;
    }
    this.lastTick = this.deps.now();
    this.cancelScrub = this.deps.schedule(this.tick);
  }

  private readonly tick = (): void => {
    if (this.direction === 0) return;
    const now = this.deps.now();
    const elapsed = Math.max(0, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const duration = this.deps.getDuration();
    const next = this.deps.getPosition() + this.direction * this.currentSpeed() * elapsed;
    const clamped = Math.min(duration, Math.max(0, next));
    this.deps.seek(clamped);
    if (clamped <= 0 || clamped >= duration) {
      this.halt();
      return;
    }
    this.cancelScrub = this.deps.schedule(this.tick);
  };
}
