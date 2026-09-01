import { test, expect } from '@playwright/test';

// Product-card scale in swipeable rails.
//
// Rail item widths are a PERCENTAGE of their container, and that percentage used
// to apply unchanged across the whole 0–749px band. The result, measured:
//
//   viewport  container   card        media height
//   390px     358px       272 x 441   340px   <- correct, a phone
//   749px     689px       524 x 756   655px   <- same rule, absurd
//   750px     690px       572 x 816   715px   <- worst: see the dead zone below
//
// while `.won-pcard__title` stayed at the inherited 14px at every width. Reported
// as "text tiny, card enormous" from a ~700px browser pane.
//
// Two distinct defects, one spec:
//
//  1. NO CEILING — a percentage that is right for a phone is wrong for a tablet.
//     Fixed with `min(<pct>, var(--won-card-max))`.
//  2. DEAD ZONE 750–767px — the peek/scroll-sm overrides ended at `max-width:
//     749px` but the column switch started at `min-width: 768px`, so in between
//     the rail collapsed to one full-width column. The two breakpoints now agree
//     on 750.
//
// Deliberately asserts a RATIO and a CEILING rather than exact pixels, so it
// survives copy and gap changes but still fails on the class of bug above.

const CARD_MAX = 380; // --won-card-max in won-tokens.css
const SLACK = 8; // sub-pixel + border rounding

async function firstCardGeometry(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1800));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });
  return page.evaluate(() => {
    const card = document.querySelector('.won-pcard');
    if (!card) return null;
    const media = card.querySelector('.won-pcard__media');
    const title = card.querySelector('.won-pcard__title');
    const container = card.closest('[data-testid]')?.querySelector('.won-container');
    return {
      cardW: card.getBoundingClientRect().width,
      mediaH: media ? media.getBoundingClientRect().height : 0,
      titlePx: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
      containerW: container ? container.getBoundingClientRect().width : 0,
    };
  });
}

// 700px: the width the bug was reported at, and inside the band where the
// percentage basis had no ceiling. Set explicitly rather than relying on the
// project viewport — at 390px the card is already under the cap and the
// assertion would pass against the unfixed theme, guarding nothing.
test('rail cards never outgrow the card ceiling', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  const g = await firstCardGeometry(page);
  expect(g, 'homepage should render at least one product card').not.toBeNull();
  expect(
    g!.cardW,
    `card is ${Math.round(g!.cardW)}px wide in a ${Math.round(g!.containerW)}px container`
  ).toBeLessThanOrEqual(CARD_MAX + SLACK);
});

test('card title stays legible relative to the card it sits on', async ({ page }) => {
  await page.setViewportSize({ width: 749, height: 900 });
  const g = await firstCardGeometry(page);
  expect(g).not.toBeNull();
  // At the broken 749px width this was 524 / 14 = 37. Anything past ~30 reads as
  // "huge card, tiny text" regardless of the absolute numbers.
  const ratio = g!.cardW / g!.titlePx;
  expect(
    ratio,
    `card ${Math.round(g!.cardW)}px vs title ${g!.titlePx}px = ${ratio.toFixed(1)}x`
  ).toBeLessThan(30);
});

test('no dead zone: the 750px rail is not a single full-width column', async ({ page }) => {
  await page.setViewportSize({ width: 750, height: 900 });
  const g = await firstCardGeometry(page);
  expect(g).not.toBeNull();
  // The bug made the card ~83% of its container here (one column, full width).
  const frac = g!.cardW / g!.containerW;
  expect(
    frac,
    `at 750px the card is ${(frac * 100).toFixed(0)}% of its container (${Math.round(g!.cardW)}/${Math.round(g!.containerW)})`
  ).toBeLessThan(0.7);
  expect(g!.mediaH, 'media height at 750px').toBeLessThan(600);
});
