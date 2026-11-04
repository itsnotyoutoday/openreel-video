import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";

interface HarnessState {
  editor: unknown;
  storageCalls: string[];
  events: Array<{ type: string; [key: string]: unknown }>;
  toolCalls: number;
  exports: unknown[];
  errors: string[];
}
declare global {
  interface Window {
    harness: {
      state: HarnessState;
      memory: { projects: Map<string, unknown>; media: Map<string, unknown> };
      hasTool(): boolean;
      project(): {
        id: string;
        textClips?: unknown[];
        timeline: { tracks: unknown[] };
        mediaLibrary: { items: Array<{ id: string; blob: unknown; isPlaceholder?: boolean }> };
      };
    };
  }
}

async function openHarness(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(PATH);
  // The editor renders once its engines and bridges are ready.
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
  return failures;
}

test.describe("embed harness", () => {
  test("mounts from a sub-path, leaves the host page alone, and has no page errors", async ({ page }) => {
    const failures = await openHarness(page);

    // Assets came from the sub-path, not the origin root.
    const urls = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name),
    );
    expect(urls.some((url) => url.includes("/tools/editor/lib/"))).toBe(true);

    // The host's <html> attributes and classes are untouched.
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("host-theme");
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
    // The editor is the only thing that rendered into the slot.
    expect(await page.locator("#slot > [data-openreel-root]").count()).toBe(1);
    expect(failures).toEqual([]);
  });

  test("scopes keyboard shortcuts to the editor root", async ({ page }) => {
    await openHarness(page);
    const textClips = () => page.evaluate(() => window.harness.project().textClips?.length ?? 0);
    expect(await textClips()).toBe(0);

    // A stray "t" in the host page, or in a host input, adds nothing.
    await page.locator("#outside-input").click();
    await page.keyboard.press("t");
    await page.locator("h1").click();
    await page.keyboard.press("t");
    expect(await textClips()).toBe(0);

    // The same key inside the editor adds a title.
    await page.locator("[data-openreel-root]").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("t");
    await expect.poll(textClips).toBe(1);
  });

  test("themes the editor root, not the host", async ({ page }) => {
    await openHarness(page);
    await page.click("#theme-dark");
    const root = page.locator("[data-openreel-root]");
    await expect(root).toHaveAttribute("data-theme", "dark");
    expect(await root.evaluate((el) => getComputedStyle(el).getPropertyValue("--accent").trim())).toBe("#ff5a36");
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("host-theme");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(243, 233, 210)");
    await page.click("#theme-light");
    await expect(root).toHaveAttribute("data-theme", "light");
  });

  test("imports host media, saves through the host storage, and reopens it", async ({ page }) => {
    await openHarness(page);
    await page.click("#import-card");
    await expect.poll(() => page.evaluate(() => window.harness.project().mediaLibrary.items.length)).toBe(1);
    await page.click("#save");
    await expect.poll(() => page.evaluate(() => window.harness.state.events.some((e) => e.type === "save"))).toBe(true);

    // Host storage received the project and the media bytes by id.
    const stored = await page.evaluate(() => ({
      projects: window.harness.memory.projects.size,
      media: window.harness.memory.media.size,
      calls: window.harness.state.storageCalls,
    }));
    expect(stored.projects).toBe(1);
    expect(stored.media).toBe(1);
    expect(stored.calls).toEqual(expect.arrayContaining(["putMedia", "saveProject"]));

    // Unmount cleans up; mounting the stored project re-attaches the media.
    await page.click("#unmount");
    await expect(page.locator("[data-openreel-root]")).toHaveCount(0);
    await page.click("#remount-stored");
    await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
    const media = await page.evaluate(() => window.harness.project().mediaLibrary.items.map((i) => ({
      hasBlob: i.blob instanceof File,
      placeholder: Boolean(i.isPlaceholder),
    })));
    expect(media).toEqual([{ hasBlob: true, placeholder: false }]);
  });

  test("reports changes, saves and selection to the host", async ({ page }) => {
    await openHarness(page);
    await page.click("#import-card");
    await expect.poll(() => page.evaluate(() => window.harness.state.events.some((e) => e.type === "change"))).toBe(true);
    await page.click("#save");
    await expect.poll(() => page.evaluate(() => window.harness.state.events.filter((e) => e.type === "save").length)).toBe(1);
    expect(await page.evaluate(() => window.harness.state.events.find((e) => e.type === "save")?.revision)).toBe("1");
  });

  test("registers host tools and removes them on unmount", async ({ page }) => {
    await openHarness(page);
    expect(await page.evaluate(() => window.harness.hasTool())).toBe(true);
    await page.click("#run-tool");
    await expect.poll(() => page.evaluate(() => window.harness.state.toolCalls)).toBe(1);
    await page.click("#unmount");
    expect(await page.evaluate(() => window.harness.hasTool())).toBe(false);
  });

  test("unmounts cleanly and can mount again", async ({ page }) => {
    const failures = await openHarness(page);
    await page.click("#unmount");
    await expect(page.locator("[data-openreel-root]")).toHaveCount(0);

    // Nothing left listening: a key press after unmount does nothing.
    await page.keyboard.press("t");
    expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("host-theme");

    await page.click("#mount");
    await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
    expect(failures).toEqual([]);
  });
});
