import { test, expect, type Page } from '@playwright/test';

// Rail affordance — a GENERIC invariant over every horizontal scroller.
//
// Why generic: the bug this exists for ("Doplňky pro každý den" scrolls on a
// narrow screen but shows no arrows) was not a typo, it was a gap in a
// condition — the whole controls block sat behind `layout == 'slider'`, so a
// grid that *becomes* a rail below 750px inherited no controls at all. A test
// that enumerated known sections would not have caught it, and would not catch
// the next section that grows a rail. So this walks the DOM and asks the only
// question that matters:
//
//   1. If a track actually overflows, can the user move it?
//      (a visible arrow / dot / progress affordance, and arrows that really scroll)
//   2. If it does not overflow, are we showing dead controls?
//
// Runs at three widths because a rail's overflow is width-dependent by nature.

const PAGES = ['/', '/collections/automated-collection'];
const WIDTHS = [390, 700, 1440];

type Rail = {
  id: string;
  overflows: boolean;
  hasArrows: boolean;
  hasDots: boolean;
  hasProgress: boolean;
};

async function railsOn(page: Page, path: string): Promise<Rail[]> {
  await page.goto(path, { waitUntil: 'load' });
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1800));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
  });
  return page.evaluate(() => {
    const visible = (el: Element | null) => {
      if (!el) return false;
      if ((el as HTMLElement).hasAttribute('hidden')) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    // A "rail" is ANY element the shopper can scroll sideways. Found purely by
    // computed style — no marker attribute, no class name.
    //
    // The first version of this test looked for `[data-won-track]`, which sounds
    // behavioural but is not: it is an opt-in marker, so a section that scrolls
    // WITHOUT emitting it was invisible to the test. won-tabbed-rail was exactly
    // that — `overflow-x: auto`, no marker, no controls, and this spec reported
    // green. A test that only sees the sections that remembered to raise their
    // hand cannot catch the section that forgot.
    const all = [...document.querySelectorAll<HTMLElement>('body *')];
    return all
      .filter((el) => {
        const cs = getComputedStyle(el);
        if (!/(auto|scroll)/.test(cs.overflowX)) return false;
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;   // collapsed / inactive tab panel
        return el.scrollWidth > el.clientWidth + 1;
      })
      .map((t, i) => {
        // Controls may sit beside the track (won-carousel) or further out in the
        // section, so widen the search until something plausible contains both.
        const root =
          (t.closest('won-carousel') as HTMLElement | null) ||
          (t.closest('[data-testid]') as HTMLElement | null) ||
          t.parentElement!;
        const sec = t.closest('[data-testid]') as HTMLElement | null;
        return {
          id: `${sec?.dataset.testid || 'unknown'}#${i}`,
          overflows: true,
          hasArrows: visible(root.querySelector('[data-won-arrows]')),
          hasDots: visible(root.querySelector('[data-won-dots]')),
          hasProgress: visible(root.querySelector('[data-won-progress]')),
        };
      });
  });
}

for (const path of PAGES) {
  for (const width of WIDTHS) {
    test(`rails on ${path} @${width}px expose controls exactly when they overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const rails = await railsOn(page, path);
      test.skip(rails.length === 0, `no rails on ${path}`);

      const mute = rails.filter(
        (r) => r.overflows && !r.hasArrows && !r.hasDots && !r.hasProgress
      );
      expect(
        mute.map((r) => r.id),
        `these rails scroll sideways but offer the shopper no way to move them (no arrows, dots or progress bar)`
      ).toEqual([]);

      const dead = rails.filter(
        (r) => !r.overflows && (r.hasArrows || r.hasDots || r.hasProgress)
      );
      expect(
        dead.map((r) => r.id),
        `these rails fit on screen yet still render navigation — a dead control the shopper can click with no effect`
      ).toEqual([]);
    });
  }
}

test('every arrow pair actually scrolls its rail', async ({ page }, testInfo) => {
  const width = testInfo.project.use.viewport?.width ?? 1440;
  await page.setViewportSize({ width, height: 900 });
  await railsOn(page, '/');

  const arrowed = page.locator('won-carousel:has([data-won-arrows]:not([hidden]))');
  const n = await arrowed.count();
  test.skip(n === 0, 'no arrowed rail at this width');

  for (let i = 0; i < n; i++) {
    const rail = arrowed.nth(i);
    const track = rail.locator('[data-won-track]');
    if (!(await track.count())) continue;
    await rail.scrollIntoViewIfNeeded();
    const before = await track.evaluate((t) => (t as HTMLElement).scrollLeft);
    const next = rail.locator('[data-won-next]');
    if (!(await next.count()) || !(await next.first().isEnabled())) continue;
    await next.first().click();
    await page.waitForTimeout(600);
    const after = await track.evaluate((t) => (t as HTMLElement).scrollLeft);
    expect(
      Math.abs(after - before),
      `rail #${i}: clicking the next arrow moved the track by ${Math.abs(after - before)}px`
    ).toBeGreaterThan(20);
  }
});
