import type { Plugin as PostcssPlugin, Rule } from "postcss";

/**
 * PostCSS plugin for the embeddable build. The editor's design tokens are
 * declared on `:root`, and resets target `html`/`body`; in a host page those
 * would restyle the host. This moves token blocks to the editor root element
 * (`[data-openreel-root]`) and drops page-level `html`/`body` selectors.
 */
export function scopeRootCss(
  options: { readonly rootSelector?: string } = {},
): PostcssPlugin {
  const rootSelector = options.rootSelector ?? "[data-openreel-root]";
  const PAGE_LEVEL = /^(html|body)$/;

  return {
    postcssPlugin: "openreel-scope-root-css",
    Rule(rule: Rule) {
      if (rule.parent?.type === "atrule") {
        const name = (rule.parent as { name?: string }).name;
        if (name === "keyframes" || name === "-webkit-keyframes") return;
      }
      const selectors = rule.selectors.flatMap((selector) => {
        const trimmed = selector.trim();
        if (PAGE_LEVEL.test(trimmed)) return [];
        return [trimmed.replace(/(^|[\s>+~])(:root)(?![\w-])/g, `$1${rootSelector}`)];
      });
      if (selectors.length === 0) {
        rule.remove();
        return;
      }
      const next = [...new Set(selectors)];
      if (next.join(",") !== rule.selectors.map((s) => s.trim()).join(",")) {
        rule.selectors = next;
      }
    },
  };
}
scopeRootCss.postcss = true as const;
