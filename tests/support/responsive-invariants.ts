import { expect, type Page, type Locator } from '@playwright/test';

// Owned thresholds — change here, deliberately, never per-spec.
const TAP_MIN = 44;              // px, min interactive tap target (iOS/WCAG)
const CENTER_TOL = 4;            // px, allowed active-card center offset in `single`
const SINGLE_VISIBLE_MIN = 0.95; // active card must be >=95% inside the viewport in `single`
const PEEK_MIN = 0.08, PEEK_MAX = 0.35; // next card visible fraction in `peek`
const OVERFLOW_TOL = 1;          // px, sub-pixel rounding slack

/** Page-level laws that hold for EVERY component at a mobile width. */
export async function assertResponsiveSane(page: Page) {
  // 1. The page itself must not scroll horizontally.
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollW: d.scrollWidth, clientW: d.clientWidth };
  });
  expect(
    overflow.scrollW,
    `page scrolls horizontally: scrollWidth ${overflow.scrollW} > viewport ${overflow.clientW}`,
  ).toBeLessThanOrEqual(overflow.clientW + OVERFLOW_TOL);

  // 2. No element is wider than the viewport (the usual overflow culprit) —
  //    EXCEPT content that lives inside an intentional horizontal scroller
  //    (carousel track, data-table `overflow-x:auto` wrapper). Those are wider
  //    than the viewport by design and scroll internally; check 1 already proves
  //    the PAGE itself doesn't scroll. Flagging them is a false positive.
  const wide = await page.evaluate((tol) => {
    const vw = document.documentElement.clientWidth;
    const inHScroller = (el: HTMLElement) => {
      let p = el.parentElement;
      while (p) {
        const ox = getComputedStyle(p).overflowX;
        // auto/scroll = an intentional scroller; hidden/clip = a marquee/clip box.
        // Either way the wide child is contained and cannot push the PAGE wider
        // (check 1 already proves the page itself doesn't scroll), so it's not
        // the overflow bug this heuristic hunts for.
        const clips = ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip';
        if (clips && p.scrollWidth > p.clientWidth + tol) return true;
        p = p.parentElement;
      }
      return false;
    };
    // Entirely off-screen boxes (a visually-hidden skip-to-content link parked at
    // left:-99999px, whose long text can exceed the viewport width) cannot push
    // the PAGE wider — check 1 already proves it doesn't scroll — so a wide box
    // that lives completely outside the viewport is a false positive, not overflow.
    const onScreen = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.right > tol && r.left < vw - tol;
    };
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getClientRects().length && el.getBoundingClientRect().width > vw + tol)
      .filter((el) => onScreen(el))
      .filter((el) => !inHScroller(el))
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
  }, OVERFLOW_TOL);
  expect(wide, `elements wider than viewport: ${wide.join(', ')}`).toEqual([]);

  // 3. Control-like interactive elements meet the tap-target minimum — measured
  //    as the EFFECTIVE interactive target (WCAG 2.5.5), not the bare element box.
  const small = await page.evaluate((min) => {
    const controls = 'button, [role="button"], input:not([type="hidden"]), select, summary';
    const box = (el: Element) => el.getBoundingClientRect();
    const union = (a: DOMRect, b: DOMRect) => {
      const left = Math.min(a.left, b.left), top = Math.min(a.top, b.top);
      const right = Math.max(a.right, b.right), bottom = Math.max(a.bottom, b.bottom);
      return { left, top, right, bottom, width: right - left, height: bottom - top } as DOMRect;
    };
    // A checkbox/radio's tap target is the input AND its label together — a tiny
    // native input with a large clickable label meets the target size.
    const effective = (el: HTMLElement): DOMRect => {
      let r = box(el);
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (el.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
        const labels = (el as HTMLInputElement).labels ? [...(el as HTMLInputElement).labels!] : [];
        const wrap = el.closest('label');
        if (wrap && !labels.includes(wrap)) labels.push(wrap);
        for (const lab of labels) {
          const lr = box(lab);
          if (lr.width > 0 && lr.height > 0) r = union(r, lr);
        }
      }
      return r;
    };
    // Only enforce 44px on links that are genuinely control-like (button/tile).
    // A plain inline or short-height text link is navigation prose, which WCAG
    // 2.5.5 explicitly exempts — flagging it is a false positive.
    const isButtonLike = (el: Element) => {
      if (el.tagName !== 'A' || !el.getAttribute('href')) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'inline' || cs.display === 'contents') return false;
      if ((el.getAttribute('role') || '') === 'button') return true;
      const hasBg = !!cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      const hasBorder = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0;
      const looksBtn = /\b(btn|button|tile|card|pill|chip)\b/i.test((el.className || '').toString());
      const tallEnough = box(el).height >= 30; // deliberately block-height CTA
      return hasBg || hasBorder || looksBtn || tallEnough;
    };
    return [...document.querySelectorAll<HTMLElement>(`${controls}, a[href]`)]
      .filter((el) => el.matches(controls) || isButtonLike(el))
      .filter((el) => {
        const r = effective(el);
        return r.width > 0 && r.height > 0 && (r.height < min || r.width < min);
      })
      .slice(0, 8)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
  }, TAP_MIN);
  expect(small, `control tap targets < ${TAP_MIN}px: ${small.join(', ')}`).toEqual([]);
}

/**
 * A section must not render a centered heading over left-aligned body content
 * (and vice-versa). That "floating centered title over a left column" is the
 * exact look merchants reject. The contract: within one section, the heading's
 * horizontal alignment matches the alignment of its body text.
 *
 * We measure the FIRST text line of the heading and of each body text leaf
 * (via Range client rects — the element box is full-width and would hide the
 * real glyph position), classify each as start / center / end relative to the
 * section container, and fail if the heading is centered while the body is
 * predominantly start-aligned (or the reverse).
 */
export async function assertHeadingBodyAlignment(page: Page) {
  const mismatches = await page.evaluate((tol) => {
    // First rendered line's rect — reveals true alignment; a full-width block box does not.
    const firstLineRect = (el: Element): DOMRect | null => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      (range as any).detach?.();
      if (!rects.length) return null;
      rects.sort((a, b) => a.top - b.top || a.left - b.left);
      return rects[0];
    };
    const classify = (rect: DOMRect, host: DOMRect): 'start' | 'center' | 'end' => {
      const leftGap = rect.left - host.left;
      const rightGap = host.right - rect.right;
      const centerOff = Math.abs((rect.left + rect.right) / 2 - (host.left + host.right) / 2);
      // Edge-priority: a line that touches the left (right) edge is start (end)
      // aligned regardless of its far edge — this is what stops a full-width
      // left-aligned paragraph (leftGap≈0, rightGap≈0) reading as "centered".
      if (leftGap <= tol) return 'start';
      if (rightGap <= tol) return 'end';
      // Real gaps on both sides → genuinely centered only if balanced.
      if (centerOff <= tol && Math.abs(leftGap - rightGap) <= tol * 2) return 'center';
      return leftGap <= rightGap ? 'start' : 'end';
    };
    const out: string[] = [];
    const sections = [
      ...document.querySelectorAll<HTMLElement>('.won-section, [data-testid$="-section"]'),
    ];
    for (const section of sections) {
      const heading = section.querySelector<HTMLElement>('.won-heading, h1, h2');
      if (!heading || !heading.getClientRects().length) continue;
      const host = section.querySelector<HTMLElement>('.won-container') || section;
      const hostRect = host.getBoundingClientRect();
      if (hostRect.width < 40) continue;
      const hRect = firstLineRect(heading);
      if (!hRect) continue;
      const headingAlign = classify(hRect, hostRect);
      const headWrap =
        heading.closest('.won-grid__head, .won-panels__head, .won-cmp__heading') || heading;
      // Genuine body TEXT: paragraphs, list items, definitions, FAQ questions.
      // Deliberately NOT any table cell — a data table has its own internal
      // alignment and, when it lives in a horizontal scroller, a cell centered
      // in its column reads as `start` relative to the section container (false
      // positive). Table sections are judged by their prose, not their cells.
      const leaves = [
        ...section.querySelectorAll<HTMLElement>('p, li, dd, .won-panels__q'),
      ]
        .filter((el) => !headWrap.contains(el) && el !== heading)
        .filter((el) => (el.textContent || '').trim().length > 1)
        .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      const aligns = leaves
        .map((el) => {
          const r = firstLineRect(el);
          return r ? classify(r, hostRect) : null;
        })
        .filter((a): a is 'start' | 'center' | 'end' => a !== null);
      if (aligns.length < 2) continue; // too little body text to judge
      const starts = aligns.filter((a) => a === 'start').length;
      const centers = aligns.filter((a) => a === 'center').length;
      const label =
        section.getAttribute('data-testid') ||
        (section.className || '').split(' ').find((c) => c.startsWith('won-')) ||
        section.tagName.toLowerCase();
      // A centered section title floating over left-aligned body text (or the
      // reverse) is the rejected look. Two-line floor keeps stray lines quiet.
      if (headingAlign === 'center' && starts >= 2) {
        out.push(`${label}: heading centered but ${starts} body lines left-aligned`);
      } else if (headingAlign === 'start' && centers >= 2) {
        out.push(`${label}: heading left-aligned but ${centers} body lines centered`);
      }
    }
    return out;
  }, 6);
  expect(
    mismatches,
    `section heading/body alignment mismatch (centered title over left content, or vice-versa):\n  ${mismatches.join('\n  ')}`,
  ).toEqual([]);
}

type CarouselMode = 'single' | 'peek' | 'multiple';

/**
 * Geometry of a horizontal snap-scroller against its declared mode.
 * `container` = the scroll viewport; `items` = the slides/cards.
 */
export async function assertCarousel(
  page: Page,
  container: Locator,
  items: Locator,
  opts: { mode: CarouselMode; visibleItems?: number },
) {
  const box = await container.boundingBox();
  if (!box) throw new Error('carousel container has no box (not visible?)');
  const cards = await items.all();
  expect(cards.length, 'carousel has no items').toBeGreaterThan(0);

  const rects = await Promise.all(cards.map((c) => c.boundingBox()));
  const visibleFrac = (r: { x: number; width: number }) => {
    const left = Math.max(r.x, box.x);
    const right = Math.min(r.x + r.width, box.x + box.width);
    return Math.max(0, right - left) / r.width;
  };

  if (opts.mode === 'single') {
    const fully = rects.filter((r) => r && visibleFrac(r) >= SINGLE_VISIBLE_MIN);
    expect(fully.length, 'no card is fully visible in `single` mode').toBeGreaterThanOrEqual(1);
    const active = fully[0]!;
    const carouselCenter = box.x + box.width / 2;
    const cardCenter = active.x + active.width / 2;
    expect(
      Math.abs(carouselCenter - cardCenter),
      `active card off-center by ${Math.round(Math.abs(carouselCenter - cardCenter))}px`,
    ).toBeLessThanOrEqual(CENTER_TOL);
  } else if (opts.mode === 'peek') {
    const fully = rects.filter((r) => r && visibleFrac(r) >= SINGLE_VISIBLE_MIN);
    expect(fully.length, 'no full card in `peek` mode').toBeGreaterThanOrEqual(1);
    const peeks = rects.filter((r) => r && visibleFrac(r) > PEEK_MIN && visibleFrac(r) < SINGLE_VISIBLE_MIN);
    expect(peeks.length, 'no partially-peeking next card in `peek` mode').toBeGreaterThanOrEqual(1);
    for (const r of peeks) {
      const f = visibleFrac(r!);
      expect(f, `peek fraction ${f.toFixed(2)} outside [${PEEK_MIN}, ${PEEK_MAX}]`).toBeLessThanOrEqual(PEEK_MAX);
    }
  } else {
    const fully = rects.filter((r) => r && visibleFrac(r) >= SINGLE_VISIBLE_MIN).length;
    expect(fully, `expected ${opts.visibleItems} cards per row`).toBe(opts.visibleItems);
  }
}
