import type {
  NativeFileRef,
  Project,
  ProjectSettings,
  RecentProjectRecord,
  RecentProjectStore,
  SaveProjectResult,
} from "@openreel/core";
import { normalizeProjectStoredFields } from "@openreel/core";
import { v4 as uuidv4 } from "uuid";
import {
  getRecentStore,
  getStorageProvider,
  hasHostStorageProvider,
} from "./storage/storage-context";
import { saveProjectToProvider } from "./storage/project-persistence";

interface FilePickerAcceptType {
  description: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
}

interface WindowWithFilePicker extends Window {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions,
  ) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (
    options?: OpenFilePickerOptions,
  ) => Promise<FileSystemFileHandle[]>;
}

interface FileHandleWithPermissions extends FileSystemFileHandle {
  queryPermission?: (options: { mode: string }) => Promise<string>;
  requestPermission?: (options: { mode: string }) => Promise<string>;
}

type ProjectFileRef = FileSystemFileHandle | NativeFileRef;

function isDesktopFs(): boolean {
  return typeof window !== "undefined" && !!window.openreel?.fs;
}

function isNativeRef(ref: unknown): ref is NativeFileRef {
  return (
    !!ref &&
    typeof ref === "object" &&
    (ref as NativeFileRef).kind === "native"
  );
}

const MAX_RECENT_PROJECTS = 10;

export type RecentProject = RecentProjectRecord;

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  settings: Partial<ProjectSettings>;
  thumbnail?: string;
  tracks?: Array<{ type: string; name: string }>;
}

const DEFAULT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "blank",
    name: "Blank Project",
    description: "Start from scratch with no pre-configured tracks",
    category: "General",
    settings: { width: 1920, height: 1080, frameRate: 30 },
  },
  {
    id: "youtube-landscape",
    name: "YouTube Landscape",
    description: "1920x1080 at 30fps - Standard YouTube format",
    category: "Social Media",
    settings: { width: 1920, height: 1080, frameRate: 30 },
    tracks: [
      { type: "video", name: "Main Video" },
      { type: "audio", name: "Background Music" },
      { type: "audio", name: "Voiceover" },
    ],
  },
  {
    id: "youtube-short",
    name: "YouTube Shorts",
    description: "1080x1920 at 60fps - Vertical short-form content",
    category: "Social Media",
    settings: { width: 1080, height: 1920, frameRate: 60 },
    tracks: [
      { type: "video", name: "Main Video" },
      { type: "audio", name: "Audio" },
      { type: "text", name: "Captions" },
    ],
  },
  {
    id: "tiktok",
    name: "TikTok",
    description: "1080x1920 at 60fps - Optimized for TikTok",
    category: "Social Media",
    settings: { width: 1080, height: 1920, frameRate: 60 },
    tracks: [
      { type: "video", name: "Main" },
      { type: "audio", name: "Sound" },
    ],
  },
  {
    id: "instagram-reel",
    name: "Instagram Reel",
    description: "1080x1920 at 30fps - Instagram Reels format",
    category: "Social Media",
    settings: { width: 1080, height: 1920, frameRate: 30 },
    tracks: [
      { type: "video", name: "Video" },
      { type: "audio", name: "Audio" },
    ],
  },
  {
    id: "instagram-post",
    name: "Instagram Post",
    description: "1080x1080 at 30fps - Square format for posts",
    category: "Social Media",
    settings: { width: 1080, height: 1080, frameRate: 30 },
    tracks: [{ type: "video", name: "Video" }],
  },
  {
    id: "cinematic-4k",
    name: "Cinematic 4K",
    description: "3840x2160 at 24fps - Film-like quality",
    category: "Professional",
    settings: { width: 3840, height: 2160, frameRate: 24 },
    tracks: [
      { type: "video", name: "A-Roll" },
      { type: "video", name: "B-Roll" },
      { type: "audio", name: "Dialogue" },
      { type: "audio", name: "Music" },
      { type: "audio", name: "SFX" },
    ],
  },
  {
    id: "podcast",
    name: "Podcast Video",
    description: "1920x1080 at 30fps - Audio-focused with waveform visualizer",
    category: "Audio",
    settings: { width: 1920, height: 1080, frameRate: 30 },
    tracks: [
      { type: "video", name: "Background" },
      { type: "audio", name: "Host" },
      { type: "audio", name: "Guest" },
      { type: "graphics", name: "Waveform" },
    ],
  },
  {
    id: "tutorial",
    name: "Screen Recording",
    description: "1920x1080 at 60fps - Perfect for tutorials",
    category: "Educational",
    settings: { width: 1920, height: 1080, frameRate: 60 },
    tracks: [
      { type: "video", name: "Screen" },
      { type: "video", name: "Webcam" },
      { type: "audio", name: "Narration" },
      { type: "text", name: "Annotations" },
    ],
  },
];

type ProjectManagerEvent = "recentUpdated" | "projectSaved" | "projectOpened";
type EventCallback = (data?: unknown) => void;

class ProjectManager {
  private initializedStore: RecentProjectStore | null = null;
  private listeners: Map<ProjectManagerEvent, Set<EventCallback>> = new Map();
  private currentFileHandle: ProjectFileRef | null = null;

  private parseProjectContent(content: string): Project {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("Project file is empty");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `Invalid project file: ${error instanceof Error ? error.message : "Parse error"}`,
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid project file: expected a JSON object");
    }

    const candidate = parsed as Record<string, unknown>;
    const isWrapped =
      typeof candidate.version === "string" &&
      typeof candidate.project === "object" &&
      candidate.project !== null;

    const rawProject = (isWrapped ? candidate.project : parsed) as Project;
    if (typeof rawProject.id !== "string" || typeof rawProject.name !== "string") {
      throw new Error("Invalid project file: missing project id or name");
    }

    return normalizeProjectStoredFields(rawProject);
  }

  async initialize(): Promise<void> {
    const store = getRecentStore();
    await store.init?.();
    this.initializedStore = store;
  }

  /** The recent store once initialized, else null (calls then no-op). */
  private readyStore(): RecentProjectStore | null {
    const store = getRecentStore();
    return this.initializedStore === store ? store : null;
  }

  async createProject(
    options: {
      name?: string;
      templateId?: string;
      settings?: Partial<ProjectSettings>;
    } = {},
  ): Promise<Project> {
    const template = options.templateId
      ? DEFAULT_TEMPLATES.find((t) => t.id === options.templateId) ||
        DEFAULT_TEMPLATES[0]
      : DEFAULT_TEMPLATES[0];

    const settings: ProjectSettings = {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
      channels: 2,
      ...template.settings,
      ...options.settings,
    };

    const tracks =
      template.tracks?.map((t, i) => ({
        id: `track-${Date.now()}-${i}`,
        type: t.type as "video" | "audio" | "image" | "text" | "graphics",
        name: t.name,
        clips: [],
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      })) || [];

    const project: Project = {
      id: uuidv4(),
      name: options.name || "Untitled Project",
      createdAt: Date.now(),
      modifiedAt: Date.now(),
      settings,
      timeline: {
        duration: 0,
        tracks,
        markers: [],
        subtitles: [],
      },
      mediaLibrary: {
        items: [],
      },
    };

    this.currentFileHandle = null;
    this.emit("projectOpened", { project });
    return project;
  }

  /** Save through the active storage provider and announce it. */
  async saveToProvider(project: Project): Promise<SaveProjectResult> {
    const result = await saveProjectToProvider(project);
    await this.addToRecent(project);
    this.emit("projectSaved", { project, revision: result.revision });
    return result;
  }

  async saveProject(project: Project): Promise<boolean> {
    if (hasHostStorageProvider()) {
      // A host owns persistence: save through its storage provider instead of
      // asking the user for a file.
      await this.saveToProvider(project);
      return true;
    }
    if (this.currentFileHandle) {
      return this.saveToFileHandle(project, this.currentFileHandle);
    }
    return this.saveProjectAs(project);
  }

  async saveProjectAs(project: Project): Promise<boolean> {
    if (isDesktopFs()) {
      const filePath = await window.openreel!.fs.showSaveDialog({
        defaultPath: `${project.name}.oreel`,
        filters: [{ name: "OpenReel Project", extensions: ["oreel", "json"] }],
      });
      if (!filePath) return false;
      await window.openreel!.fs.writeFile(
        filePath,
        JSON.stringify(project, null, 2),
      );
      this.currentFileHandle = { kind: "native", path: filePath };
      await this.addToRecent(project, this.currentFileHandle);
      this.emit("projectSaved", { project });
      return true;
    }

    if (!("showSaveFilePicker" in window)) {
      return this.downloadProject(project);
    }

    let handle: FileSystemFileHandle;
    try {
      const win = window as WindowWithFilePicker;
      handle = await win.showSaveFilePicker!({
        suggestedName: `${project.name}.oreel`,
        types: [
          {
            description: "OpenReel Project",
            accept: { "application/json": [".oreel", ".json"] },
          },
        ],
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return false;
      }
      console.warn(
        "[ProjectManager] showSaveFilePicker unavailable; falling back to download",
        error,
      );
      return this.downloadProject(project);
    }

    // Picker cancellation returns false. A selected file that fails to write
    // must reject so callers can distinguish failure and report it to the user.
    await this.saveToFileHandle(project, handle);
    this.currentFileHandle = handle;
    await this.addToRecent(project, handle);
    return true;
  }

  private async saveToFileHandle(
    project: Project,
    handle: ProjectFileRef,
  ): Promise<boolean> {
    const data = JSON.stringify(project, null, 2);
    if (isNativeRef(handle)) {
      await window.openreel!.fs.writeFile(handle.path, data);
      this.emit("projectSaved", { project });
      return true;
    }

    const writable = await handle.createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (error) {
      // Release the stream/lock and discard partial data when writing fails.
      await writable.abort().catch(() => {});
      throw error;
    }

    this.emit("projectSaved", { project });
    return true;
  }

  private downloadProject(project: Project): boolean {
    const data = JSON.stringify(project, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name}.oreel`;
    try {
      document.body.appendChild(a);
      a.click();
    } finally {
      a.remove();
      URL.revokeObjectURL(url);
    }

    this.emit("projectSaved", { project });
    return true;
  }

  async openProject(): Promise<Project | null> {
    if (isDesktopFs()) {
      const filePath = await window.openreel!.fs.showOpenDialog({
        filters: [{ name: "OpenReel Project", extensions: ["oreel", "json"] }],
      });
      if (!filePath) return null;
      const content = await window.openreel!.fs.readFile(filePath);
      let project: Project;
      try {
        project = this.parseProjectContent(content);
      } catch (error) {
        console.error("[ProjectManager] Open (native) failed:", error);
        return null;
      }
      this.currentFileHandle = { kind: "native", path: filePath };
      await this.addToRecent(project, this.currentFileHandle);
      this.emit("projectOpened", { project });
      return project;
    }

    if ("showOpenFilePicker" in window) {
      try {
        const win = window as WindowWithFilePicker;
        const [handle] = await win.showOpenFilePicker!({
          types: [
            {
              description: "OpenReel Project",
              accept: { "application/json": [".oreel", ".json"] },
            },
          ],
          multiple: false,
        });

        const file = await handle.getFile();
        const content = await file.text();
        const project = this.parseProjectContent(content);

        this.currentFileHandle = handle;
        await this.addToRecent(project, handle);
        this.emit("projectOpened", { project });

        return project;
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return null;
        }
        console.error("[ProjectManager] Open failed:", error);
        return null;
      }
    }

    return this.openProjectViaInput();
  }

  private openProjectViaInput(): Promise<Project | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".oreel,.json";

      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }

        try {
          const content = await file.text();
          const project = this.parseProjectContent(content);
          await this.addToRecent(project);
          this.emit("projectOpened", { project });
          resolve(project);
        } catch (error) {
          console.error("[ProjectManager] Parse failed:", error);
          resolve(null);
        }
      };

      input.click();
    });
  }

  async openRecentProject(
    recentProject: RecentProject,
  ): Promise<Project | null> {
    if (recentProject.fileHandle) {
      if (isNativeRef(recentProject.fileHandle)) {
        try {
          const content = await window.openreel!.fs.readFile(
            recentProject.fileHandle.path,
          );
          const project = this.parseProjectContent(content);
          this.currentFileHandle = recentProject.fileHandle;
          await this.updateRecentTimestamp(recentProject.id);
          this.emit("projectOpened", { project });
          return project;
        } catch (error) {
          console.error("[ProjectManager] Open recent (native) failed:", error);
          await this.removeFromRecent(recentProject.id);
          return null;
        }
      }

      try {
        const handle = recentProject.fileHandle as FileHandleWithPermissions;
        const permission = await handle.queryPermission?.({ mode: "read" });
        if (permission !== "granted") {
          const request = await handle.requestPermission?.({ mode: "read" });
          if (request !== "granted") {
            return null;
          }
        }

        const file = await handle.getFile();
        const content = await file.text();
        const project = this.parseProjectContent(content);

        this.currentFileHandle = handle;
        await this.updateRecentTimestamp(recentProject.id);
        this.emit("projectOpened", { project });

        return project;
      } catch (error) {
        console.error("[ProjectManager] Open recent failed:", error);
        await this.removeFromRecent(recentProject.id);
        return null;
      }
    }

    return this.loadProjectFromDb(recentProject.id);
  }

  private async loadProjectFromDb(id: string): Promise<Project | null> {
    try {
      const loaded = await getStorageProvider().loadProject(id);
      if (loaded) {
        this.emit("projectOpened", { project: loaded.project });
      }
      return loaded?.project ?? null;
    } catch {
      return null;
    }
  }

  async getRecentProjects(): Promise<RecentProject[]> {
    if (!this.readyStore()) {
      await this.initialize();
    }

    try {
      const items = await getRecentStore().list();
      return items
        .sort((a, b) => b.lastOpened - a.lastOpened)
        .slice(0, MAX_RECENT_PROJECTS);
    } catch {
      return [];
    }
  }

  async addToRecent(
    project: Project,
    fileHandle?: ProjectFileRef,
  ): Promise<void> {
    const store = this.readyStore();
    if (!store) return;

    const recentProject: RecentProject = {
      id: project.id,
      name: project.name,
      lastOpened: Date.now(),
      fileHandle,
      duration: project.timeline.duration,
      trackCount: project.timeline.tracks.length,
    };

    try {
      await store.put(recentProject);
    } catch {
      return;
    }
    this.emit("recentUpdated");
    void this.cleanupOldRecent();
  }

  private async updateRecentTimestamp(id: string): Promise<void> {
    const store = this.readyStore();
    if (!store) return;

    try {
      const recent = await store.get(id);
      if (recent) {
        await store.put({ ...recent, lastOpened: Date.now() });
      }
    } catch {
      // The recent list is best-effort.
    }
  }

  async removeFromRecent(id: string): Promise<void> {
    const store = this.readyStore();
    if (!store) return;

    try {
      await store.remove(id);
    } catch {
      return;
    }
    this.emit("recentUpdated");
  }

  private async cleanupOldRecent(): Promise<void> {
    const recent = await this.getRecentProjects();
    if (recent.length > MAX_RECENT_PROJECTS) {
      const toRemove = recent.slice(MAX_RECENT_PROJECTS);
      for (const item of toRemove) {
        await this.removeFromRecent(item.id);
      }
    }
  }

  async clearRecentProjects(): Promise<void> {
    const store = this.readyStore();
    if (!store) return;

    try {
      await store.clear();
    } catch {
      return;
    }
    this.emit("recentUpdated");
  }

  getTemplates(): ProjectTemplate[] {
    return [...DEFAULT_TEMPLATES];
  }

  getTemplatesByCategory(): Map<string, ProjectTemplate[]> {
    const map = new Map<string, ProjectTemplate[]>();
    for (const template of DEFAULT_TEMPLATES) {
      const existing = map.get(template.category) || [];
      existing.push(template);
      map.set(template.category, existing);
    }
    return map;
  }

  getCurrentFileHandle(): ProjectFileRef | null {
    return this.currentFileHandle;
  }

  /** Imported independent copies must not overwrite a previously opened file. */
  releaseCurrentFileHandle(): void {
    this.currentFileHandle = null;
  }

  hasUnsavedChanges(project: Project): boolean {
    const projectWithSavedAt = project as Project & { lastSavedAt?: number };
    return (
      !this.currentFileHandle ||
      project.modifiedAt > (projectWithSavedAt.lastSavedAt ?? 0)
    );
  }

  on(event: ProjectManagerEvent, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  private emit(event: ProjectManagerEvent, data?: unknown): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (error) {
        console.error("[ProjectManager] Event callback error:", error);
      }
    });
  }
}

export const projectManager = new ProjectManager();

export async function initializeProjectManager(): Promise<void> {
  await projectManager.initialize();
}
