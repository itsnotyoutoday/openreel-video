import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";

interface HarnessWindow {
  state: {
    dirty: boolean[];
    history: Array<{ canUndo: boolean; canRedo: boolean }>;
    imports: number;
  };
  project(): { name: string; mediaLibrary: { items: unknown[] }; timeline: { tracks: Array<{ clips: Array<{ id: string }> }> } };
  setReadOnly(on: boolean): void;
  applyRemote(name: string): Promise<void>;
}

async function open(page: Page, query = "") {
  await page.goto(`${PATH}${query}`);
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
}

const harness = <T,>(page: Page, fn: (h: HarnessWindow) => T | Promise<T>) =>
  page.evaluate(`(${fn.toString()})(window.harness)`) as Promise<T>;

test.describe("host chrome", () => {
  test("hides the listed chrome, renames Import and sends it to the host instead of the file picker", async ({ page }) => {
    await open(page, "?chrome=1");
    await expect(page.getByRole("button", { name: "Harness project" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Project JSON / Comments" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Record", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "More editor actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Settings & API keys" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Screen recorder" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Editor tour" })).toBeVisible();
    await page.keyboard.press("Escape");

    const importButton = page.getByRole("button", { name: "Import media" }).first();
    await expect(importButton).toContainText("Library");
    let picker = false;
    page.on("filechooser", () => (picker = true));
    await importButton.click();
    await expect.poll(() => harness(page, (h) => h.state.imports)).toBe(1);
    expect(picker).toBe(false);
  });

  test("without options nothing is hidden and Import opens the picker", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: "Harness project" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Project JSON / Comments" })).toBeVisible();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import media" }).first().click();
    await chooser;
  });
});

test.describe("state and control", () => {
  test("is clean after load, dirty after an edit, clean after a save, and a remote project is one undo step", async ({ page }) => {
    await open(page);
    expect(await harness(page, (h) => h.state.dirty)).toEqual([false]);

    await page.click("#import-card");
    await page.getByRole("img", { name: "card.png" }).hover();
    await page.getByRole("button", { name: "Add to timeline" }).first().click();
    await expect(page.locator("[data-timeline-clip]")).toHaveCount(1);
    await expect.poll(() => harness(page, (h) => h.state.dirty.at(-1))).toBe(true);

    await page.click("#save");
    await expect.poll(() => harness(page, (h) => h.state.dirty.at(-1))).toBe(false);

    await harness(page, (h) => h.applyRemote("From the server"));
    await expect(page.locator("[data-timeline-clip]")).toHaveCount(0);
    expect(await harness(page, (h) => h.project().name)).toBe("From the server");
    expect(await harness(page, (h) => h.state.dirty.at(-1))).toBe(false);
    expect(await harness(page, (h) => h.state.history.at(-1))).toMatchObject({ canUndo: true });

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator("[data-timeline-clip]")).toHaveCount(1);
  });

  test("read-only: edits are refused, menus still open, and the banner shows", async ({ page }) => {
    await open(page, "?readonly=1");
    await expect(page.locator("[data-openreel-read-only]")).toHaveText("Read only");
    await page.click("#import-card");
    await page.waitForTimeout(500);
    expect(await harness(page, (h) => h.project().mediaLibrary.items.length)).toBe(0);
    await page.getByRole("button", { name: "More editor actions" }).click();
    await expect(page.getByRole("menuitem").first()).toBeVisible();
    await page.keyboard.press("Escape");

    await harness(page, (h) => h.setReadOnly(false));
    await expect(page.locator("[data-openreel-read-only]")).toHaveCount(0);
  });
});
