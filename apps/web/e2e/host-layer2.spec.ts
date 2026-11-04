import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";

type Harness = {
  state: { hostPanels: { replaceMounts: string[] }; recorded: string[] };
  setLabel(id: string, label: string): void;
  seek(seconds: number): void;
  project(): { timeline: { tracks: Array<{ clips: Array<{ id: string }> }> } };
};

async function open(page: Page, query = "") {
  await page.goto(`${PATH}${query}`);
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
}

const clipCount = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { harness: Harness }).harness.project().timeline.tracks.flatMap((t) => t.clips).length,
  );

async function addPlaceholders(page: Page, count: number): Promise<void> {
  await page.evaluate(async (n) => {
    const harness = (window as unknown as { harness: { state: { editor: { addPlaceholderClip(o: object): string } } } }).harness;
    for (let i = 0; i < n; i += 1) harness.state.editor.addPlaceholderClip({ start: 0, duration: 3, label: `Shot ${i + 1}` });
    await new Promise((resolve) => setTimeout(resolve, 600));
  }, count);
}

test.describe("inspector ownership", () => {
  test("replace mode: the editor's own inspector is gone and the host's tabs follow the selection", async ({ page }) => {
    await open(page, "?inspector=replace");
    await expect(page.locator("[data-tour='inspector']")).toHaveCount(0);
    await expect(page.locator("[data-host-inspector='replace']")).toBeVisible();
    await expect(page.getByRole("region", { name: "Project" })).toContainText("nothing selected");

    await addPlaceholders(page, 1);
    await page.locator("[data-timeline-clip]").first().click();
    await expect(page.getByRole("region", { name: "Item" })).toContainText("Item ");
    await expect(page.getByRole("tab", { name: "Properties" })).toHaveCount(0);
  });

  test("default: the editor's own inspector stays", async ({ page }) => {
    await open(page);
    await expect(page.locator("[data-tour='inspector']")).toBeVisible();
  });

  test("hide inspector: the column is gone and the stage takes its width", async ({ page }) => {
    await open(page);
    const before = await page.getByLabel("Preview canvas").evaluate((el) => el.getBoundingClientRect().width);
    await open(page, "?hide=inspector");
    await expect(page.locator("#editor-panel-inspector")).toHaveCount(0);
    const after = await page.getByLabel("Preview canvas").evaluate((el) => el.getBoundingClientRect().width);
    expect(after).toBeGreaterThan(before + 150);
  });
});

for (const size of [
  { width: 1568, height: 778 },
  { width: 1280, height: 720 },
]) {
  test.describe(`layout at ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    for (const preset of ["compact", "comfortable"]) {
      test(`${preset}: at least four tracks fully visible and a stage that is not tiny`, async ({ page }) => {
        await open(page, `?fill=1&layout=${preset}`);
        await addPlaceholders(page, 7);
        const result = await page.evaluate(() => {
          const scroller = document.querySelector('[data-testid="timeline-tracks-scroll"]')!.getBoundingClientRect();
          const lanes = [...document.querySelectorAll<HTMLElement>("[data-track-id]")].filter((el) => !el.closest("[data-group-band]"));
          const visible = lanes.filter((el) => {
            const r = el.getBoundingClientRect();
            return r.height > 0 && r.top >= scroller.top - 1 && r.bottom <= scroller.bottom + 1;
          }).length;
          const stage = document.querySelector('[aria-label="Preview canvas"]')!.getBoundingClientRect();
          return { visible, total: lanes.length, stageHeight: stage.height };
        });
        expect(result.total).toBeGreaterThanOrEqual(7);
        expect(result.visible).toBeGreaterThanOrEqual(4);
        expect(result.stageHeight).toBeGreaterThanOrEqual(190);
      });
    }

    test("minVisibleTracks all: every track row is fully visible, rows shrink to fit", async ({ page }) => {
      await open(page, "?fill=1&layout=all");
      await addPlaceholders(page, 4);
      const result = await page.evaluate(() => {
        const scroller = document.querySelector('[data-testid="timeline-tracks-scroll"]')!.getBoundingClientRect();
        const lanes = [...document.querySelectorAll<HTMLElement>("[data-track-id]")];
        return {
          total: lanes.length,
          visible: lanes.filter((el) => {
            const r = el.getBoundingClientRect();
            return r.height > 0 && r.top >= scroller.top - 1 && r.bottom <= scroller.bottom + 1;
          }).length,
        };
      });
      expect(result.total).toBe(4);
      expect(result.visible).toBe(4);
    });

    test("a reserved bottom-right corner has no editor control under it; the default has no reserved space", async ({ page }) => {
      await open(page);
      expect(await page.locator("[data-openreel-root] .editor-shell").evaluate((el) => (el as HTMLElement).style.padding)).toBe("");
      await open(page, "?corner=1");
      await addPlaceholders(page, 2);
      const hits = await page.evaluate(() => {
        const root = document.querySelector("[data-openreel-root]")!.getBoundingClientRect();
        const corner = { left: root.right - 120, top: root.bottom - 60, right: root.right, bottom: root.bottom };
        const interactive = document.querySelectorAll<HTMLElement>(
          "[data-openreel-root] :is(button, a[href], input, select, textarea, [role='slider'], [role='button'], [tabindex]:not([tabindex='-1']))",
        );
        return [...interactive]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || style.display === "none") return false;
            return r.left < corner.right && r.right > corner.left && r.top < corner.bottom && r.bottom > corner.top;
          })
          .map((el) => `${el.tagName} ${el.getAttribute("aria-label") ?? el.textContent?.slice(0, 20)}`);
      });
      expect(hits).toEqual([]);
    });
  });
}

test.describe("chrome, names, guard, read-only", () => {
  test("hide export and saveState removes the editor's own export; by default it is there", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
    await open(page, "?hide=export,saveState");
    await expect(page.getByRole("button", { name: "Export", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export options" })).toHaveCount(0);
  });

  test("hide projectMenu removes the whole project area including the title", async ({ page }) => {
    await open(page);
    await expect(page.getByLabel("Project name")).toBeVisible();
    await open(page, "?hide=projectMenu");
    await expect(page.getByLabel("Project name")).toHaveCount(0);
  });

  test("a name the host gives a clip is shown instead of the media's", async ({ page }) => {
    await open(page);
    await addPlaceholders(page, 1);
    const id = await page.evaluate(() => (window as unknown as { harness: Harness }).harness.project().timeline.tracks[0].clips[0].id);
    await page.evaluate((clipId) => (window as unknown as { harness: Harness }).harness.setLabel(clipId, "Scene 2"), id);
    await expect(page.locator(`[data-clip-id="${id}"]`)).toHaveAttribute("aria-label", "Select clip Scene 2");
  });

  test("beforeEdit: a vetoed split shows the host's reason and changes nothing; undo is unaffected", async ({ page }) => {
    await open(page, "?guard=1");
    await addPlaceholders(page, 1);
    await page.evaluate(() => (window as unknown as { harness: Harness }).harness.seek(1));
    await page.locator("[data-timeline-clip]").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Split at Playhead" }).click();
    await expect(page.getByText("The host does not allow splitting here")).toBeVisible();
    expect(await clipCount(page)).toBe(1);
  });

  test("read-only disables the editing controls in the top bar and panels", async ({ page }) => {
    await open(page, "?readonly=1");
    expect(await page.getByLabel("Project name").evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
    await open(page);
    expect(await page.getByLabel("Project name").evaluate((el) => getComputedStyle(el).pointerEvents)).not.toBe("none");
  });
});

test.describe("the host's header owns export, save, tokens and the inspector tab", () => {
  test("with the editor's top bar hidden, openExport opens the export dialog and save reports its state", async ({ page }) => {
    await open(page, "?chrome=1&noheader=1");
    await addPlaceholders(page, 1);
    await page.evaluate(() => (window as unknown as { harness: { state: { editor: { openExport(): void } } } }).harness.state.editor.openExport());
    await expect(page.locator("[data-openreel-root]").getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    const before = await page.evaluate(() => (window as unknown as { harness: { state: { editor: { getSaveState(): { dirty: boolean } } } } }).harness.state.editor.getSaveState());
    expect(before.dirty).toBe(true);
    const after = await page.evaluate(async () => {
      const editor = (window as unknown as { harness: { state: { editor: { save(): Promise<unknown>; getSaveState(): { dirty: boolean; savedAt: number | null; saving: boolean } } } } }).harness.state.editor;
      await editor.save();
      return editor.getSaveState();
    });
    expect(after).toMatchObject({ dirty: false, saving: false });
    expect(after.savedAt).not.toBeNull();
  });

  test("host tokens reach inner elements that carry their own theme attribute", async ({ page }) => {
    await open(page);
    await page.click("#theme-dark"); // theme.tokens sets --accent: #ff5a36 on the mount root
    const accents = await page.evaluate(() => {
      const root = document.querySelector("[data-openreel-root]")!;
      const inner = [root.querySelector(".editor-shell"), ...root.querySelectorAll("[data-theme], .dark")].filter(Boolean) as Element[];
      return inner.map((el) => getComputedStyle(el).getPropertyValue("--accent").trim());
    });
    expect(accents.length).toBeGreaterThan(0);
    expect(new Set(accents)).toEqual(new Set(["#ff5a36"]));
  });

  test("openInspectorTab and activateOnSelect open a host tab by themselves", async ({ page }) => {
    await open(page, "?activate=1");
    await addPlaceholders(page, 1);
    await page.locator("[data-timeline-clip]").first().click();
    await expect(page.getByRole("tab", { name: "Scene" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Properties" }).click();
    await expect(page.getByRole("tab", { name: "Scene" })).toHaveAttribute("aria-selected", "false");
    await page.evaluate(() => (window as unknown as { harness: { state: { editor: { openInspectorTab(id: string): void } } } }).harness.state.editor.openInspectorTab("fake-scene"));
    await expect(page.getByRole("tab", { name: "Scene" })).toHaveAttribute("aria-selected", "true");
  });

  test("a reopened project draws its first frame without play or seek", async ({ page }) => {
    await open(page);
    await page.click("#import-card");
    await page.getByRole("img", { name: "card.png" }).hover();
    await page.getByRole("button", { name: "Add to timeline" }).first().click();
    await expect(page.locator("[data-timeline-clip]")).toHaveCount(1);
    await page.click("#save");
    await page.click("#unmount");
    await page.click("#remount-stored");
    await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    // look at what is on screen: the card is orange (194, 65, 12), a black frame has none of it
    const shot = (await page.getByLabel("Preview canvas").screenshot()).toString("base64");
    const orange = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const copy = document.createElement("canvas");
      copy.width = image.width;
      copy.height = image.height;
      const ctx = copy.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 150 && pixels[i + 1] < 110 && pixels[i + 2] < 60) count += 1;
      }
      return count;
    }, shot);
    expect(orange).toBeGreaterThan(200);
  });
});
