export { mountEditor } from "./mount";
export type {
  EditorHostOptions,
  HostMediaAsset,
  HostMediaSource,
  MountedEditor,
} from "./types";
export type {
  StorageProvider,
  LoadedProject,
  SaveProjectOptions,
  SaveProjectResult,
  SnapshotStore,
  SnapshotRecord,
  RecentProjectStore,
  RecentProjectRecord,
  FileHandleStore,
} from "@openreel/core";
export {
  StorageConflictError,
  createMemoryStorageProvider,
} from "@openreel/core";
