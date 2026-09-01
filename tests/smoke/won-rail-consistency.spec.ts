import { test, expect, type Page } from '@playwright/test';

// Rail consistency — every rail on a page must look like the same control.
//
// Reported as "I have several carousel blocks and the scroll bar is completely
// different for each one". It was: won-carousel drew an outlined light arrow on
// the theme background, won-hero-carousel drew a translucent dark arrow with a
// backdrop blur, and each section picked its own indicator (dots here, progress
// bar there, nothing in the grid). Three components, three ideas of the same
// widget, on one page.
//
// The fix is a theme-wide setting rather than per-section discipline, so this
// test asserts the OUTCOME a merchant sees, not the settings that produce it:
//
//   1. Arrows are visually identical across every rail (shape, size, colour).
//   2. When the global indicator is not "per_section", every rail uses the same
//      indicator, and it is the one the merchant chose.
//
// Class-name agnostic on purpose: it compares computed styles, so a future
// section that invents its own arrow CSS fails here instead of shipping.

type ArrowStyle = Record<string, string>;

// Shape and size must match on every rail, always — that is the "one control"
// the shopper should recognise.
const SHAPE_PROPS = ['borderTopLeftRadius', 'borderTopWidth', 'borderStyle', 'width', 'height'];
// Colour is allowed to adapt: a button sitting on the page needs different
// contrast from one sitting on top of a hero photo. That adaptation is the
// `auto` tone. If the merchant forces a tone, colour must match too.
const TONE_PROPS = ['backgroundColor', 'color'];
const ARROW_PROPS = [...SHAPE_PROPS, ...TONE_PROPS];

async function collect(page: Page) {
  await page.goto('/', { waitUntil: 'load' });
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1800));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
  });
  return page.evaluate((props: string[]) => {
    const shown = (el: Element | null) => {
      if (!el || (el as HTMLElement).hasAttribute('hidden')) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const arrows: { id: string; style: Record<string, string>; tone: string }[] = [];
    const indicators: { id: string; kind: string }[] = [];

    for (const box of document.querySelectorAll<HTMLElement>('[data-won-arrows]')) {
      if (!shown(box)) continue;
      const btn = box.querySelector('button');
      if (!btn) continue;
      const cs = getComputedStyle(btn);
      const style: Record<string, string> = {};
      for (const p of props) style[p] = (cs as unknown as Record<string, string>)[p];
      const sec = box.closest('[data-testid]') as HTMLElement | null;
      arrows.push({ id: sec?.dataset.testid || 'unknown', style, tone: box.dataset.wonRailTone || 'auto' });
    }

    for (const track of document.querySelectorAll<HTMLElement>('[data-won-track]')) {
      const root = track.closest('won-carousel') || track.parentElement!;
      const sec = track.closest('[data-testid]') as HTMLElement | null;
      // Only rails the SHOPPER can scroll need an indicator. A marquee overflows
      // by design and animates itself — it is a belt, not a rail, and giving it a
      // progress bar would be a control over something nobody drags.
      const cs = getComputedStyle(track);
      if (!/(auto|scroll)/.test(cs.overflowX)) continue;
      if (!(track.scrollWidth > track.clientWidth + 1)) continue;
      const kind = shown(root.querySelector('[data-won-dots]'))
        ? 'dots'
        : shown(root.querySelector('[data-won-progress]'))
          ? 'progress'
          : 'none';
      indicators.push({ id: sec?.dataset.testid || 'unknown', kind });
    }

    return {
      arrows,
      indicators,
      globalIndicator:
        (document.querySelector('[data-won-rail-indicator]') as HTMLElement | null)?.dataset.wonRailIndicator ||
        'per_section',
    };
  }, ARROW_PROPS);
}

function group(arrows: { id: string; style: ArrowStyle }[], props: string[]) {
  const g = new Map<string, string[]>();
  for (const a of arrows) {
    const k = props.map((p) => `${p}:${a.style[p]}`).join(' | ');
    g.set(k, [...(g.get(k) || []), a.id]);
  }
  return g;
}
const report = (g: Map<string, string[]>) =>
  [...g.entries()].map(([k, ids]) => `  ${ids.join(', ')}\n    ${k}`).join('\n');

test('arrow shape and size are identical on every rail', async ({ page }) => {
  const { arrows } = await collect(page);
  test.skip(arrows.length < 2, 'need at least two arrowed rails to compare');
  const g = group(arrows, SHAPE_PROPS);
  expect(
    g.size,
    `rail arrows have ${g.size} different shapes; the theme-wide shape setting should give exactly one:\n${report(g)}`
  ).toBe(1);
});

test('arrow colour is uniform unless the theme leaves it on auto', async ({ page }) => {
  const { arrows } = await collect(page);
  test.skip(arrows.length < 2, 'need at least two arrowed rails to compare');
  const tones = [...new Set(arrows.map((a) => a.tone))];
  test.skip(
    tones.includes('auto'),
    'arrow tone is "auto" — colour is meant to adapt to what sits behind the button'
  );
  const g = group(arrows, TONE_PROPS);
  expect(
    g.size,
    `arrow tone is forced to "${tones.join('/')}" but rails render ${g.size} different colours:\n${report(g)}`
  ).toBe(1);
});

test('every scrolling rail uses the indicator the theme asked for', async ({ page }) => {
  const { indicators, globalIndicator } = await collect(page);
  test.skip(indicators.length < 2, 'need at least two scrolling rails to compare');
  test.skip(
    globalIndicator === 'per_section',
    'theme is set to per-section indicators; nothing to unify'
  );

  const kinds = [...new Set(indicators.map((i) => i.kind))];
  expect(
    kinds,
    `global indicator is "${globalIndicator}" but rails use: ${indicators.map((i) => `${i.id}=${i.kind}`).join(', ')}`
  ).toEqual([globalIndicator]);
});
