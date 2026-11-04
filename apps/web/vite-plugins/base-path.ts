/**
 * Public path of the build. `OPENREEL_BASE=/tools/editor/` serves the app from
 * a sub-path; the default is the site root, and desktop builds use relative
 * paths.
 */
export function resolveBase(
  configured: string | undefined,
  isDesktop: boolean,
): string {
  if (isDesktop) return "./";
  const trimmed = (configured ?? "").replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}
