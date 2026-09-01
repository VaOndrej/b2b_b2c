import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The theme-wide "Rail indicator" select offers four values — per section / dots /
// progress bar / none — and a merchant is entitled to assume all four work on
// EVERY rail. They did not: `dots` was wired in won-carousel and won-hero-carousel
// but nowhere else, so picking it left the grid rail and the tabbed rail with no
// indicator at all. Four copies of the same resolution, two of them drifted.
//
// This is a SOURCE guard (no server) because the fault is a mode nobody looks at:
// a browser test only ever exercises whichever value the demo happens to be set
// to, so the broken three-quarters of the matrix stays invisible. It reads the
// composed theme, not won-base, so it also covers whatever compose injects.

const DIST = join(process.cwd(), 'themes/dist/horizon-dev');
const SECTIONS = join(DIST, 'sections');
// The one place a rail may delegate all of this to.
const SHARED = 'won-rail-controls';

type Rail = { file: string; src: string };

function railSections(): Rail[] {
  if (!existsSync(SECTIONS)) return [];
  return readdirSync(SECTIONS)
    .filter((f) => f.startsWith('won-') && f.endsWith('.liquid'))
    .map((f) => ({ file: f, src: readFileSync(join(SECTIONS, f), 'utf8') }))
    // A rail is anything that hands the shared slider engine a track to scroll.
    .filter((r) => r.src.includes('data-won-track'));
}

test('the composed theme has rails to audit', () => {
  expect(railSections().length, 'no won section renders a scroll track').toBeGreaterThan(0);
});

test('every rail can render every indicator the theme-wide setting offers', () => {
  const broken: string[] = [];

  for (const rail of railSections()) {
    // Delegating to the shared controls snippet is the whole point — it is the
    // single implementation, so a section that renders it is compliant by
    // construction and nothing below needs checking.
    if (rail.src.includes(SHARED)) continue;

    const emits = {
      dots: rail.src.includes('data-won-dots'),
      progress: rail.src.includes('data-won-progress'),
    };
    const missing = Object.entries(emits)
      .filter(([, present]) => !present)
      .map(([kind]) => kind);

    if (missing.length) {
      broken.push(
        `${rail.file}: hand-rolls its controls but never emits ${missing.join(' + ')} — ` +
          `picking that indicator leaves this rail with none`
      );
    }
  }

  expect(
    broken,
    `rails that cannot honour every value of won_rail_indicator:\n  ${broken.join('\n  ')}`
  ).toEqual([]);
});

test('no rail hand-rolls the indicator resolution any more', () => {
  // Four copies of "read the global, fall back to the section" is exactly how two
  // of them ended up not knowing about `dots`. One implementation or none.
  const offenders = railSections()
    .filter((r) => !r.src.includes(SHARED))
    // Only real resolution counts: `data-won-rail-indicator` on the host element
    // is a reporting hook the consistency spec reads, not a second decision.
    .filter((r) => /assign\s+want_(dots|progress|arrows)/.test(r.src))
    .map((r) => r.file);

  expect(
    offenders,
    `these sections resolve won_rail_indicator themselves instead of rendering '${SHARED}':\n  ${offenders.join('\n  ')}`
  ).toEqual([]);
});

test('the shared controls snippet handles all four indicator values', () => {
  const snippet = join(DIST, 'snippets', `${SHARED}.liquid`);
  expect(existsSync(snippet), `${SHARED}.liquid must exist in the composed theme`).toBe(true);
  const src = readFileSync(snippet, 'utf8');

  for (const value of ['per_section', 'dots', 'progress', 'none']) {
    expect(src, `${SHARED} never mentions the "${value}" indicator`).toContain(value);
  }
  expect(src, `${SHARED} must be able to render dots`).toContain('data-won-dots');
  expect(src, `${SHARED} must be able to render a progress bar`).toContain('data-won-progress');
  expect(src, `${SHARED} must be able to render arrows`).toContain('data-won-arrows');
});
