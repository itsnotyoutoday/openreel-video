/**
 * Yields to the event loop so queued input, timers and paints can run.
 *
 * Unlike `setTimeout(fn, 0..2)`, a MessageChannel task is not subject to the
 * 4 ms timer clamp browsers apply to nested timers, so a tight export loop can
 * hand control back many times a second without adding fixed latency.
 */
export function yieldToMainThread(): Promise<void> {
  if (typeof MessageChannel === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Minimum time between yields and between progress events in the export loop. */
export const EXPORT_YIELD_INTERVAL_MS = 16;
export const EXPORT_PROGRESS_INTERVAL_MS = 100;
