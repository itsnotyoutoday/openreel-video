import { getMissingExportMedia } from "@openreel/core";
import React, { useCallback, useState, useEffect, useMemo, useRef } from "react";
import {
  X,
  Settings,
  MoreHorizontal,
  Video,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import {
  getDeviceProfile,
  estimateExportTime,
  trackHasAudioItems,
  type VideoExportSettings,
  type AudioExportSettings,
  type DeviceProfile,
  type TimeEstimate,
} from "@openreel/core";
import { ExportDialog } from "./ExportDialog";
import { CompressDialog } from "./CompressDialog";
import { deriveSourceExportMatch } from "../../services/export-source-match";
import {
  useExportRunner,
  extForFormat,
  exportFilename,
  createCaptureWritable,
  mimeForExt,
  type ExportDeliveryMode,
} from "../../services/export-runner";
import { useHostRuntime } from "../../embed/host-runtime";
import { importRecordedFile } from "../../embed/host-assets";
import { useChromeHidden, useHostLabel, useHostState } from "../../embed/host-state";
import { runExportTarget, splitExportTargets, targetVideoSettings } from "../../embed/export-targets";
import type { HostExportTarget } from "../../embed/types";
import { ScreenRecorder } from "./ScreenRecorder";
import { HistoryPanel } from "./inspector/HistoryPanel";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SettingsDialog } from "./settings/SettingsDialog";
import { Icon } from "@/icons/Icon";
import { toast } from "../../stores/notification-store";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";
import {
  ToolcraftDropdownMenu as DropdownMenu,
  ToolcraftDropdownMenuItem as DropdownMenuItem,
  ToolcraftIconButton,
  ToolcraftText as Text,
  ToolcraftTextInputControl,
} from "@openreel/ui";

type ExportType =
  | "mp4"
  | "prores"
  | "gif"
  | "wav"
  | "4k-master"
  | "4k-prores"
  | "4k"
  | "1080p-high"
  | "4k-60-master"
  | "1080p-60"
  | "project";

export const Toolbar: React.FC = () => {
  const project = useProjectStore((state) => state.project);
  const loopStart = useTimelineStore((state) => state.loopStart);
  const loopEnd = useTimelineStore((state) => state.loopEnd);
  const renameProject = useProjectStore((state) => state.renameProject);
  const setGlobalExportState = useUIStore((state) => state.setExportState);
  const activeModal = useUIStore((state) => state.activeModal);
  const closeModal = useUIStore((state) => state.closeModal);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const isExportDialogOpen = activeModal === "export";
  const openExportDialog = useCallback(() => {
    setIsExportOpen(false);
    useUIStore.getState().openModal("export");
  }, []);
  const aiMode = useUIStore((s) => s.panels.agentChat?.visible ?? false);
  const hideHeader = useChromeHidden("header");
  const hideAiPanel = useChromeHidden("aiPanel");
  const hideProjectArea = useChromeHidden("projectMenu");
  const hideExport = useChromeHidden("export");
  const hideSaveState = useChromeHidden("saveState");
  const exportLabel = useHostLabel("export", "Export");
  const savedLabel = useHostLabel("save", "Saved!");
  // editor.openExport(): the primary host target when there are targets, otherwise the export dialog
  const exportRequest = useHostState((state) => state.exportRequest);
  const handledExportRequest = useRef(exportRequest);
  const manualLabel = useHostLabel("manual", "Manual");
  const aiEditingLabel = useHostLabel("aiEditing", "AI editing");
  const [isCompressOpen, setIsCompressOpen] = useState(false);
  const importMedia = useProjectStore((state) => state.importMedia);
  const sourceMatch = useMemo(() => deriveSourceExportMatch(project), [project]);
  const hasTimelineContent = (project.timeline?.duration ?? 0) > 0;
  const { track } = useAnalytics();

  // Local editable project name (committed onBlur / Enter)
  const [projectNameDraft, setProjectNameDraft] = useState(project.name);
  useEffect(() => {
    setProjectNameDraft(project.name);
  }, [project.name]);

  const commitProjectName = useCallback(() => {
    const next = projectNameDraft.trim();
    if (next && next !== project.name) {
      void renameProject(next);
    } else {
      setProjectNameDraft(project.name);
    }
  }, [projectNameDraft, project.name, renameProject]);

  const handleExported = useCallback(
    (videoSettings: Partial<VideoExportSettings>) => {
      track(AnalyticsEvents.PROJECT_EXPORTED, {
        format: videoSettings.format ?? "mp4",
        codec: videoSettings.codec ?? "h264",
        width: videoSettings.width ?? project.settings.width,
        height: videoSettings.height ?? project.settings.height,
        frameRate: videoSettings.frameRate ?? project.settings.frameRate,
        duration: project.timeline?.duration ?? 0,
      });
    },
    [project, track],
  );

  const {
    state: exportState,
    runExport,
    runAudioExport,
    showSavePicker,
    markComplete,
    reportProgress,
    beginExport,
    finishExportSoon,
    failExport,
    cancel: handleCancelExport,
    resetError,
  } = useExportRunner({ project, onExported: handleExported });

  // Host-owned export actions (embedded mode only).
  const hostRuntime = useHostRuntime();
  const hostTargets = hostRuntime?.options.exportTargets;
  const hostExportsOnly = hostRuntime?.options.hostChrome?.exportAction === "host";
  const split = useMemo(() => splitExportTargets(hostTargets ?? []), [hostTargets]);
  const targetAbort = useRef<AbortController | null>(null);

  const runHostTarget = useCallback(
    async (target: HostExportTarget) => {
      if (!hasTimelineContent) return;
      setIsExportOpen(false);
      const controller = new AbortController();
      targetAbort.current = controller;
      try {
        await runExportTarget(
          target,
          {
            begin: () => {
              beginExport();
              reportProgress(0, "Preparing");
            },
            render: async (t) => {
              const current = useProjectStore.getState().getFullProject();
              const { settings, ext } = targetVideoSettings(t.settings, current);
              const filename = exportFilename(current.name, ext);
              const mimeType = mimeForExt(ext);
              const capture = createCaptureWritable(filename, mimeType);
              await runExport(settings, ext, capture.writable, { progressRange: [0, 0.7], holdOpen: true });
              return { blob: await capture.blob, filename, mimeType, project: current };
            },
            report: reportProgress,
            complete: (message) => {
              markComplete(message);
              finishExportSoon();
            },
          },
          controller.signal,
        );
      } catch (error) {
        failExport(error);
      } finally {
        if (targetAbort.current === controller) targetAbort.current = null;
      }
    },
    [hasTimelineContent, beginExport, reportProgress, runExport, markComplete, finishExportSoon, failExport],
  );

  const cancelExport = useCallback(() => {
    targetAbort.current?.abort();
    handleCancelExport();
  }, [handleCancelExport]);

  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [exportEstimates, setExportEstimates] = useState<Map<string, TimeEstimate>>(new Map());

  useEffect(() => {
    setGlobalExportState({
      isExporting: exportState.isExporting,
      progress: exportState.progress,
      phase: exportState.phase,
    });
  }, [exportState.isExporting, exportState.progress, exportState.phase, setGlobalExportState]);

  useEffect(() => {
    if (isExportOpen && !deviceProfile) {
      getDeviceProfile().then(setDeviceProfile);
    }
  }, [isExportOpen, deviceProfile]);

  useEffect(() => {
    if (!deviceProfile || !project.timeline?.duration) {
      return;
    }

    const duration = project.timeline.duration;
    const estimates = new Map<string, TimeEstimate>();

    const configs: Array<{ key: string; width: number; height: number; frameRate: number; codec: "h264" | "h265" | "vp9" | "av1" }> = [
      { key: "mp4", width: project.settings.width, height: project.settings.height, frameRate: 30, codec: "h264" },
      { key: "4k", width: 3840, height: 2160, frameRate: 30, codec: "h264" },
      { key: "4k-60-master", width: 3840, height: 2160, frameRate: 60, codec: "h264" },
      { key: "4k-master", width: 3840, height: 2160, frameRate: 30, codec: "h264" },
      { key: "1080p-high", width: 1920, height: 1080, frameRate: 30, codec: "h264" },
      { key: "1080p-60", width: 1920, height: 1080, frameRate: 60, codec: "h264" },
      { key: "prores", width: project.settings.width, height: project.settings.height, frameRate: 30, codec: "h264" },
    ];

    for (const config of configs) {
      const estimate = estimateExportTime(deviceProfile, {
        width: config.width,
        height: config.height,
        frameRate: config.frameRate,
        duration,
        codec: config.codec,
      });
      estimates.set(config.key, estimate);
    }

    setExportEstimates(estimates);
  }, [deviceProfile, project.timeline?.duration, project.settings.width, project.settings.height]);

  const handleExport = useCallback(
    async (type: ExportType) => {
      setIsExportOpen(false);
      if (!hasTimelineContent) return;

      try {
        if (type === "wav") {
          const writable = await showSavePicker(exportFilename(project.name, "wav"), "wav", { delivery: window.openreel?.platform === "desktop" ? "file" : "download" });

          beginExport(writable);

          const audioSettings: Partial<AudioExportSettings> = {
            format: "wav",
            sampleRate: 48000,
            channels: 2,
            bitDepth: 24,
          };

          await runAudioExport(audioSettings, writable);
          markComplete();
          track(AnalyticsEvents.PROJECT_EXPORTED, {
            format: "wav",
            duration: project.timeline?.duration ?? 0,
          });
        } else {
          const base = {
            width: project.settings.width,
            height: project.settings.height,
            frameRate: project.settings.frameRate,
          };

          const presets: Record<string, { settings: Partial<VideoExportSettings>; ext: string }> = {
            mp4: { settings: { ...base, format: "mp4", codec: "h264", bitrate: 12000, quality: 85 }, ext: "mp4" },
            gif: { settings: { ...base, format: "webm", codec: "vp9", bitrate: 8000 }, ext: "webm" },
            project: { settings: { ...base, format: "mp4", codec: "h264", bitrate: 12000, quality: 85 }, ext: "mp4" },
            "4k-60-master": { settings: { ...base, width: 3840, height: 2160, frameRate: 60, format: "mov", codec: "h265", bitrate: 100000, quality: 95 }, ext: "mov" },
            "4k-master": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mov", codec: "h265", bitrate: 80000, quality: 95 }, ext: "mov" },
            "4k-prores": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mov", codec: "prores", bitrate: 880000, quality: 100 }, ext: "mov" },
            "4k": { settings: { ...base, width: 3840, height: 2160, frameRate: 30, format: "mp4", codec: "h264", bitrate: 50000, quality: 90 }, ext: "mp4" },
            "1080p-60": { settings: { ...base, width: 1920, height: 1080, frameRate: 60, format: "mp4", codec: "h264", bitrate: 25000, quality: 95 }, ext: "mp4" },
            "1080p-high": { settings: { ...base, width: 1920, height: 1080, frameRate: 30, format: "mp4", codec: "h264", bitrate: 20000, quality: 95 }, ext: "mp4" },
            prores: { settings: { ...base, format: "mov", codec: "prores", bitrate: 220000, quality: 100 }, ext: "mov" },
          };

          const preset = presets[type] ?? presets.mp4;
          const writable = await showSavePicker(exportFilename(project.name, preset.ext), preset.ext, { delivery: window.openreel?.platform === "desktop" ? "file" : "download" });

          beginExport(writable);

          await runExport(preset.settings, preset.ext, writable);
        }

        finishExportSoon();
      } catch (error) {
        failExport(error);
      }
    },
    [project, hasTimelineContent, track, runExport, runAudioExport, showSavePicker, beginExport, markComplete, finishExportSoon, failExport],
  );

  const handleCustomExport = useCallback(
    async (settings: VideoExportSettings, delivery: ExportDeliveryMode = window.openreel?.platform === "desktop" ? "file" : "download") => {
      closeModal();
      if (!hasTimelineContent) return;

      try {
        const ext = extForFormat(settings.format);
        const writable = await showSavePicker(exportFilename(project.name, ext), ext, { delivery });

        beginExport(writable);

        const needsUpscaling =
          settings.width > project.settings.width ||
          settings.height > project.settings.height;

        const exportSettings: Partial<VideoExportSettings> = {
          ...settings,
          upscaling:
            settings.upscaling?.enabled && needsUpscaling
              ? settings.upscaling
              : undefined,
        };

        await runExport(exportSettings, ext, writable);

        track(AnalyticsEvents.PROJECT_EXPORTED, {
          format: settings.format,
          codec: settings.codec,
          width: settings.width,
          height: settings.height,
          frameRate: settings.frameRate,
          duration: project.timeline?.duration ?? 0,
          exportType: "custom",
          upscaling: settings.upscaling?.enabled ?? false,
        });

        finishExportSoon();
      } catch (error) {
        failExport(error);
      }
    },
    [project, hasTimelineContent, closeModal, track, runExport, showSavePicker, beginExport, finishExportSoon, failExport],
  );


  // hostActions.record: the host takes a finished recording (to its own storage) and may hand back the file to import.
  const hostRecord = useHostRuntime()?.options.hostActions?.record;
  const importRecording = useCallback(
    (file: File) => importRecordedFile(file, hostRecord, importMedia),
    [hostRecord, importMedia],
  );

  // "Relink the original media before exporting": it no longer applies once nothing is missing
  const exportError = exportState.error;
  useEffect(() => {
    if (!exportError?.startsWith("Relink the original media")) return;
    if (getMissingExportMedia(project).length === 0) resetError();
  }, [exportError, project, resetError]);

  useEffect(() => {
    if (exportRequest === handledExportRequest.current) return;
    handledExportRequest.current = exportRequest;
    if (split.primary) void runHostTarget(split.primary);
    else openExportDialog();
  }, [exportRequest, split.primary, runHostTarget, openExportDialog]);

  const handleRecordingComplete = useCallback(
    async (screenBlob: Blob, webcamBlob?: Blob) => {
      if (!screenBlob || screenBlob.size === 0) {
        toast.error(
          "Recording failed",
          "No video data was captured. Please try again.",
        );
        return;
      }

      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[:-]/g, "");
      let importCount = 0;
      const errors: string[] = [];

      const screenFile = new File([screenBlob], `Screen_${timestamp}.webm`, {
        type: screenBlob.type || "video/webm",
      });
      const screenResult = await importRecording(screenFile);
      if (screenResult.success) {
        importCount++;
      } else {
        errors.push(
          screenResult.error?.message || "Failed to import screen recording",
        );
      }

      if (webcamBlob && webcamBlob.size > 0) {
        const webcamFile = new File([webcamBlob], `Webcam_${timestamp}.webm`, {
          type: webcamBlob.type || "video/webm",
        });
        const webcamResult = await importRecording(webcamFile);
        if (webcamResult.success) {
          importCount++;
        } else {
          errors.push(
            webcamResult.error?.message || "Failed to import webcam recording",
          );
        }
      }

      if (importCount > 0) {
        toast.success(
          `${importCount} recording${importCount > 1 ? "s" : ""} imported!`,
          webcamBlob && webcamBlob.size > 0
            ? "Screen and webcam added to assets. Use the timeline to composite them."
            : "Screen recording added to assets.",
        );
      } else if (errors.length > 0) {
        toast.error("Import failed", errors.join(". "));
      }
    },
    [importRecording],
  );

  const projectRes = `${project.settings.width}×${project.settings.height}`;
  const aspectRatio = project.settings.width / project.settings.height;
  const isVertical = aspectRatio < 0.9;

  const exportOptions: Array<{
    label: string;
    iconName: string;
    desc: string;
    type: ExportType;
    recommended?: boolean;
    separator?: boolean;
  }> = [
    {
      label: "MP4 Standard",
      iconName: "bolt",
      desc: `${projectRes} H.264 - Web & social`,
      type: "mp4",
      recommended: true,
    },
    {
      label: "",
      iconName: "film",
      desc: "",
      type: "mp4",
      separator: true,
    },
    ...(isVertical
      ? []
      : [
          {
            label: "4K Standard",
            iconName: "film",
            desc: "3840×2160 - YouTube 4K",
            type: "4k" as ExportType,
          },
        ]),
    {
      label: "1080p High Quality",
      iconName: "film",
      desc: "1920×1080 30fps - High bitrate",
      type: "1080p-high",
    },
    {
      label: "1080p 60fps",
      iconName: "film",
      desc: "1920×1080 - Smooth playback",
      type: "1080p-60",
    },
    {
      label: "Audio Only (WAV)",
      iconName: "music.note",
      desc: "Uncompressed audio",
      type: "wav",
    },
  ];

  return (
    <header
      className="h-[60px] flex items-center gap-2 px-2 sm:gap-[18px] sm:px-[18px] bg-bg-1 border-b border-border shrink-0 z-30 relative"
      // hostChrome.hide "header": the bar collapses but its dialogs (export, recorder, settings) stay mounted
      style={hideHeader ? { height: 0, minHeight: 0, padding: 0, border: 0, overflow: "visible" } : undefined}
      data-header-hidden={hideHeader ? "true" : undefined}
    >
      <div style={{ display: hideHeader ? "none" : "contents" }}>

      {!hideAiPanel && <div role="group" aria-label="Editing mode" className="flex shrink-0 rounded-lg bg-bg-3 p-1 text-xs">
        <button type="button" aria-pressed={!aiMode} className={`rounded-md px-3 py-1.5 ${!aiMode ? "bg-bg-1 text-fg" : "text-fg-muted"}`} onClick={() => useUIStore.getState().setPanelVisible("agentChat", false)}>{manualLabel}</button>
        <button type="button" aria-pressed={aiMode} className={`rounded-md px-3 py-1.5 ${aiMode ? "bg-accent-soft text-accent" : "text-fg-muted"}`} onClick={() => useUIStore.getState().setPanelVisible("agentChat", true)}>{aiEditingLabel}</button>
      </div>}

      {/* ─── Center: project name ─────────────────────────────── */}
      {hideProjectArea ? <div className="flex-1" /> : <div className="flex flex-1 min-w-0 items-center justify-center gap-1.5">
        <div className="hidden sm:block min-w-0">
        <ToolcraftTextInputControl
          label="Project name"
          isLabelHidden
          value={projectNameDraft}
          onChange={setProjectNameDraft}
          onBlur={commitProjectName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.currentTarget as HTMLElement).blur();
            } else if (e.key === "Escape") {
              setProjectNameDraft(project.name);
              (e.currentTarget as HTMLElement).blur();
            }
          }}
          width={Math.min(Math.max(projectNameDraft.length, 6) * 8 + 40, 220)}
          className="max-w-[min(220px,40vw)] bg-transparent border-0 text-center font-medium text-[14px] tracking-tight text-fg-2 px-2 py-0.5 rounded-md min-w-[60px] focus:bg-bg-2 focus:outline-none"
        />
        </div>
        <ProjectSwitcher />
      </div>}

      {/* ─── Right: export only ───────────────────────────────── */}
      <div className="flex items-center justify-end shrink-0">
        {/* Export */}
        {hideExport ? null : exportState.isExporting ? (
          <button
            type="button"
            onClick={cancelExport}
            className="flex items-center gap-1.5 rounded-[8px] bg-bg-3 px-[18px] py-[9px] text-[13px] font-semibold text-fg-2"
          >
            <Icon name="square.and.arrow.up" size={13} ariaHidden />
            {`${Math.round(exportState.progress)}%`}
            <Icon name="xmark" size={11} ariaHidden />
          </button>
        ) : exportState.error ? (
          <button
            type="button"
            onClick={resetError}
            className="flex max-w-[180px] items-center gap-1.5 truncate rounded-[8px] bg-destructive px-[18px] py-[9px] text-[13px] font-semibold text-destructive-foreground"
          >
            <span className="truncate">{exportState.error}</span>
            <Icon name="xmark" size={11} ariaHidden />
          </button>
        ) : exportState.complete && !hideSaveState ? (
          <button
            type="button"
            disabled
            className="flex items-center gap-1.5 rounded-[8px] bg-bg-3 px-[18px] py-[9px] text-[13px] font-semibold text-fg-2"
          >
            <Icon name="checkmark" size={13} ariaHidden />
            <span className="max-w-[260px] truncate">{exportState.phase || savedLabel}</span>
          </button>
        ) : (
          <div className="flex items-stretch">
            <button
              type="button"
              onClick={
                split.primary
                  ? () => void runHostTarget(split.primary!)
                  : hostExportsOnly
                    ? () => void handleExport("mp4")
                    : openExportDialog
              }
              disabled={!hasTimelineContent}
              title={
                hasTimelineContent
                  ? (split.primary?.description ?? "Choose export settings")
                  : "Add media or text to the timeline to export"
              }
              className="rounded-l-[8px] rounded-r-none bg-accent px-[18px] py-[9px] text-[13px] font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {split.primary?.label ?? exportLabel}
            </button>
            <DropdownMenu
              isMenuOpen={isExportOpen}
              onOpenChange={setIsExportOpen}
              hasChevron={false}
              button={{
                label: "Export options",
                variant: "primary",
                size: "sm",
                isIconOnly: true,
                icon: (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="2.4"
                    aria-hidden
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                ),
                className:
                  "rounded-l-none rounded-r-[8px] border-l border-white/25",
                style: {
                  background: "var(--accent)",
                  width: "auto",
                  height: "auto",
                  padding: "9px 8px",
                  borderRadius: "0 8px 8px 0",
                },
              }}
              menuWidth={288}
            >
              <div className="space-y-1 max-h-[400px] overflow-y-auto">
                {split.primary ? (
                  <>
                    {split.groups.map(({ group, items }) => (
                      <div key={group} role="group" aria-label={group === "other" ? "Other formats" : group}>
                        <Text type="supporting" color="secondary" display="block" className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide">
                          {group === "other" ? "Other formats" : group}
                        </Text>
                        {items.map((target) => (
                          <DropdownMenuItem
                            key={target.id}
                            icon={<Icon name="square.and.arrow.up" size={18} ariaHidden />}
                            label={target.label}
                            description={target.description}
                            onClick={() => void runHostTarget(target)}
                          />
                        ))}
                      </div>
                    ))}
                    {split.groups.length > 0 && <div className="my-1 border-t border-border" />}
                    <DropdownMenuItem
                      icon={<Settings size={18} aria-hidden />}
                      label="Custom export..."
                      description="Full settings with AI upscaling"
                      endContent={<MoreHorizontal size={14} className="text-fg-muted" aria-hidden />}
                      onClick={openExportDialog}
                    />
                  </>
                ) : (
                <>
                {exportOptions.map((option, index) =>
                  option.separator ? (
                    <div key={`sep-${index}`} className="my-1 border-t border-border" />
                  ) : (
                    <DropdownMenuItem
                      key={option.type + index}
                      icon={<Icon name={option.iconName} size={18} ariaHidden />}
                      label={
                        <div className="flex items-center gap-2">
                          <Text
                            type="label"
                            weight="bold"
                            className={option.recommended ? "text-accent" : "text-fg"}
                          >
                            {option.label}
                          </Text>
                          {option.recommended && (
                            <Text type="supporting" className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
                              Best match
                            </Text>
                          )}
                        </div>
                      }
                      description={
                        <div>
                          <Text type="supporting" color="secondary" display="block">
                            {option.desc}
                          </Text>
                          {exportEstimates.get(option.type) && (
                            <Text type="supporting" color="secondary" display="block" className="text-[10px]">
                              Est. {exportEstimates.get(option.type)?.formatted}
                            </Text>
                          )}
                        </div>
                      }
                      className={option.recommended ? "bg-accent-soft" : undefined}
                      onClick={() => handleExport(option.type)}
                    />
                  ),
                )}

                <div className="my-1 border-t border-border" />
                <DropdownMenuItem
                  icon={<Settings size={18} aria-hidden />}
                  label="Custom export..."
                  description="Full settings with AI upscaling"
                  endContent={<MoreHorizontal size={14} className="text-fg-muted" aria-hidden />}
                  onClick={openExportDialog}
                />
                <DropdownMenuItem
                  icon={<Video size={18} aria-hidden />}
                  label="Compress video..."
                  description="Shrink any video to a target size"
                  onClick={() => setIsCompressOpen(true)}
                />
                </>
                )}
              </div>
              <Text type="supporting" color="secondary" display="block" className="border-t border-border bg-bg-2 px-3 py-2.5 text-center text-xs">
                {project.settings.width}×{project.settings.height} •{" "}
                {project.settings.frameRate}fps
              </Text>
            </DropdownMenu>
          </div>
        )}
      </div>

      </div>

      {/* ─── Auxiliary popups & dialogs ───────────────────────── */}
      <CompressDialog
        isOpen={isCompressOpen}
        onClose={() => setIsCompressOpen(false)}
      />
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={closeModal}
        onExport={handleCustomExport}
        duration={project.timeline?.duration ?? 0}
        projectWidth={project.settings?.width ?? 1920}
        projectHeight={project.settings?.height ?? 1080}
        frameRate={project.settings?.frameRate ?? 30}
        sourceMatch={sourceMatch}
        hasAudio={project.timeline.tracks.some((track) => trackHasAudioItems(project, track.id))}
        markedRange={loopEnd > loopStart ? { startTime: loopStart, endTime: loopEnd } : null}
      />

      <ScreenRecorder
        isOpen={activeModal === "recorder"}
        onClose={closeModal}
        onRecordingComplete={handleRecordingComplete}
      />

      <SettingsDialog />

      {activeModal === "history" && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={closeModal}
          />
          <div className="fixed top-topbar right-0 bottom-0 w-80 bg-bg-1 border-l border-border z-50 shadow-lg animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between p-3 border-b border-border">
              <Text type="body" weight="bold" className="text-sm text-fg">
                Action history
              </Text>
              <ToolcraftIconButton
                label="Close action history"
                icon={<X size={14} aria-hidden />}
                size="sm"
                variant="ghost"
                onClick={closeModal}
                className="p-1.5 rounded hover:bg-hover text-fg-3 hover:text-fg transition-colors"
              />
            </div>
            <div className="h-[calc(100%-49px)]">
              <HistoryPanel />
            </div>
          </div>
        </>
      )}
    </header>
  );
};

export default Toolbar;
