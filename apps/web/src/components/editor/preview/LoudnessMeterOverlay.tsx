import React, { useEffect, useRef, useState } from "react";
import { getRealtimeAudioGraph } from "@openreel/core";
import { useHostRuntime } from "../../../embed/host-runtime";
import { LoudnessMeter, type LoudnessReading } from "../../../services/loudness-meter";

const EMPTY: LoudnessReading = { integrated: -Infinity, momentary: -Infinity, truePeak: -Infinity };

const fmt = (value: number): string => (Number.isFinite(value) ? value.toFixed(1) : "--");

/**
 * Tap the preview's master bus (after the mixer and the preview mute) with an
 * analysis node that feeds a {@link LoudnessMeter}. Returns the detach. The tap
 * outputs silence, so it never changes what is heard.
 */
function tapMasterBus(meter: { current: LoudnessMeter | null }): () => void {
  let detach: (() => void) | null = null;
  let attachedTo: AudioNode | null = null;

  const attach = () => {
    const graph = getRealtimeAudioGraph();
    const source = graph.getMasterGain();
    if (source === attachedTo) return;
    detach?.();
    const context = graph.getAudioContext();
    if (!meter.current || meter.current.sampleRate !== context.sampleRate) {
      meter.current = new LoudnessMeter(context.sampleRate);
    }
    // ScriptProcessorNode is deprecated but needs no worklet module, so it works from any host origin
    const processor = context.createScriptProcessor(4096, 2, 2);
    const sink = context.createGain();
    sink.gain.value = 0;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer;
      const channels: Float32Array[] = [];
      for (let c = 0; c < Math.min(2, input.numberOfChannels); c += 1) channels.push(input.getChannelData(c));
      meter.current?.process(channels);
    };
    source.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);
    attachedTo = source;
    detach = () => {
      processor.onaudioprocess = null;
      try {
        source.disconnect(processor);
      } catch {
        // the graph may already be torn down
      }
      processor.disconnect();
      sink.disconnect();
      attachedTo = null;
    };
  };

  attach();
  // the preview may rebuild its audio graph: follow the current master bus
  const timer = setInterval(attach, 1000);
  return () => {
    clearInterval(timer);
    detach?.();
  };
}

/**
 * Integrated loudness (LUFS) and true peak (dBTP) of what the preview plays,
 * over the player's top-right corner. Only with the host option
 * `meters: { loudness: true }`; click it to start measuring again.
 */
export const LoudnessMeterOverlay: React.FC = () => {
  const runtime = useHostRuntime();
  const enabled = Boolean(runtime?.options.meters?.loudness);
  const meter = useRef<LoudnessMeter | null>(null);
  const [reading, setReading] = useState<LoudnessReading>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let stop: () => void = () => undefined;
    try {
      stop = tapMasterBus(meter);
    } catch (error) {
      console.warn("[OpenReel] The loudness meter could not attach to the preview audio:", error);
    }
    const timer = setInterval(() => setReading(meter.current?.read() ?? EMPTY), 250);
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [enabled]);

  if (!enabled) return null;
  const hot = Number.isFinite(reading.truePeak) && reading.truePeak > -1;
  return (
    <button
      type="button"
      data-loudness-meter
      data-integrated={Number.isFinite(reading.integrated) ? reading.integrated.toFixed(2) : ""}
      data-true-peak={Number.isFinite(reading.truePeak) ? reading.truePeak.toFixed(2) : ""}
      title="Integrated loudness and true peak of the preview mix. Click to reset."
      aria-label={`Loudness ${fmt(reading.integrated)} LUFS, true peak ${fmt(reading.truePeak)} dBTP. Reset`}
      onClick={(event) => {
        event.stopPropagation();
        meter.current?.reset();
        setReading(EMPTY);
      }}
      className="absolute top-2 right-2 z-20 flex items-center gap-2 rounded-md bg-black/65 px-2 py-1 font-mono text-[11px] leading-none text-white tabular-nums hover:bg-black/80"
    >
      <span>
        <span className="opacity-60">I</span> {fmt(reading.integrated)} <span className="opacity-60">LUFS</span>
      </span>
      <span className={hot ? "text-red-400" : undefined}>
        <span className="opacity-60">TP</span> {fmt(reading.truePeak)} <span className="opacity-60">dBTP</span>
      </span>
    </button>
  );
};
