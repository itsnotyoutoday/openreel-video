import type { Timeline } from "./timeline";
import type { TextClip } from "../text/types";
import type { ShapeClip, SVGClip, StickerClip } from "../graphics/types";
import type { AdjustmentLayer } from "../video/adjustment-layer-engine";
import type { Mask } from "../video/mask-engine";
import type { MultiCamGroup } from "../video/multicam-engine";
import type {
  CompoundClip,
  CompoundClipInstance,
} from "../timeline/nested-sequence-engine";
import type {
  MotionComposition,
  MotionCompositionInstance,
} from "../motion/types";
import type { MotionShaderDef } from "../motion/shaders/types";
import type { CreationProjectState } from "../creation";

export interface ProjectSettings {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly sampleRate: number;
  readonly channels: number;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly settings: ProjectSettings;
  readonly mediaLibrary: MediaLibrary;
  readonly timeline: Timeline;
  /** Groups of clips; a locked group keeps its chain intact. Host-provided or set from the host API. */
  readonly clipGroups?: ClipGroup[];
  readonly textClips?: TextClip[];
  readonly shapeClips?: ShapeClip[];
  readonly svgClips?: SVGClip[];
  readonly stickerClips?: StickerClip[];
  readonly adjustmentLayers?: AdjustmentLayer[];
  readonly masks?: Mask[];
  readonly multicamGroups?: MultiCamGroup[];
  readonly compoundClips?: CompoundClip[];
  readonly nestedInstances?: CompoundClipInstance[];
  readonly motionCompositions?: MotionComposition[];
  readonly motionInstances?: MotionCompositionInstance[];
  readonly generatedShaders?: readonly MotionShaderDef[];
  readonly creation?: CreationProjectState;
  /** Feature capabilities required to edit this project without data loss. */
  readonly capabilities?: readonly string[];
  /** Oldest project reader version that can safely open this project. */
  readonly minimumReaderVersion?: string;
}

export interface MediaLibrary {
  readonly items: MediaItem[];
}

/**
 * A named set of clips (for example a scene). While `locked`, its clips move,
 * delete and retime as a unit: inside boundaries cannot be moved, trimmed,
 * split or rippled, but the outer start and end can be trimmed and per-clip
 * effects, volume and colour stay editable.
 */
export interface ClipGroup {
  readonly id: string;
  readonly locked: boolean;
  readonly label?: string;
  /** CSS colour of the bracket and band on the timeline. */
  readonly color?: string;
  readonly collapsed?: boolean;
  /**
   * Members, as clip ids. Only read when the groups are set (`project/setClipGroups`,
   * `editor.setClipGroups`): the clips get this group's id as `groupId` and every other
   * clip of the group is released, so one call defines the groups and their membership.
   * Not stored on the group; membership lives on the clips.
   */
  readonly clipIds?: readonly string[];
}

export interface MediaItem {
  readonly id: string;
  readonly name: string;
  readonly type: "video" | "audio" | "image";
  readonly fileHandle: FileSystemFileHandle | null;
  readonly blob: Blob | null;
  readonly metadata: MediaMetadata;
  readonly thumbnailUrl: string | null;
  readonly waveformData: Float32Array | null;
  readonly filmstripThumbnails?: FilmstripThumbnail[];
  readonly isPlaceholder?: boolean;
  /** Created by the editor for a host placeholder clip; kept out of the media list. */
  readonly hostGenerated?: boolean;
  readonly originalUrl?: string;
  /** File hint stored in JSON for cross-session/cross-machine asset matching */
  readonly sourceFile?: { name: string; size: number; lastModified: number; folder?: string };
  /** True while a background KieAI generation task is in progress */
  readonly isPending?: boolean;
  /** True when polling exhausted all retries — shows manual retry button */
  readonly kieaiError?: boolean;
  /** KieAI task ID used to poll for completion */
  readonly kieaiTaskId?: string;
}

/** Thumbnail for filmstrip display in timeline */
export interface FilmstripThumbnail {
  readonly timestamp: number;
  readonly url: string;
}

export interface MediaMetadata {
  readonly duration: number; // In seconds
  readonly width: number; // For video/image
  readonly height: number; // For video/image
  readonly frameRate: number; // For video
  readonly codec: string;
  readonly sampleRate: number; // For audio
  readonly channels: number; // For audio
  readonly fileSize: number;
  /** Number of audio tracks in the file (may be > 1 for multi-track video/audio files) */
  readonly audioTrackCount?: number;
  /** Optional source-stream flags preserved by modern importers. */
  readonly hasVideo?: boolean;
  readonly hasAudio?: boolean;
}
