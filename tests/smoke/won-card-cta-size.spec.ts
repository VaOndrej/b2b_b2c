import { test, expect } from '@playwright/test';

/**
 * Every quick-add control on a card is the same size.
 *
 * A card shows one of three things depending on the product: "Add to cart" (or a
 * stepper once the cart holds a line), "Choose" for a product with variants, and
 * "Sold out". They sit in the same corner of identically sized cards, so a
 * shopper scanning a grid sees them as one control that keeps changing height.
 *
 * Measured: the stepper rendered at 61px while "Choose" and "Sold out" were 44px.
 * The stepper's own +/- buttons already carry the 44px tap floor, and the
 * container added its padding on top — the base `.won-pcard__add` rule is
 * declared AFTER the `--stepper` modifier in the stylesheet, so at equal
 * specificity the base padding won.
 *
 * The floor is a separate promise: no variant may drop under 44px (WCAG 2.5.5),
 * whatever size the merchant picks.
 */
const TAP_MIN = 44;

test('every card quick-add variant renders at the same height', async ({ page }) => {
  await page.goto('/collections/automated-collection', { waitUntil: 'load' });
  await page.waitForTimeout(1600);

  const variants = await page.evaluate(() => {
    const out: { kind: string; label: string; h: number }[] = [];
    for (const card of document.querySelectorAll('.won-pcard')) {
      const el = card.querySelector<HTMLElement>('.won-pcard__add');
      if (!el) continue;
      // The reveal is a hover affordance; measure the control, not the animation.
      el.style.opacity = '1';
      el.style.translate = 'none';
      const b = el.getBoundingClientRect();
      if (b.height < 1) continue;
      out.push({
        kind: [...el.classList].filter((c) => c.startsWith('won-pcard__add--')).join(',') || 'button',
        label: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 14),
        h: Math.round(b.height),
      });
    }
    return out;
  });

  expect(variants.length, 'no quick-add controls on the listing — nothing measured').toBeGreaterThan(1);

  const heights = [...new Set(variants.map((v) => v.h))];
  expect(
    heights.length,
    `card quick-add renders at ${heights.length} different heights: ` +
      variants.map((v) => `${v.kind || 'button'}="${v.label}" ${v.h}px`).join(', '),
  ).toBe(1);

  const short = variants.filter((v) => v.h < TAP_MIN);
  expect(
    short,
    `quick-add under the ${TAP_MIN}px tap floor (WCAG 2.5.5): ${short.map((s) => `${s.kind} ${s.h}px`).join(', ')}`,
  ).toEqual([]);
});

/**
 * ...and the same shape, not just the same height.
 *
 * Equal height was not enough: in stepper mode the control keeps tight inline
 * padding (5px) because the +/- buttons carry their own hit area — but before the
 * cart holds a line that same element shows a plain "Add to cart" label, and next
 * to a "Choose" padded to 14px it reads as a different button. Same corner, same
 * grid, two shapes.
 *
 * So the contract is: in its LABEL state every variant has the same padding and
 * the same type. The tight padding is correct only once the +/- are actually on
 * screen, which the element announces with `data-won-qty-value`.
 */
test('card quick-add variants share one shape in their label state', async ({ page }) => {
  await page.goto('/collections/automated-collection', { waitUntil: 'load' });
  await page.waitForTimeout(1600);

  const shapes = await page.evaluate(() => {
    const out: Record<string, { pad: string; font: string; radius: string; label: string }> = {};
    for (const card of document.querySelectorAll('.won-pcard')) {
      const el = card.querySelector<HTMLElement>('.won-pcard__add');
      if (!el) continue;
      // Only the label state — a stepper showing +/- is a different control.
      if (el.hasAttribute('data-won-qty-value')) continue;
      el.style.opacity = '1';
      el.style.translate = 'none';
      const kind = [...el.classList].filter((c) => c.startsWith('won-pcard__add--')).join(',') || 'button';
      if (out[kind]) continue;
      const cs = getComputedStyle(el);
      out[kind] = {
        // Only the INLINE padding is visible: height is pinned by the tap floor,
        // so a difference in block padding changes nothing a shopper can see —
        // and the stepper legitimately has none, because its inner buttons carry
        // the height instead.
        pad: `${cs.paddingRight}/${cs.paddingLeft}`,
        font: cs.fontSize,
        radius: cs.borderRadius.split(' ')[0],
        label: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 14),
      };
    }
    return out;
  });

  const kinds = Object.keys(shapes);
  expect(kinds.length, 'need at least two quick-add variants on the listing to compare').toBeGreaterThan(1);

  for (const prop of ['pad', 'font', 'radius'] as const) {
    const values = [...new Set(kinds.map((k) => shapes[k][prop]))];
    expect(
      values.length,
      `quick-add variants disagree on ${prop}: ` +
        kinds.map((k) => `${k}="${shapes[k].label}" ${shapes[k][prop]}`).join(', '),
    ).toBe(1);
  }
});
