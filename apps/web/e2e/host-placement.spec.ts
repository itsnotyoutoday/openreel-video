import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";

// five rows plus their headers need more height than the default viewport gives the timeline
test.use({ viewport: { width: 1440, height: 1200 } });

interface Rows {
  ids: string[];
  longId: string | null;
  videoId: string;
}
interface PlacementHarness {
  makeRows(scenario: "stack" | "occupied" | "overlap", grouped?: boolean): Promise<Rows>;
  project(): { timeline: { tracks: Array<{ id: string; name: string; type: string; clips: Array<{ id: string }> }> } };
}
const h = "window.harness";

async function open(page: Page) {
  await page.goto(PATH);
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
}

const make = (page: Page, scenario: string, grouped = false) =>
  page.evaluate(
    ([s, g]) => (window as unknown as { harness: PlacementHarness }).harness.makeRows(s as "stack", g as boolean),
    [scenario, grouped] as const,
  );

/** Rows top to bottom as the track list shows them. */
const rowNames = (page: Page) =>
  page.locator("[data-timeline-track-header]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.trackName));

const rowOf = (page: Page, clipId: string) =>
  page.evaluate((id) => {
    const track = (window as unknown as { harness: PlacementHarness }).harness
      .project()
      .timeline.tracks.find((t) => t.clips.some((c) => c.id === id));
    return track ? { name: track.name, type: track.type } : null;
  }, clipId);

const clipsIn = (page: Page, name: string) =>
  page.evaluate((n) => {
    const track = (window as unknown as { harness: PlacementHarness }).harness.project().timeline.tracks.find((t) => t.name === n);
    return track ? track.clips.map((c) => c.id).sort() : null;
  }, name);

async function center(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragTo(page: Page, fromSelector: string, to: { x: number; y: number }, hold?: () => Promise<void>) {
  const from = await center(page, fromSelector);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y - 8, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.move(to.x + 1, to.y, { steps: 2 });
  if (hold) await hold();
  await page.mouse.up();
}

test.describe("placement keeps a row's kind", () => {
  test("vertical drag of a video clip onto the Text row makes a new video row above Video, Text stays on top", async ({ page }) => {
    await open(page);
    const { ids } = await make(page, "stack");
    expect(await rowNames(page)).toEqual(["Text", "Video", "Voice", "Music"]);

    const text = await center(page, '[data-track-id="row-text"]');
    await dragTo(page, `[data-clip-id="${ids[2]}"]`, text, async () => {
      await expect(page.locator('[data-track-id="row-text"] [data-drop-indicator]')).toHaveText("New video track");
    });

    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video 2", "Video", "Voice", "Music"]);
    expect(await rowOf(page, ids[2])).toEqual({ name: "Video 2", type: "video" });
    expect(await clipsIn(page, "Text")).toEqual([]);
    await expect(page.locator("[data-drop-indicator]")).toHaveCount(0);
  });

  test("a single clip dropped on an occupied span of another video row makes a new video row, not the Text row", async ({ page }) => {
    await open(page);
    const { ids, longId } = await make(page, "occupied");
    expect(await rowNames(page)).toEqual(["Text", "Video 2", "Video", "Voice", "Music"]);

    const target = await center(page, `[data-clip-id="${longId}"]`);
    await dragTo(page, `[data-clip-id="${ids[0]}"]`, target);

    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video 3", "Video 2", "Video", "Voice", "Music"]);
    expect(await rowOf(page, ids[0])).toEqual({ name: "Video 3", type: "video" });
    expect(await clipsIn(page, "Text")).toEqual([]);
    expect(await clipsIn(page, "Video 2")).toEqual([longId]);
  });

  test("a locked group dragged onto an occupied span puts ALL members on one new video row", async ({ page }) => {
    await open(page);
    const { ids, longId } = await make(page, "occupied", true);
    await expect(page.locator('[data-group-id="g1"]')).toHaveCount(3);

    const target = await center(page, `[data-clip-id="${longId}"]`);
    await dragTo(page, `[data-clip-id="${ids[1]}"]`, target);

    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video 3", "Video 2", "Video", "Voice", "Music"]);
    expect(await clipsIn(page, "Video 3")).toEqual([...ids].sort());
    expect(await clipsIn(page, "Text")).toEqual([]);
    expect(await clipsIn(page, "Video")).toEqual([]);
    for (const id of ids) expect(await rowOf(page, id)).toEqual({ name: "Video 3", type: "video" });
  });

  test("a locked group dragged onto the Text row makes one new video row, with the drop indicator", async ({ page }) => {
    await open(page);
    const { ids } = await make(page, "stack", true);
    // the Text row's centre can lie beyond the viewport (the lane is as wide as the timeline): aim a
    // little right of the grabbed member, inside the Text row
    const from = await center(page, `[data-clip-id="${ids[1]}"]`);
    const text = { x: from.x + 40, y: (await center(page, '[data-track-id="row-text"]')).y };
    await dragTo(page, `[data-clip-id="${ids[1]}"]`, text, async () => {
      await expect(page.locator('[data-track-id="row-text"] [data-drop-indicator]')).toHaveText("New video track");
    });
    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video 2", "Video", "Voice", "Music"]);
    expect(await clipsIn(page, "Video 2")).toEqual([...ids].sort());
    expect(await clipsIn(page, "Text")).toEqual([]);
  });

  test("a straight-up drag of a locked group member into the Text row moves the whole group to a new Video 2", async ({ page }) => {
    await open(page);
    const { ids } = await make(page, "stack", true);
    await expect(page.locator('[data-group-id="g1"]')).toHaveCount(3);
    expect(await rowNames(page)).toEqual(["Text", "Video", "Voice", "Music"]);

    // mouse down on a member, move straight up (no horizontal motion) into the Text row, release
    const from = await center(page, `[data-clip-id="${ids[1]}"]`);
    const text = await center(page, '[data-track-id="row-text"]');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, text.y, { steps: 12 });
    await expect(page.locator('[data-track-id="row-text"] [data-drop-indicator]')).toHaveText("New video track");
    await page.mouse.up();

    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video 2", "Video", "Voice", "Music"]);
    expect(await clipsIn(page, "Video 2")).toEqual([...ids].sort());
    expect(await clipsIn(page, "Video")).toEqual([]);
    expect(await clipsIn(page, "Text")).toEqual([]);
    await expect(page.locator("[data-drop-indicator]")).toHaveCount(0);
  });

  test("dragging the group up twice names the new rows Video 2 then Video 3, never Track N or a reused label", async ({ page }) => {
    await open(page);
    const { ids } = await make(page, "stack", true);
    await expect(page.locator('[data-group-id="g1"]')).toHaveCount(3);
    const straightUp = async () => {
      const from = await center(page, `[data-clip-id="${ids[1]}"]`);
      const text = await center(page, '[data-track-id="row-text"]');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x, text.y, { steps: 12 });
      await page.mouse.up();
    };

    await straightUp();
    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video 2", "Video", "Voice", "Music"]);
    expect(await clipsIn(page, "Video 2")).toEqual([...ids].sort());

    await straightUp();
    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video 3", "Video 2", "Video", "Voice", "Music"]);
    expect(await clipsIn(page, "Video 3")).toEqual([...ids].sort());
    // an emptied row keeps its name
    expect(await clipsIn(page, "Video 2")).toEqual([]);
  });

  test("a straight-up drag of a single clip into the Text row makes a new Video 2", async ({ page }) => {
    await open(page);
    const { ids } = await make(page, "stack");
    const from = await center(page, `[data-clip-id="${ids[0]}"]`);
    const text = await center(page, '[data-track-id="row-text"]');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, text.y, { steps: 12 });
    await expect(page.locator('[data-track-id="row-text"] [data-drop-indicator]')).toHaveText("New video track");
    await page.mouse.up();

    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video 2", "Video", "Voice", "Music"]);
    expect(await rowOf(page, ids[0])).toEqual({ name: "Video 2", type: "video" });
    expect(await clipsIn(page, "Text")).toEqual([]);
  });

  test("a loaded project with two overlapping video clips puts the second on a NEW video row", async ({ page }) => {
    await open(page);
    const { ids } = await make(page, "overlap");
    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video 2", "Video", "Voice", "Music"]);
    expect(await rowOf(page, ids[0])).toEqual({ name: "Video", type: "video" });
    expect(await rowOf(page, ids[1])).toEqual({ name: "Video 2", type: "video" });
    expect(await clipsIn(page, "Text")).toEqual([]);
  });
});

test.describe("row labels and kinds are stable", () => {
  test("no label or kind changes after the first frame, after load and through a group drag", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const frames: Array<Array<[string, string]>> = [];
      (window as unknown as { __frames: typeof frames }).__frames = frames;
      const tick = () => {
        frames.push(
          [...document.querySelectorAll<HTMLElement>("[data-timeline-track-header]")].map((el) => [el.dataset.trackName ?? "", el.dataset.trackKind ?? ""]),
        );
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const { ids, longId } = await make(page, "occupied", true);
    for (let i = 0; i < 12; i += 1) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const target = await center(page, `[data-clip-id="${longId}"]`);
    await dragTo(page, `[data-clip-id="${ids[1]}"]`, target);
    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video 3", "Video 2", "Video", "Voice", "Music"]);
    for (let i = 0; i < 12; i += 1) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

    const frames = await page.evaluate(() => (window as unknown as { __frames: Array<Array<[string, string]>> }).__frames);
    expect(frames.length).toBeGreaterThan(20);
    const kinds = new Map<string, Set<string>>();
    for (const rows of frames) {
      for (const [name, kind] of rows) {
        // an index-derived fallback label ("V1", "T2") would change as rows are added
        expect(name, "no index-derived labels").not.toMatch(/^[TVAIG]\d+$/);
        (kinds.get(name) ?? kinds.set(name, new Set()).get(name)!).add(kind);
      }
    }
    for (const [name, set] of kinds) expect([...set], `kind of "${name}"`).toHaveLength(1);
    expect(kinds.get("Text")).toEqual(new Set(["text"]));
    expect(kinds.get("Video 3")).toEqual(new Set(["video"]));

    // once the rows exist, the list never changes between frames except at the drop
    const settled = frames.slice(-10).map((rows) => JSON.stringify(rows));
    expect(new Set(settled).size).toBe(1);
  });
});

void h;
