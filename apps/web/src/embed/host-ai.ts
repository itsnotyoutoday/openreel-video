import { create } from "zustand";
import type { HostAiModel, HostAiOptions } from "./ai-types";
import { getHostRuntime } from "./host-runtime";

interface HostAiState {
  /** The host's `ai` option; `null` when the host passed none (the editor works as before). */
  readonly options: HostAiOptions | null;
  readonly models: readonly HostAiModel[];
  readonly model: string;
  readonly loadingModels: boolean;
  readonly setModel: (id: string) => void;
}

export const useHostAiStore = create<HostAiState>((set) => ({
  options: null,
  models: [],
  model: "",
  loadingModels: false,
  setModel: (id) => set({ model: id }),
}));

/** True while the host supplies the AI. */
export function hasHostAi(): boolean {
  return useHostAiStore.getState().options !== null;
}

/** True when the host also manages providers and keys: no key, provider or base-URL UI. */
export function isManagedAi(): boolean {
  return useHostAiStore.getState().options?.managed === true;
}

/**
 * Called by `mountEditor`: installs the host's AI and loads its model list.
 * Returns the cleanup that restores the editor's own AI settings.
 */
export function initHostAi(ai: HostAiOptions | undefined): () => void {
  if (!ai) return () => undefined;
  if (typeof ai.transport?.send !== "function") {
    throw new Error("ai.transport must have a send(body, { signal, onDelta }) method");
  }
  const fallback = ai.defaultModel?.trim() ?? "";
  useHostAiStore.setState({
    options: ai,
    models: fallback ? [{ id: fallback, label: fallback }] : [],
    model: fallback,
    loadingModels: Boolean(ai.models),
  });
  let cancelled = false;
  if (ai.models) {
    Promise.resolve()
      .then(() => ai.models?.())
      .then((models) => {
        if (cancelled) return;
        const list = models ?? [];
        const current = useHostAiStore.getState().model;
        const keep = list.some((m) => m.id === current) ? current : "";
        useHostAiStore.setState({
          models: list,
          model: keep || (list.some((m) => m.id === fallback) ? fallback : (list[0]?.id ?? fallback)),
          loadingModels: false,
        });
      })
      .catch((error: unknown) => {
        console.error("[OpenReel] ai.models failed:", error);
        if (!cancelled) useHostAiStore.setState({ loadingModels: false });
      });
  }
  return () => {
    cancelled = true;
    useHostAiStore.setState({ options: null, models: [], model: "", loadingModels: false });
  };
}

/** The editing system prompt plus the host's `systemPromptExtra`. */
export async function withHostSystemPrompt(base: string): Promise<string> {
  const extra = useHostAiStore.getState().options?.systemPromptExtra;
  if (!extra) return base;
  try {
    const text = typeof extra === "function" ? await extra() : extra;
    return text?.trim() ? `${base}\n\n${text.trim()}` : base;
  } catch (error) {
    console.error("[OpenReel] ai.systemPromptExtra failed:", error);
    return base;
  }
}

function callEvent(name: string, fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch (error) {
    console.error(`[OpenReel] events.${name} failed:`, error);
  }
}

/** Tell the host about a chat message (`events.onAiMessage`). */
export function emitAiMessage(role: "user" | "assistant", text: string): void {
  const handler = getHostRuntime()?.options.events?.onAiMessage;
  callEvent("onAiMessage", handler && (() => handler({ role, text })));
}

/** Tell the host about an AI tool starting or ending (`events.onToolCall`). */
export function emitToolCall(name: string, phase: "start" | "end", ok?: boolean): void {
  const handler = getHostRuntime()?.options.events?.onToolCall;
  callEvent("onToolCall", handler && (() => handler({ name, phase, ...(ok === undefined ? {} : { ok }) })));
}
