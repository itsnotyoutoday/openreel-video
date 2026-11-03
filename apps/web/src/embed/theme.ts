import { useThemeStore, type ThemeMode } from "../stores/theme-store";
import { applyThemeAttributes } from "../utils/theme-target";

/** How a host themes the editor. */
export interface EditorTheme {
  /** Light, dark, or follow the system. Defaults to the editor's own setting. */
  readonly mode?: ThemeMode;
  /**
   * CSS custom properties set on the editor root, for example
   * `{ "--accent": "#ff5a36", "--bg": "#101014" }`. Names start with `--`.
   * They apply to the editor only, never to the host page.
   */
  readonly tokens?: Readonly<Record<string, string>>;
}

const TOKEN_NAME = /^--[A-Za-z0-9_-]+$/;

/** Throws on an invalid theme, before anything has been changed. */
export function validateTheme(theme: EditorTheme | undefined): void {
  for (const name of Object.keys(theme?.tokens ?? {})) {
    if (!TOKEN_NAME.test(name)) {
      throw new Error(`Invalid theme token "${name}"; names start with "--"`);
    }
  }
  if (theme?.mode && !["light", "dark", "auto"].includes(theme.mode)) {
    throw new Error(`Invalid theme mode "${String(theme.mode)}"`);
  }
}

/** Applies a theme to one editor root and can replace or remove it later. */
export function createThemeController(root: HTMLElement): {
  apply(theme: EditorTheme | undefined): void;
  dispose(): void;
} {
  let applied: string[] = [];
  const clear = () => {
    applied.forEach((name) => root.style.removeProperty(name));
    applied = [];
  };
  return {
    apply(theme) {
      validateTheme(theme);
      clear();
      for (const [name, value] of Object.entries(theme?.tokens ?? {})) {
        root.style.setProperty(name, value);
        applied.push(name);
      }
      if (theme?.mode) useThemeStore.getState().setMode(theme.mode);
      else applyThemeAttributes(useThemeStore.getState().isDark);
    },
    dispose: clear,
  };
}
