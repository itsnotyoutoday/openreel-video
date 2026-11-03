import type {
  RecentProjectRecord,
  RecentProjectStore,
  SnapshotRecord,
  SnapshotStore,
} from "./storage-provider";

/** An in-memory {@link SnapshotStore} (tests, previews, hosts without IndexedDB). */
export function createMemorySnapshotStore(): SnapshotStore & {
  readonly records: ReadonlyMap<string, SnapshotRecord>;
} {
  const records = new Map<string, SnapshotRecord>();
  return {
    records,
    async put(record, retainSlots) {
      records.set(record.id, record);
      for (const [id, existing] of records) {
        if (existing.projectId === record.projectId && existing.slot >= retainSlots) {
          records.delete(id);
        }
      }
    },
    async list(projectId) {
      return [...records.values()].filter(
        (r) => projectId === undefined || r.projectId === projectId,
      );
    },
    async get(id) {
      return records.get(id) ?? null;
    },
    async delete(id) {
      records.delete(id);
    },
    async clear() {
      records.clear();
    },
  };
}

/** An in-memory {@link RecentProjectStore}. */
export function createMemoryRecentStore(): RecentProjectStore {
  const entries = new Map<string, RecentProjectRecord>();
  return {
    async list() {
      return [...entries.values()].sort((a, b) => b.lastOpened - a.lastOpened);
    },
    async put(entry) {
      entries.set(entry.id, entry);
    },
    async get(id) {
      return entries.get(id) ?? null;
    },
    async remove(id) {
      entries.delete(id);
    },
    async clear() {
      entries.clear();
    },
  };
}
