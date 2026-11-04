import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// The beat-detection, FFT and WAV engines fetch `new URL("./build/<name>.wasm",
// import.meta.url)`. The library build must resolve those at build time: Vite
// inlines these small modules into the bundle as data: URLs, so they work from
// any base path. An unbuilt wasm leaves the relative URL in the bundle, which
// 404s (or is answered with an HTML page) from the host.
const chunks = path.resolve(process.cwd(), "dist-lib/chunks");

const exportsByModule = {
  beat: "computeRMSEnergies",
  fft: "getMagnitudeAndPhase",
  wav: "encodeWav16Mono",
} as const;

test("the library bundle carries the beat, fft and wav wasm modules and no unresolved wasm path", () => {
  const library = readdirSync(chunks).filter((name) => name.startsWith("library-") && name.endsWith(".js"));
  expect(library.length).toBeGreaterThan(0);
  const source = library.map((name) => readFileSync(path.join(chunks, name), "utf8")).join("\n");

  const modules = [...source.matchAll(/data:application\/wasm;base64,([A-Za-z0-9+/=]+)/g)].map((match) =>
    Buffer.from(match[1], "base64"),
  );
  for (const [name, exportName] of Object.entries(exportsByModule)) {
    const found = modules.find((bytes) => bytes.includes(Buffer.from(exportName)));
    expect(found, `${name}.wasm (exports ${exportName})`).toBeTruthy();
    expect([...found!.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]); // "\0asm"
  }
  expect(source).not.toMatch(/\.\/build\/(beat|fft|wav)\.wasm/);
});
