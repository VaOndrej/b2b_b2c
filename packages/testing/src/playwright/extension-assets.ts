import { expect, type Page } from '@playwright/test';

/** One stylesheet or script of a theme app extension, as the page links it, and what the browser got for it. */
export interface ExtensionAssetRead {
  url: string;
  /** HTTP status; 0 = the request itself failed. */
  status: number;
  /** The content type answered (a missing file comes back as Shopify's HTML 404 page). */
  type: string;
}

/**
 * Which of the page's extension assets did not arrive (pure, so it is tested without a browser): anything but a
 * 2xx answer, and an HTML answer (a 404 page) for a file that must be a stylesheet or a script.
 */
export function missingExtensionAssets(reads: readonly ExtensionAssetRead[]): ExtensionAssetRead[] {
  return reads.filter((r) => r.status < 200 || r.status > 299 || /text\/html/i.test(r.type));
}

/**
 * Every stylesheet and script a theme app extension put on the page must load.
 *
 * Why (won-discounts, 7 Oct 2026): the storefront printed the block's markup with the right classes, but all of
 * the extension's files answered 404 (a dev preview whose files were gone from the CDN) — the block showed as bare
 * text and its script never ran. Markup assertions pass in that state; only asking for the files catches it.
 *
 * `match` narrows it to one extension's files (default: every extension on the page).
 */
export async function assertExtensionAssetsLoaded(page: Page, opts: { match?: string } = {}) {
  const reads = await page.evaluate(async (match: string | null) => {
    // The CDN path of an extension's file; `/ext/cdn/` is the same path behind `shopify app dev`'s local proxy.
    const isExtensionAsset = (url: string) => /\/extensions\/[^/]+\/[^/]+\/assets\/[^/?#]+\.(css|js)(\?|#|$)/.test(url);
    const urls = new Set<string>();
    for (const el of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'))) urls.add(el.href);
    for (const el of Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))) urls.add(el.src);
    const wanted = Array.from(urls).filter((u) => isExtensionAsset(u) && (!match || u.includes(match)));
    return Promise.all(
      wanted.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          return { url, status: res.status, type: res.headers.get('content-type') || '' };
        } catch {
          return { url, status: 0, type: '' };
        }
      }),
    );
  }, opts.match ?? null);
  expect(reads.length, 'the page links at least one extension stylesheet or script').toBeGreaterThan(0);
  const missing = missingExtensionAssets(reads as ExtensionAssetRead[]).map((r) => `${r.status} ${r.url}`);
  expect(missing, 'extension files the storefront links but cannot load (the block shows unstyled and its script does not run)').toEqual([]);
}
