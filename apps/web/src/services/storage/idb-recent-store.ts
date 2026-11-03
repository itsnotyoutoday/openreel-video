import type { RecentProjectRecord, RecentProjectStore } from "@openreel/core";

const PROJECT_DB_NAME = "openreel-projects";
const PROJECT_DB_VERSION = 1;
const PROJECTS_STORE = "projects";
const RECENT_STORE = "recent";

/** The default {@link RecentProjectStore}: the recent list in IndexedDB. */
export class IdbRecentStore implements RecentProjectStore {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await this.openDatabase();
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB not supported"));
        return;
      }

      const request = indexedDB.open(PROJECT_DB_NAME, PROJECT_DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };

      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains(RECENT_STORE)) {
          const store = db.createObjectStore(RECENT_STORE, { keyPath: "id" });
          store.createIndex("lastOpened", "lastOpened", { unique: false });
        }
      };
    });
  }

  private async tx(mode: "readonly" | "readwrite"): Promise<IDBTransaction> {
    await this.init();
    return this.db!.transaction(RECENT_STORE, mode);
  }

  async list(): Promise<RecentProjectRecord[]> {
    const tx = await this.tx("readonly");
    return new Promise((resolve, reject) => {
      const request = tx.objectStore(RECENT_STORE).index("lastOpened").getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as RecentProjectRecord[]).sort(
            (a, b) => b.lastOpened - a.lastOpened,
          ),
        );
      request.onerror = () => reject(request.error);
    });
  }

  async get(id: string): Promise<RecentProjectRecord | null> {
    const tx = await this.tx("readonly");
    return new Promise((resolve, reject) => {
      const request = tx.objectStore(RECENT_STORE).get(id);
      request.onsuccess = () =>
        resolve((request.result as RecentProjectRecord | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async put(entry: RecentProjectRecord): Promise<void> {
    const tx = await this.tx("readwrite");
    return new Promise((resolve, reject) => {
      tx.objectStore(RECENT_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async remove(id: string): Promise<void> {
    const tx = await this.tx("readwrite");
    return new Promise((resolve, reject) => {
      tx.objectStore(RECENT_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async clear(): Promise<void> {
    const tx = await this.tx("readwrite");
    return new Promise((resolve, reject) => {
      tx.objectStore(RECENT_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}
