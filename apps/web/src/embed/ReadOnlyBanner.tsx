import type { ReactElement } from "react";
import { useHostLabel, useReadOnly } from "./host-state";

/** A small "Read only" notice at the top of the editor while the host has locked it. */
export function ReadOnlyBanner(): ReactElement | null {
  const readOnly = useReadOnly();
  const label = useHostLabel("readOnly", "Read only");
  if (!readOnly) return null;
  return (
    <div
      role="status"
      data-openreel-read-only
      className="pointer-events-none absolute left-1/2 top-1 z-[var(--z-toast,50)] -translate-x-1/2 rounded-full border border-border bg-bg-1 px-3 py-0.5 text-[11px] font-semibold text-fg-2 shadow-sm"
    >
      {label}
    </div>
  );
}
