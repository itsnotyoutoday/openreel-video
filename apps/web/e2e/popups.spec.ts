import { expect, test, type Locator, type Page } from "@playwright/test";

const PATH = "/tools/editor/";
const MENU = '[data-openreel-root] [role="menu"], [data-openreel-root] [role="dialog"][data-state="open"]';
const VARIABLES = ["--popover", "--bg-1", "--border", "--fg"];

async function openHarness(page: Page) {
  await page.goto(PATH);
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
}

/** Import the card still, put it on the timeline and select it, so the preview's transform overlay shows. */
async function selectAClip(page: Page) {
  await page.click("#import-card");
  const thumbnail = page.getByRole("img", { name: "card.png" });
  await expect(thumbnail).toBeVisible();
  await thumbnail.hover(); // reveals the card's own "Add to timeline" button
  await page.getByRole("button", { name: "Add to timeline" }).first().click();
  const clip = page.locator("[data-timeline-clip]").first();
  await expect(clip).toBeVisible();
  await clip.click();
  await expect(page.getByTitle("Drag to move")).toBeVisible();
}

interface MenuReport {
  insideRoot: boolean;
  alpha: number;
  missingVariables: string[];
  coveredItems: string[];
  items: number;
}

/** What a person would see: opaque, themed, inside the root, and nothing painted over the items. */
async function inspectMenu(menu: Locator, variables: string[]): Promise<MenuReport> {
  return menu.evaluate((el, names) => {
    const alphaOf = (color: string): number => {
      if (color === "transparent") return 0;
      const slash = color.match(/\/\s*([\d.]+%?)\s*\)/);
      if (slash) return slash[1].endsWith("%") ? parseFloat(slash[1]) / 100 : parseFloat(slash[1]);
      const rgba = color.match(/^rgba\(([^)]*)\)/);
      if (rgba) return parseFloat(rgba[1].split(",")[3] ?? "1");
      return 1;
    };
    const style = getComputedStyle(el);
    const items = [...el.querySelectorAll<HTMLElement>('[role^="menuitem"], button, [role="option"]')].filter(
      (item) => item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0,
    );
    const coveredItems: string[] = [];
    for (const item of items) {
      const box = item.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      if (!hit || !el.contains(hit)) coveredItems.push((item.textContent ?? "").trim().slice(0, 40));
    }
    return {
      insideRoot: Boolean(el.closest("[data-openreel-root]")),
      alpha: alphaOf(style.backgroundColor),
      missingVariables: names.filter((name) => style.getPropertyValue(name).trim() === ""),
      coveredItems,
      items: items.length,
    };
  }, variables);
}

async function expectGoodMenu(page: Page, open: () => Promise<void>) {
  await open();
  const menu = page.locator(MENU).last();
  await expect(menu).toBeVisible();
  // let the open animation settle before measuring
  await page.waitForTimeout(400);
  const report = await inspectMenu(menu, VARIABLES);
  expect(report.insideRoot).toBe(true);
  expect(report.alpha).toBeGreaterThanOrEqual(0.95);
  expect(report.missingVariables).toEqual([]);
  expect(report.items).toBeGreaterThan(0);
  expect(report.coveredItems).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator(MENU)).toHaveCount(0);
}

for (const theme of ["light", "dark"] as const) {
  test(`menus are opaque, themed, inside the root and above the stage overlay (${theme})`, async ({ page }) => {
    await openHarness(page);
    await page.click(`#theme-${theme}`);
    await selectAClip(page);

    await expectGoodMenu(page, () => page.getByRole("button", { name: "More editor actions" }).click());
    await expectGoodMenu(page, () => page.getByRole("button", { name: "Harness project" }).click());
    await expectGoodMenu(page, () => page.getByRole("button", { name: "Export options" }).click());
    await expectGoodMenu(page, () => page.getByRole("button", { name: "Add track" }).first().click());
    await expectGoodMenu(page, () => page.locator("[data-timeline-clip]").first().click({ button: "right" }));
  });
}

const VIEWPORTS = [
  { width: 1568, height: 778 },
  { width: 1280, height: 720 },
];

for (const size of VIEWPORTS) {
  test.describe(`dialogs fit the viewport at ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    const opens: Array<{ name: string; open: (page: Page) => Promise<void> }> = [
      {
        name: "Project JSON",
        open: (page) => page.getByRole("button", { name: "Project JSON / Comments" }).click(),
      },
      {
        name: "Project backups",
        open: async (page) => {
          await page.getByRole("button", { name: "Harness project" }).click();
          await page.getByRole("button", { name: "Project backups" }).click();
        },
      },
    ];

    for (const { name, open } of opens) {
      test(`${name}: inside the viewport, close visible, Esc closes`, async ({ page }) => {
        await openHarness(page);
        await open(page);
        const dialog = page.getByRole("dialog").last();
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(500);
        const box = await dialog.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
        const close = dialog.getByRole("button", { name: /close|cancel|done/i }).first();
        await expect(close).toBeVisible();
        const closeBox = await close.boundingBox();
        expect(closeBox!.y).toBeGreaterThanOrEqual(0);
        expect(closeBox!.y + closeBox!.height).toBeLessThanOrEqual(size.height);
        expect(await dialog.evaluate((el) => Boolean(el.closest("[data-openreel-root]")))).toBe(true);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      });
    }
  });
}
