import { test, expect } from '@playwright/test';

/**
 * PDP detail zone — product facts belong to ONE place on the page.
 *
 * Found in review (2026-09-02): the PDP shipped two competing detail areas. A
 * headingless band carried Parametry / Nutriční hodnoty / Kdy užívat, and
 * immediately below it a section titled "Podrobnosti" promised details that had
 * already gone past. On top of that the band flowed its three blocks through CSS
 * multi-column, so the dosage timeline landed under the nutrition table with a
 * 127px void beside it and read as that table's footnote.
 *
 * Asserted as invariants, not as a section list:
 *   1. Fact blocks live in exactly one section — whichever section that is.
 *   2. That section is the one carrying the detail heading (no orphan facts
 *      above a heading that announces them).
 *   3. Switchable content actually switches: a fact block nested in a panel is
 *      hidden until its tab is picked, and picking it hides the previous panel.
 *      This is the regression that nesting theme blocks inside a panel invites.
 */

const PDP = '/products/the-videographer-snowboard';

// A "fact block" is any block that presents structured product data. Selectors
// name the data shapes, not the blocks, so a new fact block is covered for free.
const FACTS = '.won-params, .won-nutri, .won-dosage';

async function goto(page: import('@playwright/test').Page) {
  await page.goto(PDP, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(700);
}

test('product facts live in one section, the one that announces them', async ({ page }) => {
  await goto(page);

  const zones = await page.evaluate((sel) => {
    const found = [...document.querySelectorAll<HTMLElement>(sel)];
    const bySection = new Map<string, { heading: string; facts: string[] }>();
    for (const el of found) {
      const section = el.closest<HTMLElement>('.shopify-section, [id^="shopify-section"]');
      if (!section) continue;
      const key = section.id || section.className;
      if (!bySection.has(key)) {
        const h = section.querySelector('h1, h2');
        bySection.set(key, { heading: (h?.textContent || '').trim(), facts: [] });
      }
      bySection.get(key)!.facts.push(el.className.split(' ')[0]);
    }
    return [...bySection.entries()].map(([id, v]) => ({ id, ...v }));
  }, FACTS);

  expect(zones.length, 'no fact block on the PDP at all — the probe lost its target').toBeGreaterThan(0);
  expect(
    zones.length,
    `product facts are split across ${zones.length} sections: ` +
      JSON.stringify(zones.map((z) => ({ heading: z.heading, facts: z.facts }))) +
      ' — two detail zones make the second heading a lie',
  ).toBe(1);
  expect(
    zones[0].heading,
    'the section holding the facts has no heading of its own — the tables read as orphans',
  ).not.toBe('');
});

test('a fact nested in a tab panel is hidden until its tab is picked', async ({ page }) => {
  await goto(page);

  const tabset = page.locator('won-tabset').first();
  await expect(tabset, 'the detail zone is not a tabset').toBeVisible();

  const tabs = tabset.locator('[role="tab"]');
  const panels = tabset.locator('.won-panels__panel');
  const tabCount = await tabs.count();
  expect(
    tabCount,
    'every panel owes exactly one tab button — a nested block must not become a panel',
  ).toBe(await panels.count());

  // Every tab must reveal its own panel and only its own panel, whatever it holds.
  for (let i = 0; i < tabCount; i++) {
    await tabs.nth(i).click();
    const state = await page.evaluate((idx) => {
      const set = document.querySelector('won-tabset')!;
      const ps = [...set.querySelectorAll<HTMLElement>('.won-panels__panel')];
      return ps.map((p, j) => ({
        j,
        title: p.dataset.title || '',
        visible: p.getBoundingClientRect().height > 1,
        facts: p.querySelectorAll('.won-params, .won-nutri, .won-dosage').length,
      })).filter((p) => p.visible || p.j === idx);
    }, i);

    const visible = state.filter((p) => p.visible);
    expect(
      visible.map((p) => p.title),
      `tab ${i} selected but ${visible.length} panels are visible — a hidden panel is leaking`,
    ).toEqual([state.find((p) => p.j === i)!.title]);
  }

  // At least one panel must actually carry a fact block, otherwise the merge
  // above happened in name only.
  const nested = await page.evaluate(() =>
    [...document.querySelectorAll('.won-panels__panel')].filter(
      (p) => p.querySelectorAll('.won-params, .won-nutri, .won-dosage').length,
    ).length,
  );
  expect(nested, 'no tab panel carries a fact block — the tables did not move in').toBeGreaterThan(0);
});
