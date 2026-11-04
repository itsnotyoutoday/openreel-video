import type { Project, SnapshotRecord, SnapshotStore } from "@openreel/core";
import { getSnapshotStore } from "./storage/storage-context";

export interface AutoSaveConfig {
  interval: number;
  maxSlots: number;
  enabled: boolean;
  debounceTime: number;
}

export interface AutoSaveMetadata {
  id: string;
  projectId: string;
  projectName: string;
  timestamp: number;
  slot: number;
  isRecovery: boolean;
}

type AutoSaveRecord = SnapshotRecord;

const DEFAULT_CONFIG: AutoSaveConfig = {
  interval: 30000, // 30 seconds
  maxSlots: 3,
  enabled: true,
  debounceTime: 2000, // 2 seconds
};

/**
 * A project copy that is safe to serialize: binary media, file handles,
 * waveforms and object-URL thumbnails are dropped (media travels separately,
 * keyed by media id).
 */
/**
 * Stills the editor made for placeholder clips (`hostGenerated`) that no clip
 * uses any more are not saved: in memory they stay, so undoing a delete still
 * finds them.
 */
function isOrphanedHostStill(project: Project, itemId: string, hostGenerated: boolean | undefined): boolean {
  if (!hostGenerated) return false;
  return !project.timeline.tracks.some((track) => track.clips.some((clip) => clip.mediaId === itemId));
}

export function stripProjectForStorage(project: Project): Project {
  const mediaItems = project.mediaLibrary.items
    .filter((item) => !isOrphanedHostStill(project, item.id, item.hostGenerated))
    .map((item) => ({
    ...item,
    blob: null,
    fileHandle: null,
    waveformData: null,
    thumbnailUrl: item.thumbnailUrl?.startsWith("blob:")
      ? null
      : item.thumbnailUrl,
    filmstripThumbnails: undefined,
  }));

  return {
    ...project,
    mediaLibrary: {
      ...project.mediaLibrary,
      items: mediaItems,
    },
  };
}

export function serializeProjectForAutoSave(project: Project): string {
  return JSON.stringify(stripProjectForStorage(project));
}

type AutoSaveEventType = "saved" | "restored" | "error" | "recoveryAvailable";
type AutoSaveEventCallback = (data?: unknown) => void;

export class AutoSaveManager {
  private config: AutoSaveConfig;
  private store: SnapshotStore | null = null;
  private ready = false;
  private initializationPromise: Promise<void> | null = null;
  private savePromise: Promise<void> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private debounceTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastSavedData: string = "";
  private currentSlot: number = 0;
  private listeners: Map<AutoSaveEventType, Set<AutoSaveEventCallback>> =
    new Map();

  private pendingProject: Project | null = null;
  private isDirty: boolean = false;
  private dirtyRevision = 0;
  private getProject: (() => Project) | null = null;

  private flushOnHide = (): void => {
    if (this.getProject) this.pendingProject = this.getProject();
    this.requestSave();
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") this.flushOnHide();
  };

  constructor(config: Partial<AutoSaveConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.config.maxSlots = Math.max(1, Math.floor(this.config.maxSlots) || 1);
  }

  /** The active snapshot store; switching providers re-initializes. */
  private currentStore(): SnapshotStore {
    const store = getSnapshotStore();
    if (this.store !== store) {
      this.store = store;
      this.ready = false;
      this.initializationPromise = null;
    }
    return store;
  }

  isInitialized(): boolean {
    this.currentStore();
    return this.ready;
  }

  async initialize(): Promise<void> {
    const store = this.currentStore();
    if (this.ready) return;
    if (this.initializationPromise) return this.initializationPromise;

    const initialization = Promise.resolve(store.init?.())
      .then(() => {
        if (this.store === store) this.ready = true;
      })
      .catch((error) => {
        console.error("[AutoSave] Failed to initialize:", error);
        this.emit("error", { error, message: "Failed to initialize auto-save" });
      })
      .finally(() => {
        if (this.initializationPromise === initialization) {
          this.initializationPromise = null;
        }
      });
    this.initializationPromise = initialization;
    return initialization;
  }

  start(getProject: () => Project): void {
    this.stop();
    this.getProject = getProject;
    this.pendingProject = getProject();

    if (!this.config.enabled) {
      return;
    }

    this.requestSave();

    // Set up periodic saves
    this.intervalId = setInterval(() => {
      this.pendingProject = getProject();
      this.requestSave();
    }, this.config.interval);

    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.flushOnHide);
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.debounceTimeoutId) {
      clearTimeout(this.debounceTimeoutId);
      this.debounceTimeoutId = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.flushOnHide);
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.getProject = null;
  }

  markDirty(project?: Project): void {
    // Capture the state that caused this dirty notification. The debounce can
    // fire well before the periodic refresh in start(), so relying on the
    // previous pendingProject would save an older snapshot.
    if (project) {
      this.pendingProject = project;
    } else if (this.getProject) {
      this.pendingProject = this.getProject();
    }
    this.isDirty = true;
    this.dirtyRevision += 1;

    if (!this.config.enabled) return;

    // Debounce the save
    if (this.debounceTimeoutId) {
      clearTimeout(this.debounceTimeoutId);
    }

    this.debounceTimeoutId = setTimeout(() => {
      this.debounceTimeoutId = null;
      this.requestSave();
    }, this.config.debounceTime);
  }

  private requestSave(): void {
    // Background failures are reported by flushPending; explicit forceSave calls
    // keep the rejection so callers cannot report an unsuccessful save as saved.
    void this.saveIfDirty().catch(() => {});
  }

  private async saveIfDirty(force = false): Promise<void> {
    if (!this.config.enabled && !force) return;
    if (this.savePromise) {
      await this.savePromise;
      if (force && this.isDirty) await this.saveIfDirty(true);
      return;
    }

    const pending = this.flushPending(force);
    this.savePromise = pending;
    try {
      await pending;
    } finally {
      this.savePromise = null;
    }
  }

  private async flushPending(force: boolean): Promise<void> {
    try {
      while (this.pendingProject && this.isDirty && (this.config.enabled || force)) {
        const project = this.pendingProject;
        const revision = this.dirtyRevision;
        const data = serializeProjectForAutoSave(project);

        if (data !== this.lastSavedData) {
          await this.save(project, data);
          this.lastSavedData = data;
        }

        // Edits arriving while IndexedDB commits must be saved in a subsequent
        // snapshot. Never let an older write mark those newer edits as clean.
        this.isDirty = revision !== this.dirtyRevision;
      }
    } catch (error) {
      console.error("[AutoSave] Save failed:", error);
      this.emit("error", { error, message: "Auto-save failed" });
      throw error;
    }
  }

  private async save(project: Project, data: string): Promise<void> {
    if (!this.isInitialized()) await this.initialize();
    if (!this.isInitialized()) {
      throw new Error("Auto-save database not initialized");
    }

    const record: AutoSaveRecord = {
      id: `${project.id}-slot-${this.currentSlot}`,
      projectId: project.id,
      projectName: project.name,
      timestamp: Date.now(),
      slot: this.currentSlot,
      data,
    };

    await this.saveRecord(record);

    this.currentSlot = (this.currentSlot + 1) % this.config.maxSlots;

    this.emit("saved", {
      projectId: project.id,
      timestamp: record.timestamp,
      slot: record.slot,
    });
  }

  private async saveRecord(record: AutoSaveRecord): Promise<void> {
    await this.initialize();
    await this.currentStore().put(record, this.config.maxSlots);
  }

  private async deleteRecord(id: string): Promise<void> {
    await this.initialize();
    await this.currentStore().delete(id);
  }

  private async getAllSaves(projectId?: string): Promise<AutoSaveRecord[]> {
    await this.initialize();
    return this.currentStore().list(projectId);
  }

  async checkForRecovery(projectId?: string): Promise<AutoSaveMetadata[]> {
    if (!this.isInitialized()) {
      await this.initialize();
    }

    try {
      const saves = await this.getAllSaves(projectId);

      const metadata: AutoSaveMetadata[] = saves
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((s) => ({
          id: s.id,
          projectId: s.projectId,
          projectName: s.projectName,
          timestamp: s.timestamp,
          slot: s.slot,
          isRecovery: true,
        }));

      if (metadata.length > 0) {
        this.emit("recoveryAvailable", { saves: metadata });
      }

      return metadata;
    } catch (error) {
      console.error("[AutoSave] Failed to check for recovery:", error);
      return [];
    }
  }

  async recover(saveId: string): Promise<Project | null> {
    if (!this.isInitialized()) {
      await this.initialize();
    }

    try {
      const record = await this.getRecord(saveId);
      if (!record) {
        console.warn(`[AutoSave] No save found with id: ${saveId}`);
        return null;
      }

      const project = JSON.parse(record.data) as Project;

      this.emit("restored", { project, timestamp: record.timestamp });
      return project;
    } catch (error) {
      console.error("[AutoSave] Recovery failed:", error);
      this.emit("error", { error, message: "Failed to recover project" });
      return null;
    }
  }

  private async getRecord(id: string): Promise<AutoSaveRecord | null> {
    await this.initialize();
    return this.currentStore().get(id);
  }

  async getMostRecentSave(projectId: string): Promise<AutoSaveMetadata | null> {
    const saves = await this.checkForRecovery(projectId);
    return saves.length > 0 ? saves[0] : null;
  }

  async clearProjectSaves(projectId: string): Promise<void> {
    if (!this.isInitialized()) return;

    const projectSaves = await this.getAllSaves(projectId);

    for (const save of projectSaves) {
      await this.deleteRecord(save.id);
    }
  }

  async clearAllSaves(): Promise<void> {
    if (!this.isInitialized()) return;

    await this.currentStore().clear();
  }

  updateConfig(config: Partial<AutoSaveConfig>): void {
    this.config = { ...this.config, ...config };
    this.config.maxSlots = Math.max(1, Math.floor(this.config.maxSlots) || 1);
    this.currentSlot %= this.config.maxSlots;
    if (this.getProject) this.start(this.getProject);
  }

  getConfig(): AutoSaveConfig {
    return { ...this.config };
  }

  on(event: AutoSaveEventType, callback: AutoSaveEventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: AutoSaveEventType, callback: AutoSaveEventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: AutoSaveEventType, data?: unknown): void {
    this.listeners.get(event)?.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error("[AutoSave] Event callback error:", error);
      }
    });
  }

  async forceSave(project: Project): Promise<void> {
    this.pendingProject = project;
    this.isDirty = true;
    this.dirtyRevision += 1;
    await this.saveIfDirty(true);
  }

  /**
   * Whether the given project has edits that have not been persisted to the
   * latest auto-save slot. Returns false for a pristine session (no edits yet)
   * and once the pending edits have been flushed. Used by the desktop
   * unsaved-changes guard on quit/close.
   */
  hasUnsavedChanges(project: Project): boolean {
    if (!this.isDirty) {
      return false;
    }
    return serializeProjectForAutoSave(project) !== this.lastSavedData;
  }

  destroy(): void {
    this.stop();
    this.store?.close?.();
    this.store = null;
    this.ready = false;
    this.listeners.clear();
  }
}

export const autoSaveManager = new AutoSaveManager();

export async function initializeAutoSave(): Promise<void> {
  await autoSaveManager.initialize();
}

export function startAutoSave(getProject: () => Project): void {
  autoSaveManager.start(getProject);
}

export function stopAutoSave(): void {
  autoSaveManager.stop();
}

export function markProjectDirty(): void {
  autoSaveManager.markDirty();
}

export async function checkForRecovery(
  projectId?: string,
): Promise<AutoSaveMetadata[]> {
  return autoSaveManager.checkForRecovery(projectId);
}

export async function recoverProject(saveId: string): Promise<Project | null> {
  return autoSaveManager.recover(saveId);
}
