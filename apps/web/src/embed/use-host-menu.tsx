import { useMemo } from "react";
import type { ToolcraftContextMenuOption } from "@openreel/ui";
import { useProjectStore } from "../stores/project-store";
import { hostClipInfo } from "./host-clips";
import { HostIcon } from "./HostMount";
import { useHostRuntime } from "./host-runtime";
import type { HostMenuItem } from "./types";

/**
 * The host's extra clip menu items as their own group (a divider and a
 * section), or an empty list when the host passed none. A host callback that
 * throws is logged and skipped.
 */
export function useHostClipMenuItems(
  clipId: string,
  revision: unknown,
): ToolcraftContextMenuOption[] {
  const runtime = useHostRuntime();
  const provider = runtime?.options.hostPanels?.clipContextMenu;
  return useMemo(() => {
    if (!provider) return [];
    const info = hostClipInfo(useProjectStore.getState().project, clipId);
    if (!info) return [];
    let items: readonly HostMenuItem[];
    try {
      items = provider(info);
    } catch (error) {
      console.error("[OpenReel] hostPanels.clipContextMenu failed:", error);
      return [];
    }
    if (items.length === 0) return [];
    return [
      { type: "divider" },
      {
        type: "section",
        items: items.map((item) => ({
          label: item.label,
          icon: item.icon ? (
            <HostIcon icon={item.icon} size={14} fallback={<span />} />
          ) : undefined,
          isDisabled: item.disabled,
          className: item.danger ? "text-destructive" : undefined,
          onClick: () => {
            const current = hostClipInfo(useProjectStore.getState().project, clipId) ?? info;
            try {
              item.onSelect(current);
            } catch (error) {
              console.error(`[OpenReel] Host menu item "${item.id}" failed:`, error);
            }
          },
        })),
      },
    ];
    // `revision` stands for the clip's own fields: rebuild when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, clipId, revision]);
}
