import { describe, expect, it, vi } from "vitest";
import { IdbSnapshotStore } from "./idb-snapshot-store";

type Internals = {
  db: unknown;
  createTransaction(mode: "readonly" | "readwrite"): Promise<IDBTransaction>;
};

describe("IdbSnapshotStore", () => {
  it("reopens a closing database before starting the next transaction", async () => {
    const store = new IdbSnapshotStore();
    const tx = {} as IDBTransaction;
    const closed = { transaction: vi.fn(() => { throw new DOMException("The database connection is closing", "InvalidStateError"); }) };
    const reopened = { transaction: vi.fn(() => tx) };
    const internals = store as unknown as Internals;
    internals.db = closed;
    const init = vi.spyOn(store, "init").mockImplementation(async () => { if (!internals.db) internals.db = reopened; });
    expect(await internals.createTransaction("readwrite")).toBe(tx);
    expect(closed.transaction).toHaveBeenCalledOnce();
    expect(reopened.transaction).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledTimes(2);
  });

  it("does not reconnect or retry quota errors", async () => {
    const store = new IdbSnapshotStore();
    const internals = store as unknown as Internals;
    internals.db = { transaction: vi.fn(() => { throw new DOMException("Storage full", "QuotaExceededError"); }) };
    const init = vi.spyOn(store, "init").mockResolvedValue();
    await expect(internals.createTransaction("readwrite")).rejects.toThrow("Storage full");
    expect(init).toHaveBeenCalledOnce();
  });

  const record = {
    id: "project-1-slot-0",
    projectId: "project-1",
    projectName: "P",
    timestamp: 1,
    slot: 0,
    data: "{}",
  };

  it("does not resolve a put until its transaction commits", async () => {
    const store = new IdbSnapshotStore();
    const request = { result: "project-1-slot-0", error: null, onerror: null };
    const keys = { result: [], error: null, onsuccess: null, onerror: null };
    const tx = {
      error: null as DOMException | null,
      oncomplete: null as (() => void) | null,
      onabort: null as (() => void) | null,
      onerror: null as (() => void) | null,
      objectStore: () => ({
        put: () => request,
        index: () => ({ getAllKeys: () => keys }),
      }),
    };
    (store as unknown as Internals).db = { transaction: () => tx };
    let done = false;
    const putting = store.put(record, 3).then(() => { done = true; });
    await vi.waitFor(() => expect(tx.oncomplete).toBeTypeOf("function"));
    expect(done).toBe(false);

    tx.oncomplete!();
    await putting;
    expect(done).toBe(true);
  });

  it("treats a transaction abort as a failed put even after a successful request", async () => {
    const store = new IdbSnapshotStore();
    const tx = {
      error: new DOMException("Storage full", "QuotaExceededError"),
      oncomplete: null as (() => void) | null,
      onabort: null as (() => void) | null,
      onerror: null as (() => void) | null,
      objectStore: () => ({
        put: () => ({ result: "project-1-slot-0", error: null }),
        index: () => ({ getAllKeys: () => ({ result: [], error: null }) }),
      }),
    };
    (store as unknown as Internals).db = { transaction: () => tx };
    const putting = store.put(record, 3);
    await vi.waitFor(() => expect(tx.onabort).toBeTypeOf("function"));
    tx.onabort!();

    await expect(putting).rejects.toThrow("Storage full");
  });
});
