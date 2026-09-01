import { test, expect } from '@playwright/test';

/**
 * Looping = wrap around, not an endless belt.
 *
 * The first implementation cloned the end slides so the rail could scroll forever
 * in one direction. It cost three defects (a swallowed first click, a dead end at
 * the seam, and a progress bar that teleported to the middle on every wrap) and it
 * made the rail feel like content was still arriving: the slide you were about to
 * reach was a clone whose media had not been asked for yet.
 *
 * The model now is the obvious one: 0 / 1 / 2 / 3, and next on 3 goes back to 0.
 * Nothing is cloned, so the track is finite, the progress bar measures something
 * real again, and every slide on the rail is a slide the page already has.
 */

const HERO = '.won-hero__carousel[data-won-loop]';

/**
 * The ends of a rail cannot be read off scrollLeft: a centre-snap peek layout
 * rests at 20px, not 0, and its last slide snaps short of the maximum. Which
 * slide is CENTRED is exact at every layout — the component reasons the same way.
 */
async function state(page: import('@playwright/test').Page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const track = el.querySelector('[data-won-track]') as HTMLElement;
    const kids = [...track.children];
    const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
    let index = 0;
    let best = Infinity;
    kids.forEach((k, i) => {
      const b = k.getBoundingClientRect();
      const d = Math.abs((b.left + b.right) / 2 - mid);
      if (d < best) { best = d; index = i; }
    });
    return {
      sl: Math.round(track.scrollLeft),
      max: Math.round(track.scrollWidth - track.clientWidth),
      children: kids.length,
      index,
      clones: track.querySelectorAll('[data-won-clone]').length,
    };
  }, HERO);
}

async function present(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'load' });
  const hero = page.locator(HERO).first();
  if ((await hero.count()) === 0) return false;
  await hero.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  return true;
}

test('a looping rail wraps to the start instead of dead-ending', async ({ page }) => {
  if (!(await present(page))) test.skip(true, 'no looping hero on the homepage');

  const first = await state(page);
  expect(first.index, 'the rail should rest on its first slide').toBe(0);

  const walk: number[] = [];
  let reachedEnd = false;
  for (let i = 0; i < first.children + 2; i++) {
    await page.locator(`${HERO} [data-won-next]`).first().click();
    await page.waitForTimeout(950);
    const s = await state(page);
    walk.push(s.index);
    if (s.index === first.children - 1) reachedEnd = true;
    // Coming back to the first slide AFTER having reached the last one is the wrap.
    if (reachedEnd && s.index === 0) {
      expect(s.index).toBe(0);
      return;
    }
  }
  expect(
    walk,
    `the rail never came back to the first slide after reaching the last. ` +
      `Centred slide after each click: ${walk.join(' -> ')}`,
  ).toContain(0);
});

test('a looping rail wraps backwards from the start to the end', async ({ page }) => {
  if (!(await present(page))) test.skip(true, 'no looping hero on the homepage');

  const before = await state(page);
  expect(before.index, 'the rail should rest on its first slide').toBe(0);

  await page.locator(`${HERO} [data-won-prev]`).first().click();
  await page.waitForTimeout(1200);
  const after = await state(page);
  expect(
    after.index,
    `previous from the first slide should land on the last (${before.children - 1}), landed on ${after.index}`,
  ).toBe(before.children - 1);
});

test('a looping rail clones nothing — every slide on the rail is a real one', async ({ page }) => {
  if (!(await present(page))) test.skip(true, 'no looping hero on the homepage');
  const s = await state(page);
  expect(
    s.clones,
    `${s.clones} cloned slides on the rail — a wrap-around loop needs none, and a clone is ` +
      `media the page fetches for a card the shopper never actually reaches`,
  ).toBe(0);
});

test('a looping rail keeps its progress bar', async ({ page }) => {
  if (!(await present(page))) test.skip(true, 'no looping hero on the homepage');

  const bar = await page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const p = el.querySelector('[data-won-progress]') as HTMLElement | null;
    if (!p) return { present: false, visible: false };
    const b = p.getBoundingClientRect();
    return { present: true, visible: !p.hidden && b.width > 1 && b.height > 0 };
  }, HERO);

  if (!bar.present) test.skip(true, 'the theme indicator is not set to the progress bar');
  expect(
    bar.visible,
    'the track is finite again, so the bar measures something real and must be shown',
  ).toBe(true);
});

test('slides next to the one on screen have their media requested already', async ({ page }) => {
  if (!(await present(page))) test.skip(true, 'no looping hero on the homepage');

  const lazy = await page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const track = el.querySelector('[data-won-track]')!;
    const kids = [...track.children] as HTMLElement[];
    const mid = track.getBoundingClientRect().left + (track as HTMLElement).clientWidth / 2;
    let active = 0;
    let best = Infinity;
    kids.forEach((k, i) => {
      const b = k.getBoundingClientRect();
      const d = Math.abs((b.left + b.right) / 2 - mid);
      if (d < best) { best = d; active = i; }
    });
    const near = kids.slice(Math.max(0, active - 1), active + 3);
    const still: string[] = [];
    near.forEach((k, i) => {
      k.querySelectorAll('img').forEach((img) => {
        if ((img as HTMLImageElement).loading === 'lazy') still.push(`slide ${active - 1 + i}`);
      });
    });
    return still;
  }, HERO);

  expect(
    lazy,
    `slides the shopper is one click away from still have lazy media — that is the "something ` +
      `is missing" flash when the rail advances: ${lazy.join(', ')}`,
  ).toEqual([]);
});
