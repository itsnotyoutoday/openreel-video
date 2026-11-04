import type { Project } from "../types/project";
import type { Clip, Track } from "../types/timeline";
import { timelineIntervalsOverlap } from "./timeline-placement";

const ROW_NAMES: Record<string, string> = {
  video: "Video",
  audio: "Audio",
  image: "Image",
  text: "Text",
  graphics: "Graphics",
};

/** The kind label of a row type ("Video", "Text", ...). */
export function rowKindLabel(type: Track["type"]): string {
  return ROW_NAMES[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * The name for a NEW row of this kind, given to it once at creation so it never
 * changes afterwards: "<Kind> N", numbered above every row of that kind (a bare
 * "Video" counts as 1, so the next is "Video 2", then "Video 3"), and never a
 * label another row already carries.
 */
export function nextRowName(tracks: readonly Track[], type: Track["type"]): string {
  const base = rowKindLabel(type);
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: (\\d+))?$`);
  let n = tracks.filter((track) => track.type === type).length + 1;
  for (const track of tracks) {
    const match = pattern.exec(track.name ?? "");
    if (match) n = Math.max(n, (match[1] ? Number(match[1]) : 1) + 1);
  }
  const taken = new Set(tracks.map((track) => track.name));
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/** An empty row of `type`, named like the editor names its own rows. */
export function createEmptyRow(tracks: readonly Track[], type: Track["type"], id?: string): Track {
  return {
    id: id ?? `track-${crypto.randomUUID()}`,
    type,
    name: nextRowName(tracks, type),
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
}

function isClear(clips: readonly Clip[], start: number, duration: number, ignore: ReadonlySet<string>): boolean {
  return clips.every(
    (clip) => ignore.has(clip.id) || !timelineIntervalsOverlap(start, duration, clip.startTime, clip.duration),
  );
}

/**
 * Settle clips that overlap on one row after a load: the later clip moves to a
 * new row of the SAME kind directly above (never to a free row of another kind,
 * such as the Text row). Clips a transition joins may overlap and stay. Returns
 * the same project when nothing overlaps.
 */
export function normalizeLoadedOverlaps(project: Project): Project {
  let changed = false;
  const tracks: Track[] = [];
  const created: Track[] = [];
  for (const track of project.timeline.tracks) {
    const ordered = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    const joined = new Set(
      track.transitions.flatMap((t) => (t.clipBId ? [`${t.clipAId}|${t.clipBId}`, `${t.clipBId}|${t.clipAId}`] : [])),
    );
    const stay: Clip[] = [];
    const overflow: Clip[][] = [];
    for (const clip of ordered) {
      const blocking = stay.some(
        (other) =>
          timelineIntervalsOverlap(clip.startTime, clip.duration, other.startTime, other.duration) &&
          !joined.has(`${clip.id}|${other.id}`),
      );
      if (!blocking) {
        stay.push(clip);
        continue;
      }
      const row = overflow.find((rowClips) => isClear(rowClips, clip.startTime, clip.duration, new Set()));
      if (row) row.push(clip);
      else overflow.push([clip]);
    }
    if (overflow.length === 0) {
      tracks.push(track);
      continue;
    }
    changed = true;
    const placed = new Set(overflow.flat().map((c) => c.id));
    // named like the editor names rows; each new layer sits above the previous one of its kind
    for (const rowClips of overflow) {
      const row = createEmptyRow([...project.timeline.tracks, ...created], track.type);
      created.push({ ...row, clips: rowClips.map((clip) => ({ ...clip, trackId: row.id })) });
    }
    tracks.push({ ...track, clips: track.clips.filter((c) => !placed.has(c.id)) });
  }
  if (!changed) return project;
  // new layers go directly above the highest existing row of their kind (text stays on top)
  const placed = new Set<Track["type"]>();
  const ordered: Track[] = [];
  for (const track of tracks) {
    if (!placed.has(track.type)) {
      placed.add(track.type);
      ordered.push(...created.filter((row) => row.type === track.type).reverse());
    }
    ordered.push(track);
  }
  return { ...project, timeline: { ...project.timeline, tracks: ordered } };
}
