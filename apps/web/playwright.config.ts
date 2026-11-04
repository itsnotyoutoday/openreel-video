import { defineConfig } from "@playwright/test";

// Smoke test of the embed harness against the library build. Build it first:
//   pnpm --filter @openreel/web build:lib
// The harness is served from a sub-path on purpose, to exercise sub-path support.
const PORT = Number(process.env.HARNESS_PORT ?? 5199);
const PREFIX = "/tools/editor";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "node harness/serve.mjs",
    env: { PORT: String(PORT), PREFIX },
    url: `http://localhost:${PORT}${PREFIX}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
