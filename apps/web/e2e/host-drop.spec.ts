import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";

interface DropProject {
  mediaLibrary: { items: Array<{ id: string; type: string }> };
  timeline: { tracks: Array<{ id: string; type: string; clips: Array<{ id: string; mediaId: string }> }> };
  textClips?: Array<{ id: string; trackId: string }>;
}
type DropHarness = { makeVideoAndTextRows(): Promise<string>; project(): DropProject };

async function open(page: Page) {
  await page.goto(PATH);
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
}

test.describe("dropping a video", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "the generated test video needs MediaRecorder WebM encoding");

  test("above a video track with a free text row makes a new video row, not a stack on the text row", async ({ page }) => {
    await open(page);
    const videoTrackId = await page.evaluate(() => (window as unknown as { harness: DropHarness }).harness.makeVideoAndTextRows());

    // a text row with room: a title on its own text track, away from where the video lands
    await page.locator("[data-openreel-root]").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("t");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { harness: DropHarness }).harness.project().textClips?.length ?? 0))
      .toBe(1);

    const before = await page.evaluate(() => {
      const project = (window as unknown as { harness: DropHarness }).harness.project();
      return project.timeline.tracks.map((t) => ({ id: t.id, type: t.type, clips: t.clips.length }));
    });

    await page.getByRole("button", { name: "Fake library" }).click();
    const lane = page.locator(`[data-track-id="${videoTrackId}"]`);
    await page
      .locator('li[data-asset-id="clip"]')
      .dragTo(lane, { targetPosition: { x: 40, y: 20 } });

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const project = (window as unknown as { harness: DropHarness }).harness.project();
            const videoMedia = new Set(project.mediaLibrary.items.filter((m) => m.type === "video").map((m) => m.id));
            return project.timeline.tracks
              .filter((t) => t.clips.some((c) => videoMedia.has(c.mediaId)))
              .map((t) => ({ id: t.id, type: t.type }));
          }),
        { timeout: 30_000 },
      )
      .toHaveLength(1);

    const after = await page.evaluate(() => {
      const project = (window as unknown as { harness: DropHarness }).harness.project();
      const videoMedia = new Set(project.mediaLibrary.items.filter((m) => m.type === "video").map((m) => m.id));
      return {
        tracks: project.timeline.tracks.map((t) => ({
          id: t.id,
          type: t.type,
          hasVideo: t.clips.some((c) => videoMedia.has(c.mediaId)),
          clips: t.clips.length,
        })),
        textTrackIds: [...new Set((project.textClips ?? []).map((c) => c.trackId))],
      };
    });
    const landed = after.tracks.find((t) => t.hasVideo)!;
    expect(landed.type).toBe("video");
    expect(landed.id).not.toBe(videoTrackId); // a new row, because the video row is occupied there
    expect(after.textTrackIds).not.toContain(landed.id); // and it is not the text row
    expect(after.tracks.length).toBe(before.length + 1);
    // the existing video row and the text row keep what they had
    for (const track of before) {
      expect(after.tracks.find((t) => t.id === track.id)?.clips).toBe(track.clips);
    }
  });
});
