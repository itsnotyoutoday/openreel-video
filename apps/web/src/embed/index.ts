export { mountEditor } from "./mount";
/** True in bundles that support the `ai` host option (managed AI transport, models and settings). */
export const aiSupported = true;
/** True in bundles that have `hostPanels`, placeholder clips and the host-state hooks. */
export const hostPanelsSupported = true;
/** True in bundles where `hostPanels.inspector` can replace the inspector and `when` takes the selection. */
export const inspectorReplaceSupported = true;
/** True in bundles that have `editor.openExport()`, `save()` and `getSaveState()`. */
export const openExportSupported = true;
/** True in bundles with edit locks (`setTrackLocked`, `setClipLocks`), host markers (`setMarkers`), `meters` and placeholder `previewUrl`. */
export const hostCraftSupported = true;
export { BRIDGE_VERSION, BRIDGE_KEYS, BRIDGE_CAPABILITIES, type EditorBridge, type BridgeKey } from "./bridge";
export type { HostBridge, HostChromeItem, HostLabelKey } from "./types";
export type { ClipGroup } from "@openreel/core";
export type {
  LLMTransport,
  HostAiOptions,
  HostAiModel,
  HostAiUsage,
} from "./ai-types";
export type { EditorTheme } from "./theme";
export type {
  EditorEvents,
  ExportedFile,
  SelectedTimelineItem,
  EditorHostOptions,
  HostMediaAsset,
  HostMediaSource,
  HostPanels,
  HostMediaTab,
  HostExportTarget,
  HostExportSettings,
  ExportTargetPhase,
  HostChrome,
  HostMediaTabApi,
  HostDragAsset,
  HostInspectorTab,
  HostInspectorApi,
  HostInspector,
  HostSelection,
  HostMediaRef,
  HostClipInfo,
  HostMenuItem,
  AddPlaceholderOptions,
  PlaceholderPatch,
  MountedEditor,
  HostMarker,
  HostMeters,
} from "./types";
export type { PlaceholderClipInfo, ClipMetadata, ClipLocks } from "@openreel/core";
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
export {
  registerTool,
  unregisterTool,
  extendToolSchema,
  executeTool,
  getTool,
  listTools,
} from "@openreel/agent";
export type {
  HostToolDefinition,
  ToolSchemaExtension,
  EditingHost,
  ToolResult,
} from "@openreel/agent";
