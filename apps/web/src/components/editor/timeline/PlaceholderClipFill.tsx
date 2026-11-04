import React from "react";
import type { PlaceholderClipInfo } from "@openreel/core";

const BARS =
  "repeating-linear-gradient(90deg, var(--placeholder-a, rgba(255,255,255,0.14)) 0 7px, var(--placeholder-b, rgba(255,255,255,0.05)) 7px 14px)";
const HATCH =
  "repeating-linear-gradient(135deg, var(--placeholder-a, rgba(255,255,255,0.14)) 0 5px, var(--placeholder-b, rgba(255,255,255,0.04)) 5px 10px)";

/**
 * The body of a placeholder clip on the timeline: the host's still when it has
 * one, otherwise a pattern, and an optional progress strip along the bottom.
 */
export const PlaceholderClipFill: React.FC<{ info: PlaceholderClipInfo }> = ({ info }) => {
  const progress =
    typeof info.progress === "number" ? Math.min(1, Math.max(0, info.progress)) : null;
  return (
    <div
      data-placeholder-clip
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundColor: "var(--placeholder-bg, #23252c)",
        backgroundImage: info.imageUrl
          ? `url("${info.imageUrl.replace(/"/g, "%22")}")`
          : info.pattern === "hatch"
            ? HATCH
            : BARS,
        backgroundSize: info.imageUrl ? "cover" : undefined,
        backgroundPosition: "center",
      }}
    >
      {progress !== null && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="absolute bottom-0 left-0 h-1 bg-black/40 w-full"
        >
          <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  );
};
