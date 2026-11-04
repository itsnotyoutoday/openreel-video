import { getHostRuntime } from "../embed/host-runtime";

/**
 * The URL prefix the app is served under, always ending in "/". An embedding
 * host sets it with `mountEditor({ basePath })`; otherwise it is the build's
 * Vite `base` (`/` unless the build was made with `OPENREEL_BASE`).
 */
export function getBasePath(): string {
  const base = getHostRuntime()?.options.basePath ?? import.meta.env.BASE_URL ?? "/";
  return base.endsWith("/") ? base : `${base}/`;
}

/** URL of a file from `apps/web/public`, valid under any sub-path. */
export function assetUrl(path: string): string {
  return `${getBasePath()}${path.replace(/^\/+/, "")}`;
}
