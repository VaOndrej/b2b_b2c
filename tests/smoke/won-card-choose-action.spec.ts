import { test, expect } from '@playwright/test';

/**
 * "Choose" on a card: a quick-view modal by default, a link to the PDP if the
 * merchant prefers that.
 *
 * A card for a product with variants cannot add to cart — it does not know which
 * variant. Sending the shopper to the PDP for that is a full page load out of the
 * grid they were scanning; for impulse goods (ux-system PRICE TIER: supplements)
 * that is friction the basket pays for. A modal keeps them in the listing.
 *
 * This is Horizon's own quick-add dialog, not a second one: the component, the
 * fetch, the focus handling and the dialog element in layout/theme.liquid already
 * exist (conventions C8 — check the base theme before building). The card only
 * decides whether to use it, and dresses its button in the card's own CTA look so
 * "Choose" stays identical to "Add to cart" and "Sold out".
 */

const PLP = '/collections/automated-collection';

/** The card control that offers variant choice, whichever mode is active. */
const CHOOSE = '.won-pcard :is(.won-pcard__add--link, .quick-add__button--choose)';

async function setSetting(value: string) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const p = 'themes/dist/horizon-dev/config/settings_data.json';
  const raw = readFileSync(p, 'utf8');
  const i = raw.indexOf('{');
  const d = JSON.parse(raw.slice(i));
  d.current.won_card_choose_action = value;
  writeFileSync(p, raw.slice(0, i) + JSON.stringify(d, null, 2) + '\n');
}

test('the theme offers a choose-action setting, defaulting to the modal', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const f = join(process.cwd(), 'themes/dist/horizon-dev/config/settings_schema.json');
  expect(existsSync(f), 'composed theme not found').toBe(true);

  let setting: any = null;
  for (const group of JSON.parse(readFileSync(f, 'utf8'))) {
    for (const s of group?.settings ?? []) if (s?.id === 'won_card_choose_action') setting = s;
  }
  expect(setting, 'no global `won_card_choose_action` setting — the merchant cannot pick').not.toBeNull();
  const values = (setting.options ?? []).map((o: any) => o.value).sort();
  expect(values, 'the setting must offer exactly the two behaviours').toEqual(['link', 'modal']);
  expect(setting.default, 'the modal keeps the shopper in the listing, so it is the default').toBe('modal');
});

test('Choose opens the quick-view dialog without leaving the listing', async ({ page }) => {
  await page.goto(PLP, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const choose = page.locator(CHOOSE).first();
  expect(await choose.count(), 'no product with variants on the listing to exercise').toBeGreaterThan(0);

  const urlBefore = page.url();
  // Hover the CARD, then click for real. `force: true` would skip the hit test and
  // pass even if the media link covered the button — which is exactly the failure
  // this needs to catch, because the control only appears on hover.
  // The `has:` selector is resolved RELATIVE to the card, so it must not repeat
  // the .won-pcard prefix — with it the filter matches nothing and the hover times
  // out on a card that is right there.
  const card = page
    .locator('.won-pcard')
    .filter({ has: page.locator('[data-won-quickview], .quick-add__button--choose') })
    .first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.waitForTimeout(400);
  await expect(choose, 'the revealed Choose control must be clickable, not covered').toBeVisible();
  await choose.click();
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => {
    const dlg = document.querySelector('#quick-add-dialog dialog') as HTMLDialogElement | null;
    const content = document.getElementById('quick-add-modal-content');
    const text = (content?.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      open: !!dlg?.open,
      hasVariantPicker: !!content?.querySelector('variant-picker, .variant-option, fieldset input'),
      hasAddToCart: !!content?.querySelector('button[name="add"], [type="submit"]'),
      chars: text.length,
    };
  });

  expect(page.url(), 'the modal must not navigate away from the listing').toBe(urlBefore);
  expect(state.open, 'clicking Choose must open the quick-view dialog').toBe(true);
  expect(state.hasVariantPicker, 'the dialog must let the shopper pick a variant').toBe(true);
  expect(state.hasAddToCart, 'the dialog must let the shopper add to cart').toBe(true);
});

test('Choose keeps the card CTA shape whichever mode is active', async ({ page }) => {
  await page.goto(PLP, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const shapes = await page.evaluate(() => {
    const out: Record<string, { h: number; font: string; radius: string }> = {};
    for (const card of document.querySelectorAll('.won-pcard')) {
      const el = card.querySelector<HTMLElement>(
        '.won-pcard__add, .quick-add__button--choose'
      );
      if (!el) continue;
      el.style.opacity = '1';
      el.style.translate = 'none';
      if (el.hasAttribute('data-won-qty-value')) continue;
      const kind = el.classList.contains('quick-add__button--choose')
        ? 'choose-modal'
        : [...el.classList].filter((c) => c.startsWith('won-pcard__add--')).join(',') || 'button';
      if (out[kind]) continue;
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      out[kind] = { h: Math.round(b.height), font: cs.fontSize, radius: cs.borderRadius.split(' ')[0] };
    }
    return out;
  });

  const kinds = Object.keys(shapes);
  expect(kinds.length, 'need at least two CTA variants to compare').toBeGreaterThan(1);
  for (const prop of ['h', 'font', 'radius'] as const) {
    const values = [...new Set(kinds.map((k) => String(shapes[k][prop])))];
    expect(
      values.length,
      `card CTAs disagree on ${prop}: ${kinds.map((k) => `${k} ${shapes[k][prop]}`).join(', ')}`,
    ).toBe(1);
  }
});
