import { expect, test, type Page } from "@playwright/test";

import { open, sideways, typeInto } from "./support";

// Navigace a stav uvnitř stránek (8 Oct 2026; doctrine §19e / §19f), in a real browser against the dev harness.
// What only a browser can show: the dots follow the live form, a jump opens a collapsed section and writes no
// URL hash, the row of step numbers follows added and removed steps, and no page overflows sideways.
// The server-rendered markup of the same things is asserted in tests/ui/harness-screens.test.ts.

const WIDTHS = [390, 768, 899, 900, 1024, 1440];

const dotted = (page: Page, nav: string) =>
  page.evaluate((selector) => [...document.querySelectorAll(`${selector} a`)].filter((a) => a.querySelector("[data-won-dot]")).map((a) => a.getAttribute("href") ?? ""), nav);

test("no page overflows sideways at any width, in Czech and in English, on Free and on Pro", async ({ page }) => {
  // Eighteen pages, each loaded once and then resized through the widths (the layouts switch on a resize too).
  test.setTimeout(120_000);
  for (const path of ["tiers", "rewards", "outlet", "campaigns", "margin", "overview?state=live", "rule-editor", "settings", "discounts"]) {
    for (const query of ["", "plan=pro&locale=en"]) {
      const url = query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path;
      await open(page, url);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        // One frame for the layout at the new width.
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        expect(await sideways(page), `${url} @ ${width}`).toBeLessThanOrEqual(0);
      }
    }
  }
});

test("view tiles: low, the sentence never cut, the state once; a click opens the panel and keeps the other panels' fields", async ({ page }) => {
  await open(page, "tiers");
  const row = await page.locator("[data-won-tiles]").boundingBox();
  expect(row?.height ?? 0, "the row of tiles at 1440 px").toBeLessThan(120);
  await expect(page.locator("[data-won-view-tile] [data-won-tile-about]")).toHaveCount(0);
  // The label is on the tile and not again in the section's header under it.
  await expect(page.locator('[data-won-view-tile="global"] [data-won-state="active"]')).toHaveCount(1);
  await expect(page.locator("section#global [data-won-state]")).toHaveCount(0);
  await page.locator('[data-won-view-tile="table"]').click();
  // The view has two panels: the page's own form, and under it the look that saves on its own.
  const panels = page.locator('[data-won-view-panel="table"]');
  expect(await panels.count()).toBeGreaterThan(0);
  for (const panel of await panels.all()) await expect(panel).toBeVisible();
  await expect(page.locator('[data-won-view-panel="global"]')).toBeHidden();
  // Hidden, never unmounted: the levels still belong to the one form.
  expect(await page.locator('[data-won-view-panel="global"] s-number-field').count()).toBeGreaterThan(0);
  // Narrow: two columns, the sentence wraps instead of being cut.
  await open(page, "tiers", 390);
  const cut = await page.evaluate(() => [...document.querySelectorAll("[data-won-view-body] [data-won-tile-active]")].filter((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1).length);
  expect(cut, "tile sentences cut at 390 px").toBe(0);
});

test("the strip under 'Slevy': a dot per module, none for a locked one, the same on every page of the group", async ({ page }) => {
  await open(page, "tiers");
  const strip = () => page.evaluate(() => [...document.querySelectorAll("[data-won-subnav-item]")].map((a) => `${a.getAttribute("data-won-subnav-item")}:${a.querySelector("[data-won-dot]")?.getAttribute("data-won-dot") ?? "-"}`).join(" "));
  const free = await strip();
  expect(free).toBe("discounts:active tiers:active rewards:active outlet:- campaigns:-");
  await open(page, "rewards");
  expect(await strip()).toBe(free);
  await open(page, "tiers?plan=pro");
  expect(await strip()).toBe("discounts:active tiers:active rewards:active outlet:attention campaigns:active");
  // The dot is not the only carrier: the link's text says the state for screen readers.
  await expect(page.locator('[data-won-subnav-item="outlet"]')).toContainText("Vyžaduje pozornost");
});

test("rule editor: the list of sections follows the live form, opens a collapsed section and leaves the URL and the form alone", async ({ page }) => {
  await open(page, "rule-editor");
  const nav = "[data-won-section-nav]";
  // "Černý pátek" has no amount in EUR: the first section holds the marker and the dot.
  expect(await dotted(page, nav)).toEqual(["#discount"]);
  await typeInto(page, "amount_EUR", "12");
  await expect.poll(() => dotted(page, nav)).toEqual([]);
  await typeInto(page, "amount_CZK", "");
  await expect.poll(() => dotted(page, nav)).toEqual(["#discount"]);
  await typeInto(page, "amount_CZK", "300");
  // A code discount without a code: the dot moves to "Jak se uplatní" — and goes when a code is typed.
  await page.locator("#codes label", { hasText: /^Kód/ }).first().click();
  await expect.poll(() => dotted(page, nav)).toEqual(["#codes"]);
  await typeInto(page, "codes", "PATEK");
  await expect.poll(() => dotted(page, nav)).toEqual([]);

  // The Pro section is collapsed: the list opens it and scrolls to it.
  const header = page.locator("section#pro > button");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await page.locator(`${nav} a[href="#pro"]`).click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`${nav} a[href="#pro"]`)).toHaveAttribute("aria-current", "location");
  await expect.poll(() => page.evaluate(() => document.getElementById("pro")?.getBoundingClientRect().top ?? 9999)).toBeLessThan(900);

  // Three quick clicks: the last one wins.
  for (const anchor of ["discount", "codes", "schedule"]) await page.locator(`${nav} a[href="#${anchor}"]`).click();
  await expect(page.locator(`${nav} a[href="#schedule"]`)).toHaveAttribute("aria-current", "location");
  await expect.poll(() => page.evaluate(() => Math.round(document.getElementById("schedule")?.getBoundingClientRect().top ?? 9999))).toBeLessThan(700);

  // No hash was written (nothing to ask "leave the page?" about) and the form holds what was typed.
  expect(new URL(page.url()).hash).toBe("");
  expect(await page.evaluate(() => document.querySelector<HTMLElement & { value: string }>('[name="codes"]')?.value)).toBe("PATEK");
});

test("rule editor: deep links from other pages still land, the retired #more too", async ({ page }) => {
  for (const [hash, id] of [["value", "value"], ["more", "conditions"], ["codes", "codes"], ["combines", "combines"]] as const) {
    await page.goto("about:blank");
    await open(page, `rule-editor?rule=dev-fixture-2#${hash}`);
    await expect.poll(() => page.evaluate((target) => { const top = document.getElementById(target)?.getBoundingClientRect().top; return top !== undefined && top >= 0 && top < window.innerHeight; }, id), { message: `#${hash}` }).toBe(true);
  }
  // `#combines` sits in the collapsed Pro section: the landing opened it.
  await expect(page.locator("section#pro > button")).toHaveAttribute("aria-expanded", "true");
});

test("Nastavení: the dot is only at the section with a state; a link of the list works without JavaScript", async ({ page, browser }) => {
  await open(page, "settings");
  expect(await dotted(page, "[data-won-section-nav]")).toEqual(["#markets"]);
  const plain = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
  const bare = await plain.newPage();
  await bare.goto("/dev/preview/settings");
  await bare.locator('[data-won-section-nav] a[href="#markets"]').click();
  expect(new URL(bare.url()).hash).toBe("#markets");
  await plain.close();
});

test("Milníky: the row of step numbers follows the live list and marks a step that a market does not get", async ({ page }) => {
  const marks = () => page.evaluate(() => [...document.querySelectorAll("[data-won-jump-row] a")].map((a) => `${a.getAttribute("href")}${a.getAttribute("data-won-jump-state") ? "!" : ""}`).join(" "));
  await open(page, "rewards");
  expect(await marks()).toBe("#step-1 #step-2! #step-3");
  // The amount for Slovensko typed in: the red goes without a save.
  const empty = await page.evaluate(() => [...document.querySelectorAll<HTMLElement & { value: string }>("[data-won-ms-amounts] s-number-field")].filter((f) => !f.value).map((f) => f.getAttribute("name") ?? ""));
  expect(empty).toHaveLength(1);
  await typeInto(page, empty[0] ?? "", "60");
  await expect.poll(marks).toBe("#step-1 #step-2 #step-3");
  // A jump lands on the step's card and writes no hash.
  await page.locator('[data-won-jump-row] a[href="#step-3"]').click();
  await expect.poll(() => page.evaluate(() => { const top = document.getElementById("step-3")?.getBoundingClientRect().top; return top !== undefined && top >= 0 && top < window.innerHeight; })).toBe(true);
  expect(new URL(page.url()).hash).toBe("");

  // From nothing to the plan's maximum and back: no row under two steps, never a sideways scroll at 390 px.
  await open(page, "rewards?state=empty&plan=pro", 390);
  const add = page.locator("s-button", { hasText: /^Přidat (první )?stupeň$/ });
  await expect(page.locator("[data-won-jump-row]")).toHaveCount(0);
  await add.click();
  await expect(page.locator("[data-won-ms-step]")).toHaveCount(1);
  await expect(page.locator("[data-won-jump-row]")).toHaveCount(0);
  for (let steps = 2; steps <= 12; steps += 1) {
    await add.click();
    await expect(page.locator("[data-won-jump-row] a")).toHaveCount(steps);
  }
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await page.locator("[data-won-ms-step]").nth(1).locator("s-button", { hasText: "Odebrat" }).click();
  await expect(page.locator("[data-won-jump-row] a")).toHaveCount(11);
  expect(await page.evaluate(() => [...document.querySelectorAll("[data-won-ms-step]")].map((el) => el.id).join(" "))).toBe(Array.from({ length: 11 }, (_, i) => `step-${i + 1}`).join(" "));
});

test("Přehled: the module tiles are above the discounts made in Shopify, and `#native` still leads to them", async ({ page }) => {
  await open(page, "overview?state=live");
  const tops = await page.evaluate(() => ({ tiles: document.querySelector("[data-won-tiles]")?.getBoundingClientRect().top ?? -1, native: document.getElementById("native")?.getBoundingClientRect().top ?? -1 }));
  expect(tops.tiles).toBeGreaterThan(0);
  expect(tops.tiles).toBeLessThan(tops.native);
  expect(tops.tiles, "the signpost starts on the first screen").toBeLessThan(900);
  await page.goto("about:blank");
  await open(page, "overview?state=live#native");
  await expect.poll(() => page.evaluate(() => { const top = document.getElementById("native")?.getBoundingClientRect().top; return top !== undefined && top >= 0 && top < window.innerHeight; })).toBe(true);
});

test("keyboard and reduced motion: the links take focus visibly, Enter jumps, and the jump is not animated when the system asks", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "settings");
  const link = page.locator('[data-won-section-nav] a[href="#markets"]');
  await link.focus();
  expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  // Not animated: the section is under the top of the view in the very next frame.
  const top = await page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(() => resolve(document.getElementById("markets")?.getBoundingClientRect().top ?? 9999))));
  expect(top).toBeLessThan(40);
  await expect(link).toHaveAttribute("aria-current", "location");
});

test("deep links from other pages: a section's anchor opens the view that holds it; a refused save opens the view with the error", async ({ page }) => {
  const inView = (id: string) =>
    page.evaluate((target) => {
      const el = document.getElementById(target);
      if (!el || el.offsetParent === null) return false;
      // (an anchor without a margin of its own lands exactly on the top edge: a fraction of a pixel either way)
      const top = Math.round(el.getBoundingClientRect().top);
      return top >= 0 && top < window.innerHeight;
    }, id);
  for (const [path, anchor, tile] of [
    ["tiers?plan=pro#pro", "pro", "exceptions"],
    ["tiers#block", "block", "table"],
    ["rewards#amounts", "amounts", "steps"],
    ["settings#combination", "combination", null],
    ["settings#markets", "markets", null],
  ] as const) {
    await page.goto("about:blank");
    await open(page, path);
    await expect.poll(() => inView(anchor), { message: path }).toBe(true);
    if (tile) await expect(page.locator(`[data-won-view-tile="${tile}"]`), path).toHaveAttribute("aria-pressed", "true");
  }
  // The save was refused at a field of another view: that view opens, and its tile still says the stored state.
  await page.goto("about:blank");
  await open(page, "tiers?plan=pro&state=exceptions&result=invalid-exception");
  await expect(page.locator('[data-won-view-tile="exceptions"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-won-view-panel="exceptions"]')).toBeVisible();
  await expect(page.locator('[data-won-view-tile="exceptions"] [data-won-state]')).toHaveCount(1);
  await expect(page.locator('[data-won-view-tile="global"] [data-won-state="active"]')).toHaveCount(1);
});

test("keyboard: Tab walks the strip, the tiles and the list in the page's order, and a tile opens with Enter", async ({ page }) => {
  await open(page, "tiers");
  const order: string[] = [];
  for (let presses = 0; presses < 12 && order.length < 8; presses += 1) {
    await page.keyboard.press("Tab");
    const mark = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.getAttribute("data-won-subnav-item") ?? el?.getAttribute("data-won-view-tile") ?? null;
    });
    if (mark) order.push(mark);
  }
  expect(order).toEqual(["discounts", "tiers", "rewards", "outlet", "campaigns", "global", "table", "exceptions"]);
  expect(await page.evaluate(() => getComputedStyle(document.activeElement ?? document.body).outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-won-view-tile="exceptions"]')).toHaveAttribute("aria-pressed", "true");
});
