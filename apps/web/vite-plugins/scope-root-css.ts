import type { Plugin as PostcssPlugin, Rule } from "postcss";

/**
 * PostCSS plugin for the embeddable build. The editor's design tokens are
 * declared on `:root`, and resets target `html`/`body`; in a host page those
 * would restyle the host. This moves token blocks to the editor root element
 * (`[data-openreel-root]`) and drops page-level `html`/`body` selectors.
 *
 * With `scopeAll`, every other rule is also prefixed with the root selector,
 * so Tailwind's preflight (`*`, `button`, `h1` ...), its utilities (`.flex`,
 * `.hidden`, `.bg-background` ...) and the theme rules (`[data-theme=dark]`,
 * `.dark`) can only match elements inside the editor. Loading the bundle then
 * changes no computed style of any host element.
 */
export function scopeRootCss(
  options: {
    readonly rootSelector?: string;
    readonly scopeAll?: boolean;
    /** Prefix `@keyframes` and `@font-face` family names (and every use of them), so they cannot collide with the host's. */
    readonly prefixNames?: string;
  } = {},
): PostcssPlugin {
  const rootSelector = options.rootSelector ?? "[data-openreel-root]";
  const scopeAll = options.scopeAll ?? false;
  const namePrefix = options.prefixNames;
  const keyframeNames = new Set<string>();
  const fontNames = new Set<string>();
  const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, "");
  const PAGE_LEVEL = /^(html|body)$/;
  // Selectors that describe the root element itself (it carries data-theme and the dark class).
  const ON_ROOT = /^(\[data-theme|\.dark\b|\.light\b)/;
  const PSEUDO_START = /^::?[a-z-]+/;

  const scope = (selector: string): string[] => {
    if (selector === rootSelector || selector.startsWith(`${rootSelector}`)) return [selector];
    if (selector === "*") return [rootSelector, `${rootSelector} *`];
    if (PSEUDO_START.test(selector)) {
      return [`${rootSelector}${selector}`, `${rootSelector} ${selector}`];
    }
    if (ON_ROOT.test(selector)) {
      return [`${rootSelector}${selector}`, `${rootSelector} ${selector}`];
    }
    return [`${rootSelector} ${selector}`];
  };

  return {
    postcssPlugin: "openreel-scope-root-css",
    // First pass: collect the names this stylesheet defines and rename the definitions.
    Once(root) {
      if (!namePrefix) return;
      root.walkAtRules((atRule) => {
        if (/^(-webkit-)?keyframes$/.test(atRule.name) && !atRule.params.startsWith(namePrefix)) {
          keyframeNames.add(atRule.params.trim());
          atRule.params = `${namePrefix}${atRule.params.trim()}`;
        }
      });
      root.walkAtRules("font-face", (atRule) => {
        atRule.walkDecls("font-family", (decl) => {
          const name = unquote(decl.value);
          if (name.startsWith(namePrefix)) return;
          fontNames.add(name);
          decl.value = `"${namePrefix}${name}"`;
        });
      });
    },
    // Second pass (after every rule is seen): point every use at the renamed definitions.
    OnceExit(root) {
      if (!namePrefix) return;
      root.walkDecls(/^(-webkit-)?animation(-name)?$|^font-family$|^font$/, (decl) => {
        if (decl.parent?.type === "atrule" && (decl.parent as { name?: string }).name === "font-face") return;
        let value = decl.value;
        for (const name of keyframeNames) {
          if (/animation/.test(decl.prop)) {
            value = value.replace(new RegExp(`(^|[\\s,])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,;])`, "g"), `$1${namePrefix}${name}`);
          }
        }
        if (/font/.test(decl.prop)) {
          for (const name of fontNames) {
            value = value.replace(
              new RegExp(`(["']?)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1(?=\\s*(,|$|;))`, "g"),
              (_match, quote: string) => `${quote || '"'}${namePrefix}${name}${quote || '"'}`,
            );
          }
        }
        if (value !== decl.value) decl.value = value;
      });
    },
    Rule(rule: Rule) {
      if (rule.parent?.type === "atrule") {
        const name = (rule.parent as { name?: string }).name;
        if (name === "keyframes" || name === "-webkit-keyframes") return;
      }
      const selectors = rule.selectors.flatMap((selector) => {
        const trimmed = selector.trim();
        if (PAGE_LEVEL.test(trimmed)) return [];
        const rewritten = trimmed.replace(/(^|[\s>+~])(:root)(?![\w-])/g, `$1${rootSelector}`);
        return scopeAll ? scope(rewritten) : [rewritten];
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
