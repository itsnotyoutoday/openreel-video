import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";

async function measure(page: Page, query: string) {
  await page.goto(`${PATH}${query}`);
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const shell = rect("[data-openreel-root] .editor-shell");
    const timeline = rect("#editor-panel-timeline");
    const stage = document.querySelector('[aria-label="Preview canvas"]')?.getBoundingClientRect();
    return {
      hasHeader: (document.querySelector("[data-openreel-root] header")?.getBoundingClientRect().height ?? 0) > 10,
      shellBottom: shell?.bottom ?? 0,
      timelineBottom: timeline?.bottom ?? 0,
      timelineHeight: timeline?.height ?? 0,
      stageHeight: stage?.height ?? 0,
    };
  });
}

for (const size of [
  { width: 1568, height: 778 },
  { width: 1280, height: 720 },
]) {
  test.describe(`host header hidden at ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    test("the editor's own top bar goes, the stage takes the space and the timeline stays inside the editor", async ({ page }) => {
      const withHeader = await measure(page, "");
      const without = await measure(page, "?chrome=1&noheader=1");

      expect(withHeader.hasHeader).toBe(true);
      expect(without.hasHeader).toBe(false);
      expect(without.stageHeight).toBeGreaterThan(withHeader.stageHeight);
      for (const result of [withHeader, without]) {
        expect(result.timelineBottom).toBeLessThanOrEqual(result.shellBottom + 1);
        expect(result.timelineHeight).toBeGreaterThan(120);
      }
    });
  });
}
