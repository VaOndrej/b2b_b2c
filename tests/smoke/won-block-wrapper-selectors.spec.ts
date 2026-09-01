import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Dead CSS guard: a theme block is NEVER a direct child of its section container.
//
// Shopify wraps every theme block it renders through `{% content_for 'blocks' %}`
// in its own element:
//
//     .won-hero__track  >  div.shopify-block  >  article.won-slide
//
// So any rule written as `.won-hero__track > .won-slide { … }` matches nothing.
// It is not a subtle bug — the CSS is simply inert, and it stays inert silently
// because nothing errors and the property just keeps its inherited value.
//
// This shipped five times in won-tokens.css alone (hero radius reset, hero
// min-height, peek radius, …), and surfaced as "the rounded corners on the hero
// look wrong": the full-width reset `border-radius: 0` never applied, so the
// slide kept the 14px from its own corner_radius token.
//
// Static — reads the COMPOSED theme, needs no server.

const DIST = join(process.cwd(), 'themes', 'dist', 'horizon-dev');

// Every won-* file in blocks/ is a theme block and therefore always wrapped.
function blockClassNames(): string[] {
  return readdirSync(join(DIST, 'blocks'))
    .filter((f) => f.startsWith('won-') && f.endsWith('.liquid'))
    .map((f) => f.replace(/\.liquid$/, ''));
}

function cssSources(): { file: string; css: string }[] {
  const out: { file: string; css: string }[] = [];
  out.push({ file: 'assets/won-tokens.css', css: readFileSync(join(DIST, 'assets', 'won-tokens.css'), 'utf8') });
  for (const dir of ['sections', 'blocks', 'snippets']) {
    for (const f of readdirSync(join(DIST, dir)).filter((n) => n.startsWith('won-') && n.endsWith('.liquid'))) {
      const src = readFileSync(join(DIST, dir, f), 'utf8');
      for (const m of src.matchAll(/{%\s*stylesheet\s*%}([\s\S]*?){%\s*endstylesheet\s*%}/g)) {
        out.push({ file: `${dir}/${f}`, css: m[1] });
      }
    }
  }
  return out;
}

test('no CSS selector treats a theme block as a direct child', () => {
  const blocks = blockClassNames();
  expect(blocks.length, 'there should be won-* theme blocks to guard').toBeGreaterThan(0);

  // `> .won-slide` / `>.won-tile` — optional whitespace, block class must end at a
  // word boundary so `.won-slide__body` (an element INSIDE the block, correctly a
  // direct child of it) is not flagged.
  const offenders: string[] = [];
  for (const { file, css } of cssSources()) {
    const lines = css.split('\n');
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith('/*') || line.trimStart().startsWith('*')) return;
      for (const b of blocks) {
        const re = new RegExp(`>\\s*\\.${b}(?![\\w-])`);
        if (re.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`);
      }
    });
  }

  expect(
    offenders,
    `These selectors can never match — Shopify inserts div.shopify-block between a section container and its theme block. Use a descendant selector (drop the ">") instead:\n${offenders.join('\n')}`
  ).toEqual([]);
});
