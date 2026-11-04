import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";

test.use({ viewport: { width: 1440, height: 1200 } });

interface Clip {
  id: string;
  mediaId: string;
  startTime: number;
  locks?: { move?: boolean; trim?: boolean };
  metadata?: { placeholder?: { previewUrl?: string } };
}
interface Track {
  id: string;
  name: string;
  type: string;
  locked?: boolean;
  clips: Clip[];
}
interface Editor {
  getProject(): { timeline: { tracks: Track[] }; mediaLibrary: { items: Array<{ id: string; type: string; hostGenerated?: boolean }> } };
  applyRemoteProject(project: unknown, opts?: unknown): Promise<void>;
  setClipLocks(id: string, locks: { move?: boolean; trim?: boolean } | null): Promise<void>;
  setTrackLocked(id: string, locked: boolean): Promise<void>;
  setMarkers(markers: unknown[]): void;
  addPlaceholderClip(options: unknown): string;
  replacePlaceholder(id: string, mediaId: string): void;
  setZoom(pps: number): void;
  undo(): Promise<void>;
  save(): Promise<unknown>;
  getPlayhead(): number;
}
interface Harness {
  makeRows(scenario: "stack" | "occupied"): Promise<{ ids: string[]; longId: string | null; videoId: string }>;
  makeToneClip(start?: number): Promise<string>;
  makeVideoUrl(): Promise<string>;
  state: { editor: Editor; markerClicks: string[] };
}
/** The harness page's global, typed for this spec (erased when compiled). */
type W = { harness: Harness };

async function open(page: Page, query = "") {
  await page.goto(`${PATH}${query}`);
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
}

const rowNames = (page: Page) =>
  page.locator("[data-timeline-track-header]").evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.trackName));

const rowOf = (page: Page, clipId: string) =>
  page.evaluate(
    (id) => (window as unknown as W).harness.state.editor.getProject().timeline.tracks.find((t) => t.clips.some((c) => c.id === id))?.name ?? null,
    clipId,
  );

const clipOf = (page: Page, clipId: string) =>
  page.evaluate(
    (id) => (window as unknown as W).harness.state.editor.getProject().timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === id) ?? null,
    clipId,
  );

async function center(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragBy(page: Page, selector: string, to: { x: number; y: number }) {
  const from = await center(page, selector);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y - 8, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.mouse.move(to.x + 1, to.y, { steps: 2 });
  await page.mouse.up();
}

test.describe("editor craft for hosts", () => {
  test("the plain Add track button names rows by kind: Video 2, then Video 3", async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as unknown as W).harness.makeRows("stack"));
    expect(await rowNames(page)).toEqual(["Text", "Video", "Voice", "Music"]);
    await page.locator('button.border-dashed[aria-label="Add track"]').click();
    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video", "Voice", "Music", "Video 2"]);
    await page.locator('button.border-dashed[aria-label="Add track"]').click();
    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video", "Voice", "Music", "Video 2", "Video 3"]);
  });

  test("a selection over two rows dragged up keeps its rows apart, as one undo step", async ({ page }) => {
    await open(page);
    const { ids, longId } = await page.evaluate(() => (window as unknown as W).harness.makeRows("occupied"));
    await page.evaluate(() => (window as unknown as W).harness.state.editor.setZoom(40));
    expect(await rowNames(page)).toEqual(["Text", "Video 2", "Video", "Voice", "Music"]);

    await page.locator(`[data-clip-id="${ids[0]}"]`).click();
    await page.locator(`[data-clip-id="${longId}"]`).click({ modifiers: ["Shift"] });
    // S1 (row Video) and Long (row Video 2) dragged two rows up, onto Text: both rows' offset rows
    // do not take them, so each gets a new video row, Long's above S1's
    await dragBy(page, `[data-clip-id="${ids[0]}"]`, await center(page, '[data-track-id="row-text"]'));

    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video 4", "Video 3", "Video 2", "Video", "Voice", "Music"]);
    expect(await rowOf(page, longId!)).toBe("Video 4");
    expect(await rowOf(page, ids[0])).toBe("Video 3");
    expect(await rowOf(page, ids[1])).toBe("Video");

    await page.evaluate(() => (window as unknown as W).harness.state.editor.undo());
    await expect.poll(() => rowNames(page)).toEqual(["Text", "Video 2", "Video", "Voice", "Music"]);
    expect(await rowOf(page, longId!)).toBe("Video 2");
    expect(await rowOf(page, ids[0])).toBe("Video");
  });

  test("audio clips draw a waveform, again after the project is saved and reopened", async ({ page }) => {
    await open(page);
    const id = await page.evaluate(() => (window as unknown as W).harness.makeToneClip());
    await expect(page.locator(`[data-clip-id="${id}"] svg[data-waveform="ready"]`)).toBeVisible({ timeout: 20_000 });

    await page.evaluate(() => (window as unknown as W).harness.state.editor.save());
    await page.click("#unmount");
    await page.click("#remount-stored");
    await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(`[data-clip-id="${id}"] svg[data-waveform="ready"]`)).toBeVisible({ timeout: 20_000 });
  });

  test("move locks stop a drag, and locks survive a host update that leaves them out", async ({ page }) => {
    await open(page);
    const { ids, videoId } = await page.evaluate(() => (window as unknown as W).harness.makeRows("stack"));
    await page.evaluate(() => (window as unknown as W).harness.state.editor.setZoom(80));
    await page.evaluate((id) => (window as unknown as W).harness.state.editor.setClipLocks(id, { move: true }), ids[2]);
    await expect(page.locator(`[data-clip-id="${ids[2]}"]`)).toHaveAttribute("data-lock-move", "");

    const before = (await clipOf(page, ids[2]))!.startTime;
    const from = await center(page, `[data-clip-id="${ids[2]}"]`);
    await dragBy(page, `[data-clip-id="${ids[2]}"]`, { x: from.x + 200, y: from.y });
    await page.waitForTimeout(300);
    expect((await clipOf(page, ids[2]))!.startTime).toBe(before);

    await page.evaluate((id) => (window as unknown as W).harness.state.editor.setTrackLocked(id, true), videoId);
    // the host's server copy knows nothing about locks
    await page.evaluate(async () => {
      const editor = (window as unknown as W).harness.state.editor;
      const remote = JSON.parse(JSON.stringify(editor.getProject()));
      for (const track of remote.timeline.tracks) {
        delete track.locked;
        for (const clip of track.clips) delete clip.locks;
      }
      await editor.applyRemoteProject(remote, { revision: "2" });
    });
    expect((await clipOf(page, ids[2]))!.locks).toEqual({ move: true });
    const locked = await page.evaluate(
      (id) => (window as unknown as W).harness.state.editor.getProject().timeline.tracks.find((t) => t.id === id)?.locked,
      videoId,
    );
    expect(locked).toBe(true);
  });

  test("host markers show on the ruler and report clicks", async ({ page }) => {
    await open(page);
    await page.evaluate(() => (window as unknown as W).harness.makeRows("stack"));
    await page.evaluate(() =>
      (window as unknown as W).harness.state.editor.setMarkers([{ id: "m1", time: 1.5, label: "Fix the colour", color: "#e11d48" }]),
    );
    const marker = page.locator('[data-host-marker="m1"]');
    await expect(marker).toHaveAttribute("aria-label", "Marker: Fix the colour");
    await marker.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as W).harness.state.markerClicks)).toEqual(["m1"]);
    await expect.poll(() => page.evaluate(() => (window as unknown as W).harness.state.editor.getPlayhead())).toBeCloseTo(1.5, 1);
    await page.evaluate(() => (window as unknown as W).harness.state.editor.setMarkers([]));
    await expect(marker).toHaveCount(0);
  });

  test("the loudness meter reads the preview mix while it plays", async ({ page }) => {
    await open(page, "?meters=1");
    const meter = page.locator("[data-loudness-meter]");
    await expect(meter).toBeVisible();
    await expect(meter).toHaveAttribute("data-true-peak", "");
    await page.evaluate(() => (window as unknown as W).harness.makeToneClip());
    await page.locator("[data-preview-playback]").getByRole("button", { name: "Play", exact: true }).click();
    await expect(meter).not.toHaveAttribute("data-true-peak", "", { timeout: 10_000 });
    const peak = Number(await meter.getAttribute("data-true-peak"));
    expect(peak).toBeLessThan(0.5);
    await meter.click();
    await expect(meter).toHaveAttribute("data-integrated", "");
  });

  test("a placeholder with a previewUrl plays the proxy until the real media replaces it", async ({ page }) => {
    await open(page);
    const url = await page.evaluate(() => (window as unknown as W).harness.makeVideoUrl());
    const id = await page.evaluate(
      (previewUrl) => (window as unknown as W).harness.state.editor.addPlaceholderClip({ start: 0, duration: 1, label: "Proxy", previewUrl }),
      url,
    );
    await expect
      .poll(
        () =>
          page.evaluate((clipId) => {
            const editor = (window as unknown as W).harness.state.editor;
            const clip = editor.getProject().timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
            const media = editor.getProject().mediaLibrary.items.find((m) => m.id === clip?.mediaId);
            return clip && media ? { type: media.type, hidden: Boolean(media.hostGenerated), proxy: clip.metadata?.placeholder?.previewUrl ?? null } : null;
          }, id),
        { timeout: 20_000 },
      )
      .toEqual({ type: "video", hidden: true, proxy: url });
  });
});
