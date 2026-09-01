import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'themes/dist/horizon-dev');

/** Every authored Liquid file in the composed theme. */
function themeFiles(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = [];
  for (const dir of ['sections', 'blocks', 'snippets', 'assets']) {
    const abs = join(DIST, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((x) => x.endsWith('.liquid') || x.endsWith('.css'))) {
      out.push({ file: `${dir}/${f}`, src: readFileSync(join(abs, f), 'utf8') });
    }
  }
  return out;
}

/**
 * Rail arrows stay readable in every tone the merchant can pick.
 *
 * `won_rail_arrow_tone` offers auto / surface / overlay. `auto` resolves per
 * context — surface on a page rail, overlay over media — and is the default, which
 * is exactly why the other two were never exercised: the existing consistency spec
 * skips itself with "arrow tone is auto".
 *
 * Measured on the demo homepage: with `overlay`, the arrow is a white glyph on
 * rgba(0,0,0,0.28). Over a photo that is fine. Over the PAGE it composites to light
 * grey and the glyph lands at 1.99:1 — below the 3:1 WCAG AA floor for a user
 * interface component (EshopAudit A11Y-001). A merchant who picks "overlay"
 * theme-wide gets unreadable arrows on every rail that is not over media.
 *
 * The invariant is written per tone CLASS rather than per setting value, so it
 * holds for any future tone and needs no theme-setting round trip: the class is
 * swapped onto a real button and the real cascade is measured.
 */

// WCAG 2.1 SC 1.4.11 — non-text contrast for a user interface component.
const UI_MIN = 3;
const TONES = ['surface', 'overlay'];

test('rail arrows on the page meet AA contrast in every tone', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const readings = await page.evaluate((tones) => {
    const parse = (c: string) => {
      const m = (c.match(/[\d.]+/g) || ['0', '0', '0']).map(Number);
      return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
    };
    type C = { r: number; g: number; b: number; a: number };
    const over = (fg: C, bg: C): C => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const lum = (c: C) => {
      const f = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a: C, b: C) => {
      const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    };
    const opaqueBehind = (el: Element): C => {
      let n = el.parentElement;
      while (n) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.a === 1) return c;
        n = n.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };

    const out: { sec: string; tone: string; ratio: number }[] = [];
    for (const row of document.querySelectorAll('.won-rail__controls')) {
      const arrows = row.querySelector('[data-won-arrows]');
      // A rail whose arrows float over MEDIA is judged against the image, which
      // this method cannot read — the page colour behind it is not what the
      // shopper sees. Those are out of scope here, deliberately.
      if (!arrows || arrows.classList.contains('won-hero__arrows')) continue;
      const btn = arrows.querySelector('button');
      if (!btn) continue;
      const sec = (row.closest('.shopify-section')?.id || '?').replace(/^shopify-section-template--\d+__/, '');
      const behind = opaqueBehind(btn);
      const original = [...btn.classList];
      for (const tone of tones) {
        btn.classList.remove(...tones.map((t) => `won-rail__arrow--${t}`));
        btn.classList.add(`won-rail__arrow--${tone}`);
        const cs = getComputedStyle(btn);
        const plate = over(parse(cs.backgroundColor), behind);
        const glyph = over(parse(cs.color), plate);
        out.push({ sec, tone, ratio: Math.round(ratio(glyph, plate) * 100) / 100 });
      }
      btn.className = original.join(' ');
    }
    return out;
  }, TONES);

  expect(readings.length, 'no page rail exposed arrows — the test measured nothing').toBeGreaterThan(0);

  const failures = readings.filter((r) => r.ratio < UI_MIN);
  expect(
    failures,
    `rail arrows below the ${UI_MIN}:1 AA floor for a UI component — a merchant who picks this ` +
      `tone gets a control nobody can see:\n` +
      failures.map((f) => `  ${f.sec} · tone "${f.tone}" · ${f.ratio}:1`).join('\n'),
  ).toEqual([]);
});

/**
 * An arrow with no plate has to carry its own legibility.
 *
 * `arrow_style: minimal` drops the background AND the border on purpose — the
 * merchant picked it because they do not want a plate. On a page rail that is
 * fine: the glyph inherits the dark page foreground. Over MEDIA it is not — the
 * overlay tone paints the glyph white and there is now nothing behind it, so on a
 * light photo the control disappears completely.
 *
 * Adding a scrim would contradict the setting the merchant chose. A text-shadow
 * keeps the glyph readable over any image and costs nothing on the page, where the
 * surface tone applies instead.
 *
 * Stated over the CASCADE rather than over one class pair, so a future plateless
 * style is covered: whenever an arrow ends up with no background and no border,
 * it must bring a shadow.
 */
test('a rail arrow with no plate carries a text shadow over media', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const readings = await page.evaluate(() => {
    const STYLES = ['pill', 'square', 'soft', 'minimal'];
    const TONES = ['surface', 'overlay'];
    const transparent = (c: string) => {
      const m = (c.match(/[\d.]+/g) || []).map(Number);
      return m.length === 4 && m[3] === 0;
    };
    const out: { style: string; tone: string; plateless: boolean; shadow: string }[] = [];
    const btn = document.querySelector<HTMLElement>('.won-rail__controls [data-won-arrows] button');
    if (!btn) return out;
    const original = btn.className;
    for (const style of STYLES) {
      for (const tone of TONES) {
        btn.classList.remove(...STYLES.map((s) => `won-rail__arrow--${s}`));
        btn.classList.remove(...TONES.map((t) => `won-rail__arrow--${t}`));
        btn.classList.add(`won-rail__arrow--${style}`, `won-rail__arrow--${tone}`);
        const cs = getComputedStyle(btn);
        out.push({
          style,
          tone,
          plateless: transparent(cs.backgroundColor) && transparent(cs.borderTopColor),
          shadow: cs.textShadow,
        });
      }
    }
    btn.className = original;
    return out;
  });

  expect(readings.length, 'no rail arrow to inspect').toBeGreaterThan(0);

  // Only the over-media tone can strand a light glyph on an unknown backdrop.
  const naked = readings.filter((r) => r.plateless && r.tone === 'overlay' && (!r.shadow || r.shadow === 'none'));
  expect(
    naked,
    `arrow styles that render no plate over media and no text shadow either — on a light ` +
      `photo the control is invisible:\n` +
      naked.map((n) => `  style "${n.style}" · tone "${n.tone}"`).join('\n'),
  ).toEqual([]);
});

/**
 * Rail chrome must never cover a control it does not own.
 *
 * The hero's control row is absolutely positioned over the media, and the slide's
 * own CTA sits in the same corner of that media. Measured on the demo homepage:
 * the row covered 64 % of the "Koupit" button at 1440 px and 82 % at 390 px — on a
 * phone the hero's primary buy CTA was almost entirely underneath the arrows. The
 * arrows have `pointer-events: auto`, so the part they cover is not just hidden,
 * it is unclickable.
 *
 * Stated over ANY rail and ANY interactive element rather than over the hero, so a
 * new section that floats chrome over content fails here on its own.
 */
test('rail chrome never covers an interactive element', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const collisions = await page.evaluate(() => {
    const vis = (el: Element) => {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return b.width > 1 && b.height > 1 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
    };
    const out: { sec: string; label: string; covered: number }[] = [];
    for (const row of document.querySelectorAll('.won-rail__controls')) {
      if (!vis(row)) continue;
      const section = row.closest('.shopify-section');
      if (!section) continue;
      const sec = section.id.replace(/^shopify-section-template--\d+__/, '');
      const r = row.getBoundingClientRect();
      for (const el of section.querySelectorAll('a[href], button:not([disabled])')) {
        if (row.contains(el) || !vis(el)) continue;
        const e = el.getBoundingClientRect();
        const w = Math.min(r.right, e.right) - Math.max(r.left, e.left);
        const h = Math.min(r.bottom, e.bottom) - Math.max(r.top, e.top);
        // 1px of touching is rounding, not a collision.
        if (w <= 1 || h <= 1) continue;
        out.push({
          sec,
          label: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24),
          covered: Math.round(((w * h) / (e.width * e.height)) * 100),
        });
      }
    }
    return out;
  });

  expect(
    collisions,
    `rail controls sit on top of controls they do not own — the covered part is unclickable:\n` +
      collisions.map((c) => `  ${c.sec}: "${c.label}" covered ${c.covered} %`).join('\n'),
  ).toEqual([]);
});

/**
 * Every rail puts its chrome in the same place: a row UNDER the rail.
 *
 * The hero was the exception — its row floated over the media, which produced two
 * separate defects in a row. First it covered the slide's own "Koupit" (64 % at
 * 1440, 82 % at 390, and the arrows take pointer events, so the covered part was
 * unclickable). Then, positioned against the container rather than the centred
 * card, the bar started 214 px inside the left peek neighbour and the arrows
 * parked on the right one.
 *
 * Both were symptoms of the same thing: chrome overlaid on content it does not
 * own. Bestsellers, the tabbed rail and the grid rail never had either problem
 * because their row sits below the cards. So the hero joins them, and the
 * "hero" chrome variant is gone rather than kept as a second way to do this.
 */
test('rail chrome sits below the rail it belongs to, never on top of it', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  const readings = await page.evaluate(() => {
    const out: { sec: string; trackBottom: number; controlsTop: number; overlap: number }[] = [];
    for (const row of document.querySelectorAll('.won-rail__controls')) {
      const r = row.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const section = row.closest('.shopify-section');
      const track = section?.querySelector('[data-won-track]');
      if (!track) continue;
      const t = track.getBoundingClientRect();
      out.push({
        sec: (section!.id || '?').replace(/^shopify-section-template--\d+__/, ''),
        trackBottom: Math.round(t.bottom),
        controlsTop: Math.round(r.top),
        overlap: Math.round(t.bottom - r.top),
      });
    }
    return out;
  });

  expect(readings.length, 'no rail chrome on the homepage — nothing measured').toBeGreaterThan(0);

  // 1px of touching is rounding; anything more means the row is ON the rail.
  const onTop = readings.filter((r) => r.overlap > 1);
  expect(
    onTop,
    `rail chrome overlaps the rail instead of sitting under it:\n` +
      onTop.map((r) => `  ${r.sec}: track ends at ${r.trackBottom}, controls start at ${r.controlsTop} (${r.overlap}px inside)`).join('\n'),
  ).toEqual([]);
});

test('no rail ships a second, overlay-style chrome variant', () => {
  const files = themeFiles();
  const strays = files
    .filter((f) => /won-hero__(controls|arrows|arrow|progress|dots)/.test(f.src))
    .map((f) => f.file);
  expect(
    strays,
    `a hero-specific chrome variant is back — one rail control implementation, one look:\n${strays.join('\n')}`,
  ).toEqual([]);
});
