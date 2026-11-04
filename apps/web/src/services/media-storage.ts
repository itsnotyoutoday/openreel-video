import type { MediaRecord, MediaMetadata } from "@openreel/core";
import {
  getFileHandleStore,
  getStorageProvider,
} from "./storage/storage-context";

export async function saveMediaBlob(
  projectId: string,
  mediaId: string,
  blob: Blob,
  metadata: MediaMetadata,
): Promise<void> {
  const record: MediaRecord = {
    id: mediaId,
    projectId,
    blob,
    metadata,
  };

  await getStorageProvider().putMedia(record);
}

export async function loadMediaBlob(mediaId: string): Promise<Blob | null> {
  const record = await getStorageProvider().getMedia(mediaId);
  return record?.blob || null;
}

export async function loadMediaRecord(
  mediaId: string,
): Promise<MediaRecord | null> {
  return getStorageProvider().getMedia(mediaId);
}

export async function loadProjectMedia(
  projectId: string,
): Promise<MediaRecord[]> {
  return getStorageProvider().listMedia(projectId);
}

export async function deleteMediaBlob(mediaId: string): Promise<void> {
  await getStorageProvider().deleteMedia(mediaId);
}

export async function deleteProjectMedia(projectId: string): Promise<void> {
  const provider = getStorageProvider();
  const records = await provider.listMedia(projectId);
  for (const record of records) {
    await provider.deleteMedia(record.id);
  }
}

export async function saveFileHandle(name: string, size: number, handle: FileSystemFileHandle): Promise<void> {
  await getFileHandleStore().saveFileHandle(name, size, handle);
}

export async function loadFileHandle(name: string, size: number): Promise<FileSystemFileHandle | null> {
  return getFileHandleStore().loadFileHandle(name, size);
}

export async function saveDirectoryHandle(projectId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  await getFileHandleStore().saveDirectoryHandle(projectId, handle);
}

export async function loadDirectoryHandle(projectId: string): Promise<{ handle: FileSystemDirectoryHandle; folderName: string } | null> {
  return getFileHandleStore().loadDirectoryHandle(projectId);
}

export async function getStorageStats(): Promise<{
  used: number;
  quota: number;
  mediaCount: number;
}> {
  const usage = await getStorageProvider().getUsage?.();
  return {
    used: usage?.used ?? 0,
    quota: usage?.quota ?? 0,
    mediaCount: usage?.mediaItems ?? 0,
  };
}

export async function clearAllStorage(): Promise<void> {
  const provider = getStorageProvider();
  await provider.clearAll?.();

  const databasesToDelete = ["openreel-autosave", "openreel-projects", "openreel-templates"];
  await Promise.allSettled(
    databasesToDelete.map(
      (dbName) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(dbName);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => resolve();
        }),
    ),
  );
}
