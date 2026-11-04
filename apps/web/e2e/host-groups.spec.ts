import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";

interface GroupHarness {
  state: { locked: Array<{ groupId: string; action: string }> };
  selection(): string[];
  seek(seconds: number): void;
  makeGroup(): Promise<string[]>;
  project(): { timeline: { tracks: Array<{ clips: Array<{ id: string; startTime: number; duration: number }> }> } };
}
async function open(page: Page) {
  await page.goto(PATH);
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
  return page.evaluate(() => (window as unknown as { harness: GroupHarness }).harness.makeGroup());
}

const starts = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      (window as unknown as { harness: GroupHarness }).harness
        .project()
        .timeline.tracks.flatMap((t) => t.clips)
        .map((c) => [c.id, c.startTime]),
    ),
  );
const locked = (page: Page) => page.evaluate(() => (window as unknown as { harness: GroupHarness }).harness.state.locked);

test.describe("locked clip groups", () => {
  test("draw a band with a link icon, a tint and a locked cue, and collapse and expand", async ({ page }) => {
    const [a, b, c] = await open(page);
    const band = page.locator('[data-group-band="g1"]');
    await expect(band).toBeVisible();
    await expect(band.locator("[data-group-label]")).toHaveText("Scene 1 · locked");
    await expect(band.locator("svg").first()).toBeVisible(); // chevron and link icon
    for (const id of [a, b, c]) {
      const clip = page.locator(`[data-clip-id="${id}"]`);
      await expect(clip).toHaveAttribute("data-group-locked", "true");
      expect(await clip.evaluate((el) => (el as HTMLElement).style.boxShadow)).toContain("inset");
      expect(await clip.evaluate((el) => getComputedStyle(el).cursor)).toBe("not-allowed");
    }

    await page.getByRole("button", { name: "Collapse Scene 1" }).click();
    await expect(band).toHaveAttribute("data-group-collapsed", "true");
    await expect(page.locator("[data-group-id]")).toHaveCount(0);
    await expect(band.locator("[data-group-label]")).toContainText("3 clips");

    await page.getByRole("button", { name: "Expand Scene 1" }).click();
    await expect(page.locator('[data-group-id="g1"]')).toHaveCount(3);
  });

  test("selecting any clip selects the whole group", async ({ page }) => {
    const [a, b, c] = await open(page);
    await page.locator(`[data-clip-id="${b}"]`).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { harness: GroupHarness }).harness.selection())).toEqual(expect.arrayContaining([a, b, c]));
  });

  test("dragging a clip moves the whole group as a unit", async ({ page }) => {
    const [a, b] = await open(page);
    const before = await starts(page);
    const box = (await page.locator(`[data-clip-id="${b}"]`).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await starts(page))[a] - before[a]).toBeGreaterThan(0.2);
    const after = await starts(page);
    const shift = after[a] - before[a];
    for (const id of Object.keys(before)) expect(after[id] - before[id]).toBeCloseTo(shift, 3);
    expect(await locked(page)).toEqual([]); // moving the unit is not a blocked gesture
  });

  test("blocked gestures: an inside trim, a split and a delete show a hint, change nothing and tell the host", async ({ page }) => {
    const [a, b, c] = await open(page);
    const before = await starts(page);

    // inside boundary: the start of the middle clip
    await page.locator(`[data-clip-id="${b}"] [data-timeline-trim="left"]`).dispatchEvent("mousedown", { button: 0 });
    await expect(page.locator("[data-locked-hint]")).toContainText("Scene 1 is locked");
    expect((await locked(page)).at(-1)).toEqual({ groupId: "g1", action: "trim" });

    // split at the playhead inside a member (from its context menu)
    await page.evaluate(() => (window as unknown as { harness: GroupHarness }).harness.seek(3));
    await page.locator(`[data-clip-id="${b}"]`).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Split at Playhead" }).click();
    await expect.poll(async () => (await locked(page)).at(-1)).toEqual({ groupId: "g1", action: "split" });

    // delete the selected group's clips one by one: refused
    await page.locator(`[data-clip-id="${b}"]`).click();
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await locked(page)).map((event) => event.action)).toContain("delete");

    const after = await starts(page);
    expect(Object.keys(after).sort()).toEqual([a, b, c].sort());
    expect(after).toEqual(before);
  });

  test("outer ends can still be trimmed without a hint", async ({ page }) => {
    const [a] = await open(page);
    await page.locator(`[data-clip-id="${a}"] [data-timeline-trim="left"]`).dispatchEvent("mousedown", { button: 0 });
    await page.mouse.up();
    await expect(page.locator("[data-locked-hint]")).toHaveCount(0);
    expect(await locked(page)).toEqual([]);
  });
});

test.describe("a series defined the way a host's server state defines it", () => {
  test("one setClipGroups call with the member ids; dragging any clip moves the series on both tracks", async ({ page }) => {
    await page.goto(PATH);
    await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
    const ids = await page.evaluate(() =>
      (window as unknown as { harness: { makeSeries(): Promise<string[]> } }).harness.makeSeries(),
    );
    expect(ids).toHaveLength(6);

    // every member carries the group, and the band is drawn on both tracks
    await expect(page.locator('[data-group-id="series"]')).toHaveCount(6);
    await expect(page.locator('[data-group-band="series"]')).toHaveCount(2);

    const before = await starts(page);
    const middle = ids[1];
    const box = (await page.locator(`[data-clip-id="${middle}"]`).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 5 });
    await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => (await starts(page))[middle] - before[middle]).toBeGreaterThan(0.2);
    const after = await starts(page);
    const shift = after[middle] - before[middle];
    for (const id of ids) expect(after[id] - before[id], id).toBeCloseTo(shift, 3);
  });
});

test.describe("joins", () => {
  test("a click on an empty join selects it for the host; the picker opens on the second click", async ({ page }) => {
    await page.goto(PATH);
    await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => (window as unknown as { harness: { makeGroup(): Promise<string[]> } }).harness.makeGroup());
    const join = page.getByRole("button", { name: /Edit transition between clips/ }).first();
    await expect(join).toBeVisible();

    await join.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { harness: { selection(): string[] } }).harness.selection())).toEqual(
      [expect.stringMatching(/^join:/)],
    );
    await expect(page.locator("[data-openreel-root]").getByRole("menu")).toHaveCount(0);

    await join.click();
    await expect(page.getByRole("menu")).toBeVisible();
  });
});

