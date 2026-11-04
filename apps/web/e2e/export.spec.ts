import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";

interface ExportState {
  runs: Array<{ id: string; phases: string[] }>;
  sizes: number[];
  aborted: number;
}
declare global {
  interface Window {
    harness: {
      state: { editor: unknown; exportTarget: ExportState; exports: Array<{ size: number; filename: string }> };
    };
  }
}

async function openHarness(page: Page, query: string) {
  await page.goto(`${PATH}?${query}`);
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
}

async function putCardOnTimeline(page: Page) {
  await page.click("#import-card");
  const thumbnail = page.getByRole("img", { name: "card.png" });
  await expect(thumbnail).toBeVisible();
  await page.waitForTimeout(500);
  // A hover overlay with the add button can sit over the thumbnail; either target adds the clip.
  await thumbnail.dblclick({ force: true });
  await expect(page.locator("[data-timeline-clip]").first()).toBeVisible();
}

test("hostChrome.exportAction host sends the file to events.onExport without a dialog", async ({ page, browserName }) => {
  // The default export is H.264 MP4; Playwright's Chromium build has no H.264 encoder (assumed, not diagnosed).
  test.skip(browserName === "chromium", "needs an H.264 encoder");
  await openHarness(page, "exportAction=host");
  await putCardOnTimeline(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.harness.state.exports.length), { timeout: 90_000 })
    .toBe(1);
  expect(await page.evaluate(() => window.harness.state.exports[0].size)).toBeGreaterThan(0);
});

test("renderStill returns a PNG of the frame", async ({ page }) => {
  await openHarness(page, "targets=1");
  await putCardOnTimeline(page);
  const still = await page.evaluate(async () => {
    const editor = window.harness.state.editor as { renderStill(at?: number): Promise<Blob> };
    const blob = await editor.renderStill(0.5);
    return { type: blob.type, size: blob.size };
  });
  expect(still.type).toBe("image/png");
  expect(still.size).toBeGreaterThan(100);
});

test.describe("host export targets", () => {
  test("the primary target is the Export button and runs through its phases", async ({ page }) => {
    await openHarness(page, "targets=1");
    await putCardOnTimeline(page);

    const primary = page.getByRole("button", { name: "Save to library" });
    await expect(primary).toBeEnabled();
    await primary.click();

    await expect
      .poll(() => page.evaluate(() => window.harness.state.exportTarget.runs[0]?.phases ?? []), { timeout: 60_000 })
      .toEqual(["rendering", "uploading", "saving"]);
    expect(await page.evaluate(() => window.harness.state.exportTarget.sizes[0])).toBeGreaterThan(0);
    await expect(page.getByText(/Saved .* to the fake library/)).toBeVisible();
    // the host handled the file: no download, no onExport
    expect(await page.evaluate(() => window.harness.state.exports.length)).toBe(0);
  });

  test("the menu lists the other targets by group and keeps Custom export", async ({ page }) => {
    await openHarness(page, "targets=1");
    await putCardOnTimeline(page);
    await page.getByRole("button", { name: "Export options" }).click();
    const menu = page
      .locator('[data-openreel-root] [role="menu"], [data-openreel-root] [role="dialog"][data-state="open"]')
      .last();
    await expect(menu.getByRole("group", { name: "Social" })).toBeVisible();
    await expect(menu.getByText("Vertical for social", { exact: true })).toBeVisible();
    await expect(menu.getByText("Custom export...", { exact: true })).toBeVisible();
    await menu.getByText("Custom export...", { exact: true }).click();
    await expect(page.getByRole("dialog").last()).toBeVisible();
  });

  test("cancel aborts the target's signal", async ({ page }) => {
    await openHarness(page, "targets=1");
    await putCardOnTimeline(page);
    await page.getByRole("button", { name: "Export options" }).click();
    await page.getByText("Slow upload", { exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.harness.state.exportTarget.runs[0]?.phases.includes("uploading")), { timeout: 60_000 })
      .toBe(true);
    // the Export slot is now the cancel button showing the progress
    await page.getByRole("button", { name: /%/ }).click();
    await expect.poll(() => page.evaluate(() => window.harness.state.exportTarget.aborted)).toBe(1);
    await expect(page.getByText("Saved", { exact: false })).toHaveCount(0);
  });
});
