/**
 * Must be the first import of the embeddable library entry. It marks the page
 * as embedded before any editor module runs, so module-level code (for
 * example the persisted theme) never writes to the host page's `<html>`.
 */
globalThis.__OPENREEL_EMBEDDED__ = true;

export {};
