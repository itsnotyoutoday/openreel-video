import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";

interface AiState {
  requests: number;
  usage: Array<{ model: string; inputTokens?: number; outputTokens?: number }>;
  toolCalls: Array<{ name: string; phase: string; ok?: boolean }>;
  messages: Array<{ role: string; text: string }>;
  externalFetches: string[];
}

const aiState = (page: Page): Promise<AiState> =>
  page.evaluate(() => (window as unknown as { harness: { state: { ai: AiState } } }).harness.state.ai);

async function open(page: Page, query = "") {
  await page.goto(`${PATH}${query}`);
  await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "AI Editor chat" }).click();
}

test.describe("host AI", () => {
  test("managed: runs a turn through the host transport, shows no key UI, and calls no provider", async ({ page }) => {
    await open(page, "?ai=managed");

    // The cogwheel shows the host's note, the model picker, and no provider/key/base-URL entry.
    await page.getByRole("button", { name: "AI settings" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("ai-managed-note")).toContainText("Managed by the host");
    await expect(dialog.getByRole("link", { name: "Open host settings" })).toHaveAttribute(
      "href",
      "https://host.example/settings",
    );
    await expect(dialog.getByLabel("AI model")).toHaveValue("host-fast");
    await expect(dialog.getByLabel("Session API key")).toHaveCount(0);
    await expect(dialog.getByLabel("AI base URL")).toHaveCount(0);
    await expect(dialog.getByLabel("AI provider")).toHaveCount(0);
    await expect(dialog.getByRole("tab", { name: "API Keys" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The model picker is also in the chat header when the host offers several.
    await expect(page.getByLabel("AI model")).toBeVisible();

    // A turn: the fake transport asks for the host tool, then streams the answer.
    const composer = page.getByLabel("AI edit request");
    await composer.fill("ping the host");
    await composer.press("Enter");
    await expect(page.getByRole("log").getByText("Pinged the host.")).toBeVisible({ timeout: 20_000 });

    await expect.poll(async () => (await aiState(page)).toolCalls).toEqual([
      { name: "host_ping", phase: "start" },
      { name: "host_ping", phase: "end", ok: true },
    ]);
    const state = await aiState(page);
    expect(state.requests).toBe(2);
    // usage of the last request is reported just after its text is shown
    await expect.poll(async () => (await aiState(page)).usage.length).toBe(2);
    expect(state.usage.length === 2 ? state.usage : (await aiState(page)).usage).toEqual([
      { model: "host-fast", inputTokens: 20, outputTokens: 8 },
      { model: "host-fast", inputTokens: 20, outputTokens: 8 },
    ]);
    expect(state.messages).toEqual([
      { role: "user", text: "ping the host" },
      { role: "assistant", text: "Pinged the host." },
    ]);
    expect(await page.evaluate(() => (window as unknown as { harness: { state: { toolCalls: number } } }).harness.state.toolCalls)).toBe(1);
    // No request left the page's own origin: the editor made no provider call.
    expect(state.externalFetches).toEqual([]);
  });

  test("without the ai option the editor asks for the person's own key, as before", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "AI settings" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Session API key")).toBeVisible();
    await expect(dialog.getByLabel("AI provider")).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "API Keys" })).toBeVisible();
    await expect(dialog.getByTestId("ai-managed-note")).toHaveCount(0);
  });
});
