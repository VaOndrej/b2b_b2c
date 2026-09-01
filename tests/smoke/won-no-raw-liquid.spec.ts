import { test, expect } from '@playwright/test';

// Raw Liquid delimiters must never reach the rendered page.
//
// Why this exists: refactoring four sections with a scripted text replace left a
// stray `-%}` after an `{% endcomment %}` in two of them. Liquid printed it as
// plain text at the top of the section, so `-%}` was literally on the storefront —
// and it survived `shopify theme check`, the Dev MCP `validate_theme` AND 241 green
// tests, because every one of those checks the SOURCE or a behaviour, and none of
// them reads the delivered HTML for what a shopper would see.
//
// A dangling delimiter is always a bug and never intentional, which makes it the
// cheapest possible invariant: scan the served markup of every demo page.

const PAGES = ['/', '/collections/automated-collection', '/pages/contact'];

// `{{` / `{%` opening pairs are the tell. A closing `%}` or `}}` alone would also
// be a leak, but they appear inside legitimate inline JSON/JS often enough that
// matching them alone is noisy — a leaked opener always comes with its body.
const LEAKS = [/\{\{[^}]/, /\{%-?\s/, /-%\}/, /%\}/];

test.describe('no raw Liquid in the rendered page', () => {
  for (const path of PAGES) {
    test(`${path} renders no Liquid delimiters`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'load' });
      test.skip(!res || res.status() >= 400, `${path} is not part of this demo`);

      // Read the DELIVERED markup, not innerText: a delimiter can sit inside an
      // attribute or between tags where text extraction would hide it.
      const html = await page.content();

      // Inline <script> is allowed to contain braces (JSON-LD, JS objects), and
      // Horizon ships template literals in its modules. Strip scripts/styles
      // first so the scan is about CONTENT, where a delimiter is unambiguous.
      const body = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<template[\s\S]*?<\/template>/gi, '');

      const found: string[] = [];
      for (const re of LEAKS) {
        const m = body.match(new RegExp(re.source, 'g'));
        if (!m) continue;
        // Report with context so the offending section is obvious from the failure.
        const first = body.indexOf(m[0]);
        found.push(`${JSON.stringify(m[0])} ×${m.length} — kontext: …${body.slice(Math.max(0, first - 70), first + 40).replace(/\s+/g, ' ')}…`);
      }

      expect(found, `na ${path} propadl syrový Liquid do HTML:\n  ${found.join('\n  ')}`).toEqual([]);
    });
  }
});
