import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getClipStyle } from "./utils";

const css = readFileSync(path.resolve(__dirname, "../../../index.css"), "utf8");

describe("clip colours come from tokens", () => {
  it("maps tracks to the video, voice, music, image and other tokens", () => {
    expect(getClipStyle("video").bg).toContain("var(--clip-video)");
    expect(getClipStyle("audio").bg).toContain("var(--clip-audio)");
    expect(getClipStyle("audio", "dialogue").bg).toContain("var(--clip-audio)");
    expect(getClipStyle("audio", "music").bg).toContain("var(--clip-music)");
    expect(getClipStyle("audio", "ambience").bg).toContain("var(--clip-music)");
    expect(getClipStyle("image").bg).toContain("var(--clip-image)");
    expect(getClipStyle("text").bg).toContain("var(--clip-other)");
    expect(getClipStyle("audio", "music").wave).toBe("var(--clip-music-wave)");
    expect(getClipStyle("video").wave).toBeUndefined();
  });

  it("defines every token for light and for dark", () => {
    const [light, dark] = [css.indexOf("--bg-elev: #ffffff"), css.indexOf("--bg-elev: oklch(0.22")];
    expect(light).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(light);
    const lightBlock = css.slice(light, dark);
    const darkBlock = css.slice(dark, dark + 3000);
    for (const token of [
      "--clip-video",
      "--clip-audio",
      "--clip-audio-wave",
      "--clip-music",
      "--clip-music-wave",
      "--clip-image",
      "--clip-text",
      "--clip-graphic",
      "--clip-other",
      "--placeholder-bg",
      "--placeholder-a",
      "--placeholder-b",
    ]) {
      expect(lightBlock).toContain(`${token}:`);
      expect(darkBlock).toContain(`${token}:`);
    }
  });
});
