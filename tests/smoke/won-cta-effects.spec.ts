import { test, expect, type Page } from '@playwright/test';

// CTA effect layer — reported as "quick add on the product card has no effect at
// all, no hover, no sheen; these must be settings so several stores can each get
// their own signature look".
//
// Two things are guarded, and they are deliberately different in kind:
//
//  1. STRUCTURAL — every won CTA carries the theme-wide effect classes. A section
//     that hand-rolls its own button skips the whole system, and that is exactly
//     how the card quick-add ended up with no hover state while `.won-btn` had one.
//     Class-name based, so it fails on the section that forgets, not on a screenshot.
//
//  2. BEHAVIOURAL — hovering a CTA actually CHANGES something the shopper can see.
//     A class that resolves to no visual difference is the same bug wearing a
//     different hat, so this compares computed styles at rest vs. on hover instead
//     of trusting the markup.
//
// Both are generic: no section is named, and the assertions follow whatever the
// merchant has chosen in the theme editor rather than hardcoding today's default.

const FX_FAMILIES = ['hover', 'sheen', 'press', 'speed'] as const;

async function settle(page: Page) {
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1800));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
  });
}

test('every won CTA opts into the shared effect layer', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await settle(page);

  const ctas = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.won-btn, .won-pcard__add'))
      // Sold out is a label, not an action — it must NOT animate on hover.
      .filter((el) => !el.classList.contains('won-pcard__add--soldout'))
      .map((el) => ({
        cls: el.className,
        where: (el.closest('[data-testid]') as HTMLElement | null)?.dataset.testid ?? 'page',
      }))
  );

  expect(ctas.length, 'demo pages must render at least one won CTA').toBeGreaterThan(0);

  for (const cta of ctas) {
    expect(cta.cls, `${cta.where}: CTA is outside the effect layer`).toContain('won-fx');
    for (const family of FX_FAMILIES) {
      expect(
        cta.cls,
        `${cta.where}: CTA carries no resolved "${family}" effect (${cta.cls})`
      ).toMatch(new RegExp(`won-fx--${family}-[a-z_]+`));
    }
  }
});

test('the whole theme resolves ONE effect per family', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await settle(page);

  // The point of a theme-wide setting is that a store has a signature, not a
  // per-section lottery. Two different hover effects on one page means a section
  // hardcoded its own.
  const byFamily = await page.evaluate((families: readonly string[]) => {
    const out: Record<string, string[]> = {};
    for (const family of families) {
      const found = new Set<string>();
      document.querySelectorAll('.won-fx').forEach((el) => {
        const m = el.className.match(new RegExp(`won-fx--${family}-([a-z_]+)`));
        if (m) found.add(m[1]);
      });
      out[family] = [...found];
    }
    return out;
  }, FX_FAMILIES);

  for (const family of FX_FAMILIES) {
    expect(
      byFamily[family].length,
      `theme resolves ${byFamily[family].length} different "${family}" effects: ${byFamily[family].join(', ')}`
    ).toBe(1);
  }
});

test('card quick-add visibly reacts to hover', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await settle(page);

  const card = page.locator('.won-pcard:has([data-won-add])').first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.waitForTimeout(500);

  const add = card.locator('.won-pcard__add').first();
  const probe = () =>
    add.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { transform: cs.transform, shadow: cs.boxShadow, bg: cs.backgroundColor, color: cs.color };
    });

  // The reveal itself must not be mistaken for the effect: the card is already
  // hovered here, so the button is fully shown in BOTH samples. What changes
  // between them is the hover effect and nothing else.
  const rest = await probe();
  await add.hover();
  await page.waitForTimeout(500);
  const hovered = await probe();

  const changed = (Object.keys(rest) as (keyof typeof rest)[]).filter((k) => rest[k] !== hovered[k]);
  expect(
    changed.length,
    `quick-add looks identical hovered and not: ${JSON.stringify(rest)}`
  ).toBeGreaterThan(0);
});

test('sheen is a real animation when the theme asks for it', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await settle(page);

  const card = page.locator('.won-pcard:has([data-won-add])').first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.waitForTimeout(400);

  const add = card.locator('.won-pcard__add').first();
  const mode = await add.evaluate((el) => el.className.match(/won-fx--sheen-([a-z]+)/)?.[1] ?? 'off');
  test.skip(mode === 'off', 'theme has the sheen turned off');

  await add.hover();
  await page.waitForTimeout(300);
  const sheen = await add.evaluate((el) => {
    const cs = getComputedStyle(el, '::after');
    return { content: cs.content, name: cs.animationName, dur: cs.animationDuration };
  });

  expect(sheen.content, 'sheen needs its ::after layer').not.toBe('none');
  expect(sheen.name, 'sheen must resolve to a real keyframe animation').not.toBe('none');
  expect(parseFloat(sheen.dur), 'sheen animation must have a duration').toBeGreaterThan(0);
});

test('effects stand down under prefers-reduced-motion', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto('/', { waitUntil: 'load' });
    await settle(page);

    const card = page.locator('.won-pcard:has([data-won-add])').first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await page.waitForTimeout(300);
    const add = card.locator('.won-pcard__add').first();
    await add.hover();
    await page.waitForTimeout(300);

    const motion = await add.evaluate((el) => ({
      transform: getComputedStyle(el).transform,
      sheen: getComputedStyle(el, '::after').animationName,
    }));

    expect(motion.transform, 'no transform under reduced motion').toMatch(/none|matrix\(1, 0, 0, 1, 0, 0\)/);
    expect(motion.sheen, 'no sheen under reduced motion').toBe('none');
  } finally {
    await context.close();
  }
});
