import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";

interface PanelState {
  menuSelections: string[];
  inspectorMounts: number;
  inspectorClips: string[];
  mediaTabMounts: number;
  themes: Array<string | null>;
}
declare global {
  interface Window {
    harness: {
      state: { hostPanels: PanelState; placeholderId?: string };
      project(): {
        mediaLibrary: { items: Array<{ id: string; hostGenerated?: boolean }> };
        timeline: {
          tracks: Array<{ clips: Array<{ id: string; mediaId: string; startTime: number; duration: number; metadata?: Record<string, unknown> }> }>;
        };
      };
    };
  }
}

async function openHarness(page: Page) {
  await page.goto(PATH);
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
}

const clips = (page: Page) =>
  page.evaluate(() => window.harness.project().timeline.tracks.flatMap((t) => t.clips));

test.describe("host panels", () => {
  test("a media tab mounts once, places assets and accepts drops on the timeline", async ({ page }) => {
    await openHarness(page);
    await page.getByRole("button", { name: "Fake library" }).click();
    const panel = page.getByRole("region", { name: "Fake library" });
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel("Fake library assets")).toBeVisible();

    // switching away and back keeps the same mounted content
    await page.getByRole("button", { name: "Media", exact: true }).click();
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: "Fake library" }).click();
    expect(await page.evaluate(() => window.harness.state.hostPanels.mediaTabMounts)).toBe(1);

    await panel.getByRole("button", { name: "Add card.png" }).click();
    await expect.poll(async () => (await clips(page)).length).toBe(1);

    // a drag payload dropped on the timeline resolves through media.resolve and lands at the drop point
    // Playwright cannot start a real HTML5 drag in WebKit; the drop path is verified in Chromium only.
    if (test.info().project.name === "chromium") {
      await panel
        .locator('li[data-asset-id="tone"]')
        .dragTo(page.getByTestId("timeline-tracks-scroll"), { targetPosition: { x: 300, y: 20 } });
      await expect.poll(async () => (await clips(page)).length).toBe(2);
    }

    await page.click("#theme-dark");
    await expect.poll(() => page.evaluate(() => window.harness.state.hostPanels.themes)).toContain("dark");
  });

  test("placeholders: drawn on the timeline, host inspector tab, menu item, and swap for real media", async ({ page }) => {
    await openHarness(page);
    await page.click("#add-placeholder");
    const clip = page.locator("[data-timeline-clip]").first();
    await expect(clip).toBeVisible();
    await expect(clip.locator("[data-placeholder-clip]")).toBeVisible();
    await expect(clip.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");

    // never an empty preview: the still behind it is an image in the library, hidden from the media list
    const meta = await page.evaluate(() => {
      const project = window.harness.project();
      const placeholder = project.timeline.tracks.flatMap((t) => t.clips)[0];
      const item = project.mediaLibrary.items.find((m) => m.id === placeholder.mediaId);
      return { host: placeholder.metadata?.host, generated: item?.hostGenerated };
    });
    expect(meta).toEqual({ host: { shotId: "shot-1" }, generated: true });

    // inspector tab for the selected clip
    await clip.click();
    const scene = page.getByRole("tab", { name: "Scene" });
    await expect(scene).toBeVisible();
    await scene.click();
    const label = page.locator("[data-scene-label]");
    await expect(label).toHaveText("Scene shot-1 (placeholder)");
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(label).toContainText("reviewed");
    expect(await page.evaluate(() => window.harness.state.hostPanels.inspectorMounts)).toBe(1);

    // context-menu item in its own group
    await clip.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Open scene details" }).click();
    await expect.poll(() => page.evaluate(() => window.harness.state.hostPanels.menuSelections.length)).toBe(1);

    // swap: the real media takes the placeholder's place, host metadata stays
    const before = (await clips(page))[0];
    await page.click("#swap-placeholder");
    await expect(page.locator("[data-placeholder-clip]")).toHaveCount(0);
    const after = (await clips(page))[0];
    expect(after).toMatchObject({ id: before.id, startTime: before.startTime, duration: before.duration });
    expect(after.mediaId).not.toBe(before.mediaId);
    expect(after.metadata?.host).toEqual({ shotId: "shot-1", reviewed: true });
  });
});
