/**
 * The editor's AI, supplied by the host. With `ai` given, the in-editor
 * assistant talks to the host's transport, lists the host's models, and shows
 * no provider, key or base-URL fields.
 */

/**
 * One model request. `body` is an OpenAI chat-completions request body
 * (`model`, `messages`, `tools`, `max_tokens`...); resolve with the completion
 * JSON (`{ choices: [{ message, finish_reason }], usage? }`). While the
 * answer streams in, call `onDelta` with the new text so the chat shows it
 * live. Reject with an `Error` to fail the turn; honour `signal` to cancel.
 */
export interface LLMTransport {
  send(
    body: unknown,
    opts?: { signal?: AbortSignal; onDelta?: (text: string) => void },
  ): Promise<unknown>;
}

/** A model the person can pick. */
export interface HostAiModel {
  readonly id: string;
  readonly label: string;
  /** A short line under the label (price tier, speed...). */
  readonly note?: string;
}

/** Token use of one model request, reported to {@link HostAiOptions.onUsage}. */
export interface HostAiUsage {
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface HostAiOptions {
  /** Where model requests go. The editor makes no other model calls. */
  readonly transport: LLMTransport;
  /** The models to offer; called once at mount. Without it a single model, `defaultModel`, is used. */
  readonly models?: () => Promise<readonly HostAiModel[]>;
  /** The model id used until the person picks another. */
  readonly defaultModel?: string;
  /**
   * `true`: the host manages providers and keys. The editor hides every
   * provider, key and base-URL field (and the API Keys settings tab), and never
   * reads or stores a browser key.
   */
  readonly managed?: boolean;
  /** Draw host content in the AI settings (the cogwheel). Return the teardown. */
  readonly renderSettings?: (el: HTMLElement) => () => void;
  /** Shown in the AI settings when the host draws nothing itself. */
  readonly settingsLink?: { readonly label: string; readonly href: string };
  /** Appended to the editing system prompt, once per turn. */
  readonly systemPromptExtra?: string | (() => Promise<string>);
  /** Called after every model request that reports token use. */
  readonly onUsage?: (usage: HostAiUsage) => void;
}
