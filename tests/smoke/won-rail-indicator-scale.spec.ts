import { test, expect, type Page } from '@playwright/test';

// The scroll indicator is a SCROLLBAR, so it has to be measured against the thing
// it describes. A 240px cap left it as a short dash under the first card with a
// wide dead gap before the arrows — you could not read "how far along am I" off
// something that short, which is the only job it has.
//
// Generic on purpose: it walks every rail that shows an indicator and asserts the
// geometry, so a future rail that invents its own width fails here. The hero was
// initially exempted as "overlay chrome"; it had exactly the same stub problem and
// is now held to the same rule.

async function settle(page: Page) {
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1800));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
  });
}

test('the scroll indicator spans the free width of its control row', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await settle(page);

  const rails = await page.evaluate(() => {
    const shown = (el: Element | null) => {
      if (!el || (el as HTMLElement).hasAttribute('hidden')) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.display !== 'none';
    };
    const out: { id: string; row: number; bar: number; arrows: number; overlay: boolean }[] = [];
    document.querySelectorAll('.won-rail__controls').forEach((row) => {
      const bar = row.querySelector('[data-won-progress]');
      if (!shown(bar)) return;
      const arrows = row.querySelector('[data-won-arrows]');
      out.push({
        id: (row.closest('[data-testid]') as HTMLElement | null)?.dataset.testid ?? 'rail',
        row: row.getBoundingClientRect().width,
        bar: bar!.getBoundingClientRect().width,
        arrows: shown(arrows) ? arrows!.getBoundingClientRect().width : 0,
        overlay: false,
      });
    });
    return out;
  });

  test.skip(rails.length === 0, 'no rail shows an indicator at this width');

  for (const r of rails) {
    if (r.overlay) continue;
    // Everything the arrows and one gap do not use belongs to the indicator.
    // 40px of slack covers the row gap and sub-pixel rounding without letting a
    // re-introduced fixed cap through.
    const free = r.row - r.arrows;
    expect(
      r.bar,
      `${r.id}: indicator is ${Math.round(r.bar)}px inside a ${Math.round(r.row)}px row (${Math.round(r.arrows)}px of arrows)`
    ).toBeGreaterThan(free - 40);
  }
});

test('the indicator thumb is proportional to how much is on screen', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await settle(page);

  const rails = await page.evaluate(() => {
    const out: { id: string; track: number; thumb: number; visibleFrac: number }[] = [];
    document.querySelectorAll('won-carousel').forEach((rail) => {
      const box = rail.querySelector('[data-won-progress]') as HTMLElement | null;
      const thumb = rail.querySelector('[data-won-progress-bar]') as HTMLElement | null;
      const track = rail.querySelector('[data-won-track]') as HTMLElement | null;
      if (!box || !thumb || !track || box.hasAttribute('hidden')) return;
      if (!(track.scrollWidth > track.clientWidth + 1)) return;
      out.push({
        id: (rail.closest('[data-testid]') as HTMLElement | null)?.dataset.testid ?? 'rail',
        track: box.getBoundingClientRect().width,
        thumb: thumb.getBoundingClientRect().width,
        visibleFrac: track.clientWidth / track.scrollWidth,
      });
    });
    return out;
  });

  test.skip(rails.length === 0, 'no overflowing rail with an indicator here');

  for (const r of rails) {
    // The thumb IS the answer to "how much of this rail am I seeing" — it has to
    // follow the track's width, not sit at some leftover pixel size.
    const expected = r.track * r.visibleFrac;
    expect(
      Math.abs(r.thumb - expected),
      `${r.id}: thumb ${Math.round(r.thumb)}px vs expected ${Math.round(expected)}px on a ${Math.round(r.track)}px track`
    ).toBeLessThanOrEqual(Math.max(26, expected * 0.15));
  }
});

test('stepping the quantity replays the sheen', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.evaluate(() => fetch('/cart/clear.js', { method: 'POST' }));
  await page.reload({ waitUntil: 'load' });
  await settle(page);

  const card = page.locator('.won-pcard:has([data-won-stepper])').first();
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  await page.waitForTimeout(600);

  const pill = card.locator('.won-pcard__add--stepper');
  const mode = await pill.evaluate((el) => el.className.match(/won-fx--sheen-([a-z]+)/)?.[1] ?? 'off');
  test.skip(mode === 'off', 'theme has the sheen turned off');

  const add = card.locator('[data-won-add]');
  const minus = card.locator('[data-won-step="-1"]');

  await add.click();
  await expect(card.locator('span[data-won-qty]')).toHaveText('1');
  // Let the hover-arrival sweep finish so what we record next can only have come
  // from the click itself.
  await page.waitForTimeout(1600);

  const record = () =>
    pill.evaluate((el) => {
      (window as unknown as { __sheen: string[] }).__sheen = [];
      el.addEventListener('animationstart', (e) => {
        (window as unknown as { __sheen: string[] }).__sheen.push((e as AnimationEvent).animationName);
      });
    });
  const seen = () => page.evaluate(() => (window as unknown as { __sheen: string[] }).__sheen ?? []);

  await record();
  await add.click();
  await expect(card.locator('span[data-won-qty]')).toHaveText('2');
  await expect.poll(seen, { message: 'the "+" must confirm with a sweep', timeout: 4000 }).toEqual(expect.arrayContaining([expect.stringMatching(/^won-sheen/)]));

  await record();
  await minus.click();
  await expect(card.locator('span[data-won-qty]')).toHaveText('1');
  await expect.poll(seen, { message: 'the "−" must confirm with a sweep', timeout: 4000 }).toEqual(expect.arrayContaining([expect.stringMatching(/^won-sheen/)]));
});
