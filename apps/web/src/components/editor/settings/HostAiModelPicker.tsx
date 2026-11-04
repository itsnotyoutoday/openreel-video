import type { JSX } from "react";
import { useHostAiStore } from "../../../embed/host-ai";

/**
 * The model list the host offers (`ai.models`). Renders nothing without a host
 * AI, or, in `compact` mode (the chat header), when there is only one model.
 */
export function HostAiModelPicker({
  compact = false,
  disabled = false,
}: {
  compact?: boolean;
  disabled?: boolean;
}): JSX.Element | null {
  const options = useHostAiStore((s) => s.options);
  const models = useHostAiStore((s) => s.models);
  const model = useHostAiStore((s) => s.model);
  const loading = useHostAiStore((s) => s.loadingModels);
  const setModel = useHostAiStore((s) => s.setModel);
  if (!options) return null;
  if (compact && models.length < 2) return null;

  const note = models.find((m) => m.id === model)?.note;
  const select = (
    <select
      aria-label="AI model"
      value={model}
      disabled={disabled || loading || models.length === 0}
      onChange={(event) => setModel(event.target.value)}
      className={
        compact
          ? "h-7 max-w-[7.5rem] truncate rounded-md border border-border bg-bg-2 px-1.5 text-[11px] text-fg focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          : "mt-1.5 w-full rounded-md border border-border bg-bg-2 px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
      }
    >
      {loading && <option value={model}>Loading models…</option>}
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
  if (compact) return select;
  return (
    <label className="block text-xs text-fg-2">
      Model
      {select}
      {note && <span className="mt-1 block text-[11px] text-fg-muted">{note}</span>}
    </label>
  );
}
