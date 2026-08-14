import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Won CTA + preset invariants (static, no server needed).
//
// DOCTRINE (theme-block-ux rules 5 & 6) — these encode audit fixes so they can't
// silently regress:
//   1. No CTA may hardcode target="_blank"; new-tab is always an explicit,
//      gated `*_new_tab` toggle. (Was: won-app-slot forced _blank unconditionally.)
//   2. Button markup comes from the shared snippets/won-button.liquid primitive,
//      not copy-pasted <a class="won-btn"> per section.
//   3. Every won-carousel preset that needs child blocks ships them, so inserting
//      it never yields an empty section. (Was: logo_marquee shipped zero blocks.)

const BASE = join(process.cwd(), 'themes', 'won-base');

function files(dir: string): { name: string; src: string }[] {
  const p = join(BASE, dir);
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .filter((f) => f.endsWith('.liquid'))
    .map((f) => ({ name: f, src: readFileSync(join(p, f), 'utf8') }));
}

// The sections/blocks rewired onto the shared button primitive.
const REWIRED = [
  'sections/won-band.liquid',
  'sections/won-app-slot.liquid',
  'sections/won-accordion.liquid',
  'sections/won-panels.liquid',
  'blocks/won-slide.liquid',
];

test('no won CTA hardcodes target="_blank" — new-tab is always gated', () => {
  const offenders: string[] = [];
  for (const dir of ['sections', 'blocks', 'snippets']) {
    for (const { name, src } of files(dir)) {
      src.split('\n').forEach((line, i) => {
        if (line.includes('target="_blank"') && !line.includes('new_tab')) {
          offenders.push(`${dir}/${name}:${i + 1}`);
        }
      });
    }
  }
  expect(offenders, `target="_blank" not gated by a *_new_tab toggle at: ${offenders.join(', ')}`).toEqual([]);
});

test('rewired sections render CTAs via won-button, not inline won-btn markup', () => {
  expect(existsSync(join(BASE, 'snippets/won-button.liquid'))).toBe(true);
  for (const rel of REWIRED) {
    const src = readFileSync(join(BASE, rel), 'utf8');
    expect(src, `${rel} should render via won-button`).toMatch(/render\s+'won-button'/);
    // No inline anchor button markup should remain (the primitive owns it).
    expect(src, `${rel} still has inline <a class="won-btn"> markup`).not.toMatch(/<a class="won-btn/);
  }
});

test('every won-carousel preset needing blocks ships them (no empty section on insert)', () => {
  const src = readFileSync(join(BASE, 'sections/won-carousel.liquid'), 'utf8');
  const schema = src.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/);
  expect(schema).toBeTruthy();
  const parsed = JSON.parse(schema![1]);
  const manualPresets = (parsed.presets || []).filter(
    (p: any) => p.settings && p.settings.source === 'manual',
  );
  // logo_marquee + content_slider both source manual → both must ship blocks.
  expect(manualPresets.length).toBeGreaterThan(0);
  for (const p of manualPresets) {
    expect(
      Array.isArray(p.blocks) && p.blocks.length > 0,
      `preset "${p.name}" is source:manual but ships no blocks → empty on insert`,
    ).toBe(true);
  }
});
