import type { Project } from "@openreel/core";

/**
 * What the Effects and Transitions cards draw their animated preview on.
 * Effects use `a`; transitions animate between `a` (outgoing) and `b` (incoming).
 */
export interface PreviewSamples {
  readonly a: string;
  readonly b: string;
}

/** A single image, or an A/B pair (transitions). */
export type PreviewThumb = string | PreviewSamples;

export type EffectPreviewMode = "sample" | "clip";

export const PREVIEW_MODE_STORAGE_KEY = "openreel-effect-preview-mode";

const svgUrl = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * Built-in demo stills: a face-free landscape with bright sky, a hot sun,
 * deep shadows and saturated colour, so blur, vignette, chromatic, glitch and
 * colour effects all read clearly. Procedural SVG, nothing to license.
 */
const SAMPLE_A = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f7fd8"/><stop offset=".62" stop-color="#bfe3ff"/><stop offset="1" stop-color="#fff1c9"/></linearGradient>
<linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fb7d9"/><stop offset="1" stop-color="#14405c"/></linearGradient>
</defs>
<rect width="320" height="180" fill="url(#sky)"/>
<circle cx="236" cy="62" r="20" fill="#fff6d6"/><circle cx="236" cy="62" r="30" fill="#fff6d6" opacity=".35"/>
<path d="M0 118 L48 64 L88 104 L132 48 L190 112 L238 78 L320 126 L320 180 L0 180Z" fill="#274a3d"/>
<path d="M0 132 L60 98 L110 126 L168 92 L230 128 L320 104 L320 180 L0 180Z" fill="#14281f"/>
<rect y="128" width="320" height="52" fill="url(#lake)"/>
<path d="M170 134 h60 M150 146 h96 M180 158 h50" stroke="#fff6d6" stroke-width="3" opacity=".7"/>
<rect x="24" y="22" width="34" height="34" fill="#e8483b"/><rect x="62" y="22" width="34" height="34" fill="#3bb26b"/>
<rect x="100" y="22" width="34" height="34" fill="#f2c230"/>
</svg>`);

const SAMPLE_B = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1446"/><stop offset=".55" stop-color="#c2417a"/><stop offset="1" stop-color="#ffb35c"/></linearGradient>
</defs>
<rect width="320" height="180" fill="url(#dusk)"/>
<circle cx="80" cy="104" r="26" fill="#ffe9a8"/>
<path d="M0 124 Q60 96 120 122 T240 116 T320 124 V180 H0Z" fill="#2a1038"/>
<path d="M0 146 Q80 128 160 146 T320 140 V180 H0Z" fill="#0c0618"/>
<g fill="#fff" opacity=".9"><circle cx="210" cy="30" r="1.6"/><circle cx="250" cy="48" r="1.2"/><circle cx="286" cy="22" r="1.8"/><circle cx="170" cy="18" r="1.2"/></g>
<rect x="206" y="92" width="60" height="38" fill="#f4f1ea"/><rect x="206" y="92" width="30" height="38" fill="#1a1a22"/>
</svg>`);

export const SAMPLE_PREVIEW: PreviewSamples = { a: SAMPLE_A, b: SAMPLE_B };

/** The image to draw for a card's role: `b` samples only matter for transitions. */
export function previewImage(thumb: PreviewThumb, role: "a" | "b"): string {
  return typeof thumb === "string" ? thumb : thumb[role];
}

/**
 * The frame of a clip to preview on: the filmstrip frame nearest the playhead
 * when the playhead is over the clip, else the media's poster. `null` when the
 * clip has no usable image (the caller then uses the sample, never another clip).
 */
export function clipFrameUrl(
  project: Project,
  clipId: string,
  playhead: number,
): string | null {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (!clip) continue;
    const media = project.mediaLibrary.items.find((m) => m.id === clip.mediaId);
    if (!media) return null;
    const strip = media.filmstripThumbnails;
    if (strip && strip.length > 0 && playhead >= clip.startTime && playhead <= clip.startTime + clip.duration) {
      const sourceTime = clip.inPoint + (playhead - clip.startTime) * (clip.speed ?? 1);
      let best = strip[0];
      for (const frame of strip) {
        if (Math.abs(frame.timestamp - sourceTime) < Math.abs(best.timestamp - sourceTime)) best = frame;
      }
      return best.url;
    }
    return media.thumbnailUrl ?? strip?.[0]?.url ?? null;
  }
  return null;
}

/** The clip right after `clipId` on its track, for the incoming side of a transition. */
export function nextClipId(project: Project, clipId: string): string | null {
  for (const track of project.timeline.tracks) {
    const sorted = [...track.clips].sort((x, y) => x.startTime - y.startTime);
    const index = sorted.findIndex((c) => c.id === clipId);
    if (index >= 0) return sorted[index + 1]?.id ?? null;
  }
  return null;
}

/**
 * Resolve what the cards show. Sample mode: the host's stills when it gave
 * them, otherwise the built-in demo. Clip mode: the first selected clip that
 * has a frame (and its neighbour as the incoming side), else the sample.
 */
export function resolvePreviewThumb(args: {
  mode: EffectPreviewMode;
  project: Project;
  selectedClipIds: readonly string[];
  playhead: number;
  host?: { still?: string; stillB?: string };
}): PreviewThumb {
  const sample: PreviewSamples = {
    a: args.host?.still ?? SAMPLE_PREVIEW.a,
    b: args.host?.stillB ?? args.host?.still ?? SAMPLE_PREVIEW.b,
  };
  if (args.mode === "sample") return sample;
  for (const id of args.selectedClipIds) {
    const a = clipFrameUrl(args.project, id, args.playhead);
    if (!a) continue;
    const neighbour = nextClipId(args.project, id);
    const b = neighbour ? clipFrameUrl(args.project, neighbour, args.playhead) : null;
    return { a, b: b ?? sample.b };
  }
  return sample;
}

export function readPreviewMode(): EffectPreviewMode {
  try {
    return window.localStorage.getItem(PREVIEW_MODE_STORAGE_KEY) === "clip" ? "clip" : "sample";
  } catch {
    return "sample";
  }
}

export function writePreviewMode(mode: EffectPreviewMode): void {
  try {
    window.localStorage.setItem(PREVIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Remembering the choice is a convenience only.
  }
}
