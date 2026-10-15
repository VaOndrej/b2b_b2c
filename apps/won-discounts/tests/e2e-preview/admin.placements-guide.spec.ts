import { expect, test, type Page } from "@playwright/test";

import { open, sideways } from "./support";

// Umístění na webu (balík E + zásuvka košíku, 15 Oct 2026), in a real browser against the dev harness: the way a
// merchant walks it — reach the page from the strip under "Slevy", find the place, ONE main button, the guide's three
// steps in order, the brief that is copied is the one shown, the code editor opens on the very file, "Zkontrolovat
// znovu" answers, the developer's tab gives the one line. Plain words: the main interface never says "blok",
// "značka", "embed", "Liquid" or "snippet" (zadání §11). At 390 and 1440 px nothing runs off the screen.

const PLAIN = /\b(blok\w*|značk\w*|embed\w*|liquid|snippet)\b/i;

/** The page's words a merchant reads, without the brief / the line to paste (code, on purpose). */
const visibleWords = (page: Page) =>
  page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("pre, script, style, template, [data-won-guide]").forEach((el) => el.remove());
    // File names (snippets/cart-drawer.liquid) are what the merchant opens: they stay, the words around them may not.
    return clone.innerText.replace(/[\w./-]+\.(liquid|json)\b/g, "");
  });

for (const width of [390, 1440]) {
  test(`${width}px: the page is one click from the strip under Slevy, says every place in plain words, one main button a row`, async ({ page }) => {
    await open(page, "tiers", width);
    const tab = page.locator('[data-won-subnav-item="placements"]');
    await expect(tab).toHaveText("Umístění na webu");
    await expect(tab).toHaveAttribute("href", "/app/placements");

    await open(page, "placements?state=copy", width);
    await expect(page.locator('[data-won-subnav-item="placements"]')).toHaveAttribute("aria-current", "page");
    expect(await sideways(page), "nothing runs off the screen").toBeLessThanOrEqual(0);
    const words = await visibleWords(page);
    expect(words.match(PLAIN)?.[0] ?? null, "no technical word in the main interface").toBeNull();
    // Every row: a name, a state, and at most one main (primary) button.
    for (const row of await page.locator("[data-won-piece]").all()) {
      const holder = row.locator("xpath=ancestor::div[2]");
      expect(await holder.locator('s-button[variant="primary"]').count(), await row.getAttribute("data-won-piece")).toBeLessThanOrEqual(1);
      await expect(row.locator("[data-won-placement]").first()).toBeVisible();
    }
  });

  test(`${width}px: the cart drawer of a theme Won does not know — the guide's three steps in order, the brief copied is the one shown, the editor on the very file, the check answers`, async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, "placements?state=copy", width);
    const row = page.locator('[data-won-piece="msDrawer"]');
    // Here the tag is only in an unpublished copy: the row says so, and the guide is still one click away.
    await expect(row).toContainText("Vloženo jen v kopii vzhledu „Dawn – úpravy košíku“");
    await expect(page.locator('[data-won-guide-open="msDrawer"]')).toHaveText("Připravit zadání pro AI");
    await page.locator('[data-won-guide-open="msDrawer"]').click();
    const guide = page.locator('[data-won-guide="msDrawer"]');
    await expect(guide).toBeVisible();
    await expect(guide.locator('[data-won-guide-tab="ai"]')).toHaveAttribute("variant", "primary");

    // The three steps, top to bottom.
    const steps = ["1. Zkopírovat zadání", "2. Vložit do AI a výsledek uložit", "3. Zkontrolovat"];
    const tops: number[] = [];
    for (const step of steps) {
      const el = guide.getByText(step, { exact: true });
      await expect(el).toBeVisible();
      // Polaris s-text has no box of its own (display: contents): the text's own rectangle.
      tops.push(
        await el.evaluate((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect().y;
        }),
      );
    }
    expect([...tops].sort((a, b) => a - b), "the steps read top to bottom").toEqual(tops);
    await expect(guide).toContainText("Obsahuje i soubor snippets/cart-drawer.liquid z vašeho vzhledu.");

    // Step 1: prepare, read, copy — the clipboard holds exactly what the page shows.
    await guide.getByText("Připravit zadání", { exact: true }).click();
    const brief = guide.locator('[data-won-brief="msDrawer"]');
    await expect(brief).toBeVisible();
    const shown = await brief.innerText();
    expect(shown).toContain('<won-discounts show="cart"></won-discounts>');
    expect(shown).toContain("In the file `snippets/cart-drawer.liquid`, in the cart drawer, right above the checkout button");
    expect(shown).toContain("## Rules");
    expect(shown).toContain("## The current file `snippets/cart-drawer.liquid`");
    await guide.getByText("Zkopírovat zadání", { exact: true }).click();
    await expect(guide.getByText("Zkopírováno ✓")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);

    // Step 2: the code editor of the live theme, on the very file, in a new tab; the themes list next to it.
    const file = guide.getByText("Otevřít soubor v editoru kódu", { exact: true });
    await expect(file).toHaveAttribute("href", "https://won-dev.myshopify.com/admin/themes/184467440737?key=snippets%2Fcart-drawer.liquid");
    await expect(file).toHaveAttribute("target", "_blank");
    await expect(guide).toContainText("Bezpečnější je upravit nejdřív kopii vzhledu");

    // Step 3: the check answers on the spot.
    await guide.getByText("Zkontrolovat znovu", { exact: true }).click();
    await expect(guide).toContainText("Vzhled je přečtený znovu.");

    // The developer's tab: the file and the one line, its options.
    await guide.locator('[data-won-guide-tab="self"]').click();
    await expect(guide).toContainText("Vložte tento řádek do souboru snippets/cart-drawer.liquid");
    await expect(guide.locator('[data-won-tag-line="msDrawer"]')).toHaveText('<won-discounts show="cart"></won-discounts>');
    await expect(guide).toContainText("Volby: size: compact | full");
    expect(await sideways(page), "the open guide stays on the screen").toBeLessThanOrEqual(0);
  });

  test(`${width}px: Horizon / Dawn drawer — "by itself, above the checkout button", the spot changed in Won's settings, and the AI way under "Chci to jinde"`, async ({ page }) => {
    await open(page, "placements?state=drawer-auto", width);
    const row = page.locator('[data-won-piece="msDrawer"]');
    await expect(row).toHaveAttribute("data-won-piece-state", "auto");
    await expect(row).toContainText("Ukazuje se samo ve vzhledu Dawn, nad tlačítkem pokladny.");
    const setting = page.locator("[data-won-drawer-setting]");
    await expect(setting).toHaveText("Změnit místo");
    await expect(setting).toHaveAttribute("href", /\/admin\/themes\/current\/editor\?context=apps/);
    await page.locator('[data-won-elsewhere="msDrawer"]').click();
    await expect(page.locator('[data-won-guide="msDrawer"]')).toBeVisible();

    await open(page, "placements?state=drawer-off", width);
    await expect(page.locator('[data-won-piece="msDrawer"]')).toContainText("V nastavení Won ve vzhledu je panel v zásuvce vypnutý.");
    await expect(page.locator("[data-won-drawer-setting]")).toHaveText("Zapnout v zásuvce");
    await expect(page.locator("[data-won-drawer-setting]")).toHaveAttribute("variant", "primary");
  });
}
