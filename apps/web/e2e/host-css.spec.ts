import { expect, test, type Page } from "@playwright/test";

const PATH = "/tools/editor/";
const HOST = "html, body, h1, #bar, #bar *, #host-probe, #host-probe *";

/** Every computed property of every host element, as one map keyed by element and property. */
async function hostStyles(page: Page): Promise<Record<string, string>> {
  return page.evaluate((selector) => {
    const out: Record<string, string> = {};
    document.querySelectorAll(selector).forEach((el, index) => {
      const style = getComputedStyle(el);
      const key = `${index}:${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`;
      for (let i = 0; i < style.length; i += 1) {
        const name = style.item(i);
        out[`${key}|${name}`] = style.getPropertyValue(name);
      }
    });
    return out;
  }, HOST);
}

async function load(page: Page, query: string) {
  await page.goto(`${PATH}?${query}`);
  await page.waitForLoadState("load");
  await page.waitForTimeout(400);
}

function differences(before: Record<string, string>, after: Record<string, string>) {
  return Object.keys(before)
    .filter((key) => before[key] !== after[key])
    .map((key) => `${key}: ${before[key]} -> ${after[key]}`);
}

test.describe("the bundle does not restyle the host page", () => {
  test("loading the editor stylesheet changes no computed style of any host element", async ({ page }) => {
    await load(page, "nocss=1&nomount=1");
    const without = await hostStyles(page);
    expect(Object.keys(without).length).toBeGreaterThan(500);

    await load(page, "nomount=1");
    expect(await page.evaluate(() => document.styleSheets.length)).toBeGreaterThan(0);
    expect(differences(without, await hostStyles(page))).toEqual([]);
  });

  test("mounting the editor changes no computed style of the host elements around it", async ({ page }) => {
    await load(page, "nocss=1&nomount=1");
    const without = await hostStyles(page);

    await load(page, "");
    await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(500);
    expect(differences(without, await hostStyles(page))).toEqual([]);
  });

  test("the host page's own utilities and theme markers keep their host meaning", async ({ page }) => {
    await load(page, "");
    await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
    // `hidden`, `flex`, `bg-popover` are Tailwind class names; on the host they are plain unstyled classes
    expect(await page.locator("#probe-hidden").evaluate((el) => getComputedStyle(el).display)).toBe("block");
    expect(await page.locator("#probe-flex").evaluate((el) => getComputedStyle(el).display)).toBe("block");
    expect(
      await page.locator("#probe-popover").evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    // and inside the editor the same class names are the editor's utilities
    const inside = await page.evaluate(() => {
      const root = document.querySelector("[data-openreel-root]") as HTMLElement;
      const probe = document.createElement("div");
      probe.className = "hidden";
      root.append(probe);
      const display = getComputedStyle(probe).display;
      probe.remove();
      return display;
    });
    expect(inside).toBe("none");
  });

  test("host tokens win over the editor's defaults on the root", async ({ page }) => {
    await load(page, "");
    await expect(page.locator("[data-openreel-root] .editor-shell")).toBeVisible({ timeout: 60_000 });
    await page.click("#theme-dark"); // sets --accent: #ff5a36 through theme.tokens
    const root = page.locator("[data-openreel-root]");
    expect(await root.evaluate((el) => getComputedStyle(el).getPropertyValue("--accent").trim())).toBe("#ff5a36");
    await page.click("#theme-light");
    expect(await root.evaluate((el) => getComputedStyle(el).getPropertyValue("--accent").trim())).not.toBe("#ff5a36");
  });
});
