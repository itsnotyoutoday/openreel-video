import type { MediaItem, Project, SaveProjectResult } from "@openreel/core";
import { createMissingMediaItem, restoreMediaItem } from "../../utils/media-recovery";
import { stripProjectForStorage } from "../auto-save";
import { getStorageProvider } from "./storage-context";

/**
 * The revision each project was last loaded or saved at, so the next save can
 * ask the provider to reject a stale write.
 */
const revisions = new Map<string, string>();

export function getKnownRevision(projectId: string): string | undefined {
  return revisions.get(projectId);
}

export function setKnownRevision(projectId: string, revision: string): void {
  revisions.set(projectId, revision);
}

/**
 * Give an incoming project (JSON from a host) its media bytes: items the editor
 * already holds keep their file, the rest are read from the storage provider,
 * and items with no bytes anywhere come back as relinkable placeholders.
 */
export async function attachProjectMedia(
  project: Project,
  held: readonly MediaItem[],
): Promise<Project> {
  const heldById = new Map(held.map((item) => [item.id, item]));
  const provider = getStorageProvider();
  const items = await Promise.all(
    project.mediaLibrary.items.map(async (item): Promise<MediaItem> => {
      const local = heldById.get(item.id);
      if (local?.blob) {
        return {
          ...item,
          blob: local.blob,
          fileHandle: local.fileHandle,
          thumbnailUrl: local.thumbnailUrl ?? item.thumbnailUrl,
          waveformData: local.waveformData ?? item.waveformData,
          filmstripThumbnails: local.filmstripThumbnails,
          isPlaceholder: local.isPlaceholder,
        };
      }
      try {
        const record = await provider.getMedia(item.id);
        const blob = record?.blob;
        const file =
          blob && !(blob instanceof File)
            ? new File([blob], item.name, { type: blob.type })
            : blob;
        return await restoreMediaItem(item, file);
      } catch (error) {
        console.warn(`[Storage] Failed to restore media ${item.name}; marking it missing:`, error);
        return createMissingMediaItem(item);
      }
    }),
  );
  return { ...project, mediaLibrary: { ...project.mediaLibrary, items } };
}

export function forgetKnownRevisions(): void {
  revisions.clear();
}

/**
 * Save a project through the active storage provider. Binary media is not part
 * of the document; it is already stored by media id when it is imported.
 */
export async function saveProjectToProvider(
  project: Project,
): Promise<SaveProjectResult> {
  const result = await getStorageProvider().saveProject(
    stripProjectForStorage(project),
    { expectedRevision: revisions.get(project.id) },
  );
  if (result.revision !== undefined) revisions.set(project.id, result.revision);
  return result;
}

/**
 * Load a project from the active storage provider and re-attach its media: the
 * provider returns blobs by media id, which become the items' files again. Items
 * the provider has no blob for come back as relinkable placeholders.
 */
export async function loadProjectFromProvider(
  id: string,
): Promise<Project | null> {
  const provider = getStorageProvider();
  const loaded = await provider.loadProject(id);
  if (!loaded) return null;
  if (loaded.revision !== undefined) revisions.set(id, loaded.revision);

  const stored = await provider.listMedia(id);
  const blobs = new Map(stored.map((record) => [record.id, record.blob]));
  const items = await Promise.all(
    loaded.project.mediaLibrary.items.map(async (item) => {
      try {
        const blob = blobs.get(item.id);
        const file =
          blob && !(blob instanceof File)
            ? new File([blob], item.name, { type: blob.type })
            : blob;
        return await restoreMediaItem(item, file);
      } catch (error) {
        console.warn(
          `[Storage] Failed to restore media ${item.name}; marking it missing:`,
          error,
        );
        return createMissingMediaItem(item);
      }
    }),
  );
  return {
    ...loaded.project,
    mediaLibrary: { ...loaded.project.mediaLibrary, items },
  };
}
