import type { AutomationPoint, Clip, Effect, Timeline, Track } from "../types/timeline";

type TimelineWithTracks = Pick<Timeline, "tracks">;

const LINK_TOLERANCE_SECONDS = 0.01;

const getClipAudioTrackIndex = (clip: Clip): number => clip.audioTrackIndex ?? 0;

const isAlignedLinkedClip = (clip: Clip, candidate: Clip): boolean =>
  candidate.id !== clip.id &&
  candidate.mediaId === clip.mediaId &&
  getClipAudioTrackIndex(candidate) === getClipAudioTrackIndex(clip) &&
  Math.abs(candidate.startTime - clip.startTime) < LINK_TOLERANCE_SECONDS &&
  Math.abs(candidate.inPoint - clip.inPoint) < LINK_TOLERANCE_SECONDS;

export const findClipTrack = (
  timeline: TimelineWithTracks,
  clipId: string,
): { clip: Clip; track: Track } | null => {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) {
      return { clip, track };
    }
  }

  return null;
};

export const getLinkedAudioClips = (
  clip: Clip,
  timeline: TimelineWithTracks,
): Array<{ clip: Clip; track: Track }> => {
  const linkedClips: Array<{ clip: Clip; track: Track }> = [];

  for (const track of timeline.tracks) {
    if (track.id === clip.trackId) {
      continue;
    }

    for (const candidate of track.clips) {
      if (isAlignedLinkedClip(clip, candidate)) {
        linkedClips.push({ clip: candidate, track });
      }
    }
  }

  return linkedClips;
};

export const resolveClipAudioEffects = (
  clip: Clip,
  timeline: TimelineWithTracks,
): Effect[] => {
  const directEffects = clip.audioEffects ?? [];
  if (directEffects.length > 0) {
    return directEffects;
  }

  const linkedClip = getLinkedAudioClips(clip, timeline).find(
    (entry) => (entry.clip.audioEffects ?? []).length > 0,
  );

  return linkedClip?.clip.audioEffects ?? [];
};

/**
 * Volume keyframes (Keyframes panel, `add_keyframe` with property "volume")
 * feed the same automation lane as `clip.automation.volume`. Keyframe time is
 * clip-local seconds and the value is an absolute gain.
 */
const getVolumeKeyframePoints = (clip: Clip): AutomationPoint[] =>
  (clip.keyframes ?? [])
    .filter(
      (keyframe) =>
        keyframe.property === "volume" && typeof keyframe.value === "number",
    )
    .map((keyframe) => ({
      time: keyframe.time,
      value: keyframe.value as number,
    }));

export const resolveClipVolumeAutomation = (
  clip: Clip,
  timeline: TimelineWithTracks,
): AutomationPoint[] => {
  const directAutomation = clip.automation?.volume ?? [];
  if (directAutomation.length > 0) {
    return directAutomation;
  }

  const directKeyframes = getVolumeKeyframePoints(clip);
  if (directKeyframes.length > 0) {
    return directKeyframes;
  }

  const linkedClips = getLinkedAudioClips(clip, timeline);
  const linkedAutomation = linkedClips.find(
    (entry) => (entry.clip.automation?.volume?.length ?? 0) > 0,
  );
  if (linkedAutomation) {
    return linkedAutomation.clip.automation?.volume ?? [];
  }

  for (const entry of linkedClips) {
    const linkedKeyframes = getVolumeKeyframePoints(entry.clip);
    if (linkedKeyframes.length > 0) {
      return linkedKeyframes;
    }
  }

  return [];
};

export const resolveAudibleAudioTarget = (
  clip: Clip,
  timeline: TimelineWithTracks,
): Clip => {
  if (clip.volume > 0) {
    return clip;
  }

  const linkedAudioClip = getLinkedAudioClips(clip, timeline).find(
    (entry) => entry.clip.volume > 0,
  );

  return linkedAudioClip?.clip ?? clip;
};
