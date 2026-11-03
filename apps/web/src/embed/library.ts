// Entry of the embeddable library build (see vite.lib.config.ts). The prelude
// must stay first: it marks the page as embedded before any editor module runs.
import "./prelude";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "../index.css";

export * from "./index";
