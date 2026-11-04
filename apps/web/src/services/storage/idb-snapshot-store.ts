import type { SnapshotRecord, SnapshotStore } from "@openreel/core";

const AUTO_SAVE_DB_NAME = "openreel-autosave";
const AUTO_SAVE_DB_VERSION = 1;
const AUTO_SAVE_STORE = "autosaves";

/** The default {@link SnapshotStore}: rotating snapshots in IndexedDB. */
export class IdbSnapshotStore implements SnapshotStore {
  private db: IDBDatabase | null = null;
  private initializationPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = this.openDatabase()
      .then((db) => {
        this.db = db;
        db.onversionchange = () => {
          db.close();
          if (this.db === db) this.db = null;
        };
        db.onclose = () => { if (this.db === db) this.db = null; };
      })
      .finally(() => {
        this.initializationPromise = null;
      });
    return this.initializationPromise;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private async createTransaction(mode: "readonly" | "readwrite"): Promise<IDBTransaction> {
    await this.init();
    const db = this.db;
    if (!db) throw new Error("Database not initialized");
    try {
      return db.transaction(AUTO_SAVE_STORE, mode);
    } catch (error) {
      // Safari can close a connection while a file chooser/background tab is open.
      // No transaction began, so reconnecting once cannot repeat a committed write.
      if (!(error instanceof DOMException) || error.name !== "InvalidStateError") throw error;
      if (this.db === db) this.db = null;
      await this.init();
      if (!this.db) throw error;
      return (this.db as IDBDatabase).transaction(AUTO_SAVE_STORE, mode);
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB not supported"));
        return;
      }

      const request = indexedDB.open(AUTO_SAVE_DB_NAME, AUTO_SAVE_DB_VERSION);

      request.onerror = () => {
        reject(
          new Error(
            `Failed to open auto-save database: ${request.error?.message}`,
          ),
        );
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(AUTO_SAVE_STORE)) {
          const store = db.createObjectStore(AUTO_SAVE_STORE, {
            keyPath: "id",
          });
          store.createIndex("projectId", "projectId", { unique: false });
          store.createIndex("timestamp", "timestamp", { unique: false });
          store.createIndex("slot", "slot", { unique: false });
        }
      };
    });
  }

  async put(record: SnapshotRecord, retainSlots: number): Promise<void> {
    const tx = await this.createTransaction("readwrite");
    return new Promise((resolve, reject) => {
      const store = tx.objectStore(AUTO_SAVE_STORE);
      const request = store.put(record);

      // A successful request is still provisional until its transaction commits.
      // Keep retention in this transaction and read keys only, avoiding copies
      // of every large project snapshot on every auto-save.
      const retainedIds = new Set(
        Array.from({ length: retainSlots }, (_, slot) =>
          `${record.projectId}-slot-${slot}`,
        ),
      );
      const keys = store.index("projectId").getAllKeys(record.projectId);
      keys.onsuccess = () => {
        for (const id of keys.result) {
          if (!retainedIds.has(String(id))) store.delete(id);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Auto-save transaction aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("Auto-save transaction failed"));
      request.onerror = () =>
        reject(new Error(`Failed to save: ${request.error?.message}`));
      keys.onerror = () => reject(keys.error ?? new Error("Failed to prune auto-saves"));
    });
  }

  async delete(id: string): Promise<void> {
    const tx = await this.createTransaction("readwrite");
    return new Promise((resolve, reject) => {
      const store = tx.objectStore(AUTO_SAVE_STORE);
      const request = store.delete(id);

      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Auto-save delete aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("Auto-save delete failed"));
      request.onerror = () =>
        reject(new Error(`Failed to delete: ${request.error?.message}`));
    });
  }

  async list(projectId?: string): Promise<SnapshotRecord[]> {
    const tx = await this.createTransaction("readonly");
    return new Promise((resolve, reject) => {
      const store = tx.objectStore(AUTO_SAVE_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const all = request.result as SnapshotRecord[];
        resolve(projectId ? all.filter((s) => s.projectId === projectId) : all);
      };
      request.onerror = () =>
        reject(new Error(`Failed to get saves: ${request.error?.message}`));
    });
  }

  async get(id: string): Promise<SnapshotRecord | null> {
    const tx = await this.createTransaction("readonly");
    return new Promise((resolve, reject) => {
      const store = tx.objectStore(AUTO_SAVE_STORE);
      const request = store.get(id);

      request.onsuccess = () => resolve((request.result as SnapshotRecord | undefined) ?? null);
      request.onerror = () =>
        reject(new Error(`Failed to get record: ${request.error?.message}`));
    });
  }

  async clear(): Promise<void> {
    const tx = await this.createTransaction("readwrite");
    return new Promise((resolve, reject) => {
      const store = tx.objectStore(AUTO_SAVE_STORE);
      const request = store.clear();

      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Clearing auto-saves aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("Clearing auto-saves failed"));
      request.onerror = () =>
        reject(new Error(`Failed to clear: ${request.error?.message}`));
    });
  }
}
