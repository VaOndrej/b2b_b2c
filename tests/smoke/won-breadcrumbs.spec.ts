import { test, expect } from '@playwright/test';

/**
 * Breadcrumbs — three rules point at one missing component.
 *
 * NAV-001 (breadcrumbs on every category and PDP), PDP-008 (mandatory on a PDP for
 * navigation and SEO) and SD-004 (BreadcrumbList markup for the SERP). The theme
 * had no breadcrumb anywhere: not in won-base, not in the Horizon base, and
 * won-page-header — which the block→rule map credits with this role — never
 * mentions one and is in no template.
 *
 * A shopper who lands on a PDP from search has no way up into the category, and
 * the SERP loses the path line under the title.
 *
 * Asserted as a contract, not a markup shape: a labelled navigation landmark, real
 * anchors (SEO-001 — never buttons or click handlers), a trail that starts at the
 * shop root, and a BreadcrumbList that agrees with what is on screen.
 */

const PAGES = [
  { name: 'PDP', path: '/products/the-collection-snowboard-liquid' },
  { name: 'collection', path: '/collections/automated-collection' },
];

for (const pg of PAGES) {
  test(`${pg.name} shows a breadcrumb trail`, async ({ page }) => {
    await page.goto(pg.path, { waitUntil: 'load' });
    await page.waitForTimeout(900);

    const trail = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label*="readcrumb" i], [class*="breadcrumb"]');
      if (!nav) return null;
      const links = [...nav.querySelectorAll('a')].map((a) => ({
        href: a.getAttribute('href') || '',
        text: (a.textContent || '').trim().slice(0, 30),
        isAnchor: a.tagName === 'A' && !!a.getAttribute('href'),
      }));
      const clickHandlers = nav.querySelectorAll('button, [onclick], [role="button"]').length;
      const r = (nav as HTMLElement).getBoundingClientRect();
      return { links, clickHandlers, visible: r.width > 1 && r.height > 1 };
    });

    expect(trail, `${pg.name} has no breadcrumb navigation at all (NAV-001 / PDP-008)`).not.toBeNull();
    expect(trail!.visible, 'the breadcrumb renders but is not visible').toBe(true);
    expect(
      trail!.links.length,
      `a trail needs at least the shop root and one step: got ${JSON.stringify(trail!.links)}`,
    ).toBeGreaterThanOrEqual(1);
    expect(trail!.links.every((l) => l.isAnchor), 'every crumb must be a real <a href> (SEO-001)').toBe(true);
    expect(
      trail!.links[0].href,
      `the trail must start at the shop root, starts at "${trail!.links[0].href}"`,
    ).toMatch(/^\/(\?.*)?$/);
    expect(trail!.clickHandlers, 'a crumb must not be a button or a click handler (SEO-001)').toBe(0);
  });

  test(`${pg.name} emits BreadcrumbList matching what is on screen`, async ({ page }) => {
    await page.goto(pg.path, { waitUntil: 'load' });
    await page.waitForTimeout(900);

    const data = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label*="readcrumb" i], [class*="breadcrumb"]');
      const shown = nav ? [...nav.querySelectorAll('a, [aria-current]')].length : 0;
      const nodes: any[] = [];
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const parsed = JSON.parse(s.textContent || '{}');
          for (const n of Array.isArray(parsed) ? parsed : [parsed]) {
            if (n && n['@type'] === 'BreadcrumbList') nodes.push(n);
          }
        } catch {
          /* a malformed node is another guard's problem */
        }
      }
      return { shown, nodes: nodes.length, items: nodes[0]?.itemListElement?.length ?? 0 };
    });

    expect(data.nodes, 'no BreadcrumbList JSON-LD on the page (SD-004)').toBe(1);
    expect(
      data.items,
      `BreadcrumbList lists ${data.items} items but ${data.shown} crumbs are on screen — ` +
        `markup that disagrees with the page is worse than none`,
    ).toBe(data.shown);
  });
}
