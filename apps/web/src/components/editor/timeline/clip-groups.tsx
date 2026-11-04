import React, { useEffect } from "react";
import { create } from "zustand";
import { Link2, ChevronDown, ChevronRight } from "@/icons/lucide-compat";
import type { Clip, ClipGroup, Project, Track } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";

/** A clip's place in its group (the project's `clipGroups`, `clip.groupId`). */
export interface ClipGroupInfo {
  readonly group: ClipGroup;
  /** Ids of every member, in timeline order. */
  readonly memberIds: readonly string[];
  readonly isFirst: boolean;
  readonly isLast: boolean;
}

export function clipGroupInfo(project: Project, clip: Clip): ClipGroupInfo | null {
  if (!clip.groupId) return null;
  const group = project.clipGroups?.find((candidate) => candidate.id === clip.groupId);
  if (!group) return null;
  const members = project.timeline.tracks
    .flatMap((track) => track.clips)
    .filter((candidate) => candidate.groupId === group.id)
    .sort((a, b) => a.startTime - b.startTime);
  return {
    group,
    memberIds: members.map((member) => member.id),
    isFirst: members[0]?.id === clip.id,
    isLast: members.at(-1)?.id === clip.id,
  };
}

export function useClipGroupInfo(clip: Clip): ClipGroupInfo | null {
  const groups = useProjectStore((state) => state.project.clipGroups);
  const members = useProjectStore((state) => (clip.groupId ? state.project.timeline.tracks : null));
  // recompute when the groups or the tracks change
  return React.useMemo(
    () => (groups && members ? clipGroupInfo(useProjectStore.getState().project, clip) : null),
    [groups, members, clip],
  );
}

interface HintState {
  readonly message: string | null;
  readonly groupId: string | null;
  show(groupId: string, action: string): void;
  clear(): void;
}

const VERBS: Record<string, string> = {
  move: "moving part of",
  split: "splitting",
  trim: "trimming inside",
  delete: "removing part of",
  retime: "retiming part of",
};

let hintTimer: ReturnType<typeof setTimeout> | null = null;

/** The non-modal "this group is locked" notice. */
export const useLockedHint = create<HintState>((set) => ({
  message: null,
  groupId: null,
  show(groupId, action) {
    const label =
      useProjectStore.getState().project.clipGroups?.find((group) => group.id === groupId)?.label ?? "This scene";
    set({ message: `${label} is locked: ${VERBS[action] ?? "changing"} it would break the chain.`, groupId });
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => set({ message: null, groupId: null }), 4000);
  },
  clear: () => set({ message: null, groupId: null }),
}));

/**
 * A blocked gesture: run the edit it would have made so the action system
 * refuses it, which tells the host (`onLockedAction`) and shows the hint.
 */
export async function attemptLockedEdit(clip: Clip, kind: "move" | "trim"): Promise<void> {
  const result = await useProjectStore.getState().executeAction({
    type: kind === "move" ? "clip/move" : "clip/trim",
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params:
      kind === "move"
        ? { clipId: clip.id, startTime: clip.startTime }
        : { clipId: clip.id, inPoint: clip.inPoint + 0.1 },
  } as never);
  const details = result.error?.details as { groupId?: string; action?: string } | undefined;
  if (details?.groupId) useLockedHint.getState().show(details.groupId, details.action ?? kind);
}

/** The hint, anchored to the bottom of the editor. */
export const LockedHint: React.FC = () => {
  const message = useLockedHint((state) => state.message);
  useEffect(() => () => useLockedHint.getState().clear(), []);
  if (!message) return null;
  return (
    <div
      role="status"
      data-locked-hint
      className="pointer-events-none absolute bottom-3 left-1/2 z-[var(--z-toast,50)] -translate-x-1/2 rounded-lg border border-border bg-bg-1 px-3 py-1.5 text-[12px] font-medium text-fg shadow-md"
    >
      {message}
    </div>
  );
};

function toggleCollapsed(group: ClipGroup): void {
  const groups = useProjectStore.getState().project.clipGroups ?? [];
  void useProjectStore.getState().executeAction({
    type: "project/setClipGroups",
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params: { groups: groups.map((g) => (g.id === group.id ? { ...g, collapsed: !g.collapsed } : g)) },
  } as never);
}

/**
 * The bracket drawn over a track's group members: a coloured band with a link
 * icon, the group's name and a "locked" cue, and a chevron that collapses the
 * members into one block.
 */
export const GroupBands: React.FC<{ track: Track; pixelsPerSecond: number }> = ({ track, pixelsPerSecond }) => {
  const groups = useProjectStore((state) => state.project.clipGroups);
  if (!groups?.length) return null;
  return (
    <>
      {groups.map((group) => {
        const members = track.clips.filter((clip) => clip.groupId === group.id);
        if (members.length === 0) return null;
        const start = Math.min(...members.map((clip) => clip.startTime));
        const end = Math.max(...members.map((clip) => clip.startTime + clip.duration));
        const color = group.color ?? "var(--accent)";
        const name = group.label ?? "Scene";
        const left = start * pixelsPerSecond;
        const width = Math.max(24, (end - start) * pixelsPerSecond);
        const Chevron = group.collapsed ? ChevronRight : ChevronDown;
        return (
          <div
            key={group.id}
            data-group-band={group.id}
            data-group-locked={group.locked ? "true" : "false"}
            data-group-collapsed={group.collapsed ? "true" : "false"}
            className="pointer-events-none absolute z-30 overflow-hidden"
            style={{
              left,
              width,
              top: group.collapsed ? 7 : 0,
              height: group.collapsed ? 48 : 7,
              backgroundColor: `color-mix(in srgb, ${color} ${group.collapsed ? 35 : 80}%, transparent)`,
              borderTop: `2px solid ${color}`,
              borderRadius: group.collapsed ? 8 : 0,
            }}
          >
            <div className="pointer-events-auto flex h-full items-start gap-1 whitespace-nowrap px-1 text-[10px] font-semibold leading-[11px] text-white">
              <button
                type="button"
                aria-label={`${group.collapsed ? "Expand" : "Collapse"} ${name}`}
                aria-expanded={!group.collapsed}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleCollapsed(group);
                }}
                className="flex h-[11px] w-[11px] shrink-0 items-center justify-center rounded-sm bg-black/30"
              >
                <Chevron size={9} aria-hidden />
              </button>
              <Link2 size={9} aria-hidden className="mt-px shrink-0" />
              <span data-group-label>
                {name}
                {group.locked ? " · locked" : ""}
                {group.collapsed ? ` · ${members.length} clips` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
};

/** Select every clip of a group as one item. */
export function selectGroup(memberIds: readonly string[]): void {
  const tracks = useProjectStore.getState().project.timeline.tracks;
  const items = memberIds.flatMap((id) => {
    const track = tracks.find((candidate) => candidate.clips.some((clip) => clip.id === id));
    return track ? [{ type: "clip" as const, id, trackId: track.id }] : [];
  });
  if (items.length > 0) useUIStore.getState().selectMultiple(items);
}

/**
 * Drag a locked group as one unit: on release, `clip/moveGroup` by the distance
 * dragged (never before 0). A press without movement is a click and selects the group.
 */
export function startGroupDrag(
  event: React.MouseEvent,
  info: ClipGroupInfo,
  pixelsPerSecond: number,
): void {
  event.stopPropagation();
  const startX = event.clientX;
  const laneAt = (x: number, y: number) =>
    (document.elementsFromPoint(x, y).find((el) => el instanceof HTMLElement && el.dataset.trackId) as HTMLElement | undefined)
      ?.dataset.trackId;
  const grabbedId = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-clip-id]")?.dataset.clipId;
  const fromTrackId =
    useProjectStore.getState().project.timeline.tracks.find((t) => t.clips.some((c) => c.id === grabbedId))?.id ??
    laneAt(event.clientX, event.clientY);
  let moved = false;
  // a live ghost: every member and the band follow the pointer through the CSS `translate` property
  const shown = () =>
    document.querySelectorAll<HTMLElement>(
      `[data-group-id="${CSS.escape(info.group.id)}"], [data-group-band="${CSS.escape(info.group.id)}"]`,
    );
  const startY = event.clientY;
  const onMove = (move: MouseEvent) => {
    // a drag in either direction: a vertical drag moves the group to another row
    if (!moved && Math.hypot(move.clientX - startX, move.clientY - startY) > 4) {
      moved = true;
      document.body.style.cursor = "grabbing";
    }
    // the ghost follows the pointer but lets the row under the pointer be hit-tested
    if (moved) {
      shown().forEach((el) => {
        el.style.translate = `${move.clientX - startX}px ${move.clientY - startY}px`;
        el.style.pointerEvents = "none";
      });
    }
    if (moved && fromTrackId) {
      const over = laneAt(move.clientX, move.clientY);
      const tracks = useProjectStore.getState().project.timeline.tracks;
      const source = tracks.find((t) => t.id === fromTrackId);
      const target = tracks.find((t) => t.id === over);
      const shift = (move.clientX - startX) / pixelsPerSecond;
      // the members on the grabbed row would not fit on another row of their kind: that also makes a new row
      const occupied =
        source &&
        target &&
        target.id !== source.id &&
        source.clips
          .filter((c) => c.groupId === info.group.id)
          .some((c) =>
            target.clips.some(
              (o) => o.groupId !== info.group.id && c.startTime + shift < o.startTime + o.duration && o.startTime < c.startTime + shift + c.duration,
            ),
          );
      document.dispatchEvent(
        new CustomEvent("openreel:new-track-hint", {
          detail:
            source && target && (target.type !== source.type || occupied || (target.id !== source.id && target.locked))
              ? { trackId: target.id, type: source.type }
              : { trackId: null },
        }),
      );
    }
  };
  const onUp = (up: MouseEvent) => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.dispatchEvent(new CustomEvent("openreel:new-track-hint", { detail: { trackId: null } }));
    // the row under the pointer, read while the ghost still lets it through: the group's members from the
    // row it was grabbed on go there when it is the same kind and free, else to one new row of their kind
    const targetTrackId = moved ? laneAt(up.clientX, up.clientY) : undefined;
    shown().forEach((el) => {
      el.style.translate = "";
      el.style.pointerEvents = "";
    });
    if (!moved) return;
    const project = useProjectStore.getState().project;
    const firstStart = Math.min(
      ...project.timeline.tracks.flatMap((track) => track.clips).filter((c) => c.groupId === info.group.id).map((c) => c.startTime),
    );
    const delta = Math.max((up.clientX - startX) / pixelsPerSecond, -firstStart);
    if (Math.abs(delta) < 1e-3 && (!targetTrackId || targetTrackId === fromTrackId)) return;
    void useProjectStore.getState().executeAction({
      type: "clip/moveGroup",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      params: {
        groupId: info.group.id,
        delta,
        ...(fromTrackId && targetTrackId && fromTrackId !== targetTrackId ? { fromTrackId, targetTrackId } : {}),
      },
    } as never);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

/** Move a whole locked group by `delta` seconds (arrow keys), never before 0. */
export function moveGroupBy(info: ClipGroupInfo, delta: number): void {
  const project = useProjectStore.getState().project;
  const firstStart = Math.min(
    ...project.timeline.tracks.flatMap((track) => track.clips).filter((c) => c.groupId === info.group.id).map((c) => c.startTime),
  );
  const clamped = Math.max(delta, -firstStart);
  if (Math.abs(clamped) < 1e-6) return;
  void useProjectStore.getState().executeAction({
    type: "clip/moveGroup",
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    params: { groupId: info.group.id, delta: clamped },
  } as never);
}
