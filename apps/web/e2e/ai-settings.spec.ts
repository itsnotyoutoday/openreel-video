import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";
const SIZES = [
  { width: 1568, height: 778 },
  { width: 1280, height: 720 },
];

async function openSettings(page: Page) {
  await page.goto(PATH);
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "AI Editor chat" }).click();
  await page.getByRole("button", { name: "AI settings" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // let the open animation settle
  await page.waitForTimeout(500);
  return dialog;
}

for (const size of SIZES) {
  test.describe(`AI settings at ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    test("the settings panel lies inside the viewport and Esc returns focus", async ({ page }) => {
      const dialog = await openSettings(page);
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      const { x, y, width, height } = box!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(size.width);
      expect(y + height).toBeLessThanOrEqual(size.height);

      // its own content scrolls instead of growing past the viewport
      const done = page.getByRole("button", { name: "Done" });
      await done.scrollIntoViewIfNeeded();
      const doneBox = await done.boundingBox();
      expect(doneBox!.y + doneBox!.height).toBeLessThanOrEqual(size.height);

      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "AI settings" })).toBeFocused();
    });
  });
}
