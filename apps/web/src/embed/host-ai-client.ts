import { makeClientFromSend, withRetry } from "@openreel/agent";
import type { LLMClient, LLMResponse, LLMTurnInput } from "@openreel/agent";
import { useHostAiStore } from "./host-ai";

/**
 * An agent `LLMClient` that sends every model request through the host's
 * transport and reports token use to `ai.onUsage`. It makes no network
 * request of its own.
 */
export function makeHostAiClient(opts: {
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): LLMClient {
  const { options, model } = useHostAiStore.getState();
  if (!options) throw new Error("The host did not provide an AI transport.");
  if (!model.trim()) throw new Error("No AI model is available. Ask the host to configure one.");
  const send = withRetry(
    async (body: unknown) => {
      opts.signal?.throwIfAborted();
      return options.transport.send(body, { signal: opts.signal, onDelta: opts.onDelta });
    },
    { signal: opts.signal, retries: 1 },
  );
  const inner = makeClientFromSend({ provider: "openai", model, omitMaxTokens: true, send });
  return {
    async complete(input: LLMTurnInput): Promise<LLMResponse> {
      const response = await inner.complete(input);
      if (response.usage && options.onUsage) {
        try {
          options.onUsage({
            model,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
          });
        } catch (error) {
          console.error("[OpenReel] ai.onUsage failed:", error);
        }
      }
      return response;
    },
  };
}
