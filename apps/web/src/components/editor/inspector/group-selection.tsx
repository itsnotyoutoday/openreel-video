import type { ReactElement } from "react";
import type { ClipGroup, Project } from "@openreel/core";

/**
 * The locked group whose members are exactly the given selection, or null.
 * A click on a clip of a locked group selects the whole group as one item; that
 * selection is one thing to the user and gets a summary, not the batch tools
 * (which would edit the members one by one, against the lock).
 */
export function selectedLockedGroup(
  project: Project,
  clipIds: readonly string[],
): ClipGroup | null {
  if (clipIds.length < 2) return null;
  const members = project.timeline.tracks.flatMap((track) => track.clips);
  const selected = clipIds.map((id) => members.find((clip) => clip.id === id));
  if (selected.some((clip) => !clip?.groupId)) return null;
  const groupId = selected[0]?.groupId;
  if (!groupId || selected.some((clip) => clip?.groupId !== groupId)) return null;
  const group = project.clipGroups?.find((candidate) => candidate.id === groupId);
  if (!group?.locked) return null;
  const memberCount = members.filter((clip) => clip.groupId === groupId).length;
  return memberCount === new Set(clipIds).size ? group : null;
}

export function GroupSelectionSummary({
  group,
  clipCount,
}: {
  group: ClipGroup;
  clipCount: number;
}): ReactElement {
  return (
    <div data-group-selection={group.id} className="space-y-1 text-[12px]">
      <p className="font-medium text-fg">{group.label ?? "Scene"}</p>
      <p className="text-fg-muted">
        {clipCount} clips, locked together. Drag it to move the whole group.
      </p>
    </div>
  );
}
