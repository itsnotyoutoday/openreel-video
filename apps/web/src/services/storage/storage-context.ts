import {
  StorageEngine,
  createEngineStorageProvider,
  type FileHandleStore,
  type RecentProjectStore,
  type SnapshotStore,
  type StorageProvider,
} from "@openreel/core";
import { IdbRecentStore } from "./idb-recent-store";
import { IdbSnapshotStore } from "./idb-snapshot-store";

interface DefaultParts {
  readonly provider: StorageProvider;
  readonly snapshots: SnapshotStore;
  readonly recents: RecentProjectStore;
  readonly handles: FileHandleStore;
}

let defaults: DefaultParts | null = null;
let active: StorageProvider | null = null;
const listeners = new Set<() => void>();

function getDefaults(): DefaultParts {
  if (!defaults) {
    const provider = createEngineStorageProvider(new StorageEngine());
    defaults = {
      provider,
      snapshots: new IdbSnapshotStore(),
      recents: new IdbRecentStore(),
      handles: provider.handles!,
    };
  }
  return defaults;
}

/**
 * The editor's built-in storage: IndexedDB for projects, media, recovery
 * snapshots and the recent list. This is what the standalone app uses.
 */
export function getDefaultStorageProvider(): StorageProvider {
  const parts = getDefaults();
  return {
    ...parts.provider,
    snapshots: parts.snapshots,
    recents: parts.recents,
  };
}

/** Install a host-provided provider, or `null` to return to the default. */
export function setStorageProvider(provider: StorageProvider | null): void {
  if (active === provider) return;
  active = provider;
  listeners.forEach((listener) => listener());
}

/** Notified whenever {@link setStorageProvider} changes the active provider. */
export function onStorageProviderChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when a host-provided provider is installed. */
export function hasHostStorageProvider(): boolean {
  return active !== null;
}

/** The provider every storage call site goes through. */
export function getStorageProvider(): StorageProvider {
  return active ?? getDefaultStorageProvider();
}

export function getSnapshotStore(): SnapshotStore {
  return active?.snapshots ?? getDefaults().snapshots;
}

export function getRecentStore(): RecentProjectStore {
  return active?.recents ?? getDefaults().recents;
}

export function getFileHandleStore(): FileHandleStore {
  return active?.handles ?? getDefaults().handles;
}
