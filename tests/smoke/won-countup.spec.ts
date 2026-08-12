import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Won count-up (Dynamic numbers) — static wiring + behavioural parser tests.
//
// The count-up util reads a statistic's server-rendered text and animates the
// number into its final form on scroll-in. These tests lock two things:
//  1. won-stats is wired to opt in (data attribute + script tag + settings), so
//     the toggle is never a dead control (see won-settings-coverage.spec.ts).
//  2. the smart parser preserves prefix/suffix/format and refuses ambiguous
//     values (24/7) — the behaviour the merchant was promised.

const BASE = join(process.cwd(), 'themes', 'won-base');
const STATS = join(BASE, 'sections', 'won-stats.liquid');
const UTIL = join(BASE, 'assets', 'won-count-up.js');

test('won-stats opts into count-up: data attr, script tag, settings', () => {
  const src = readFileSync(STATS, 'utf8');
  // <dt> carries the count-up hook + inherited/overridden duration, gated on the toggle.
  expect(src).toMatch(/data-won-countup data-won-countup-duration="\{\{ countup_duration \}\}"/);
  expect(src).toContain("{% if s.animate_values %}");
  // Script only loads when the section actually animates.
  expect(src).toMatch(/if s\.animate_values[\s\S]*won-count-up\.js' \| asset_url \| script_tag/);
  // Both settings are declared (so the coverage audit sees them used).
  expect(src).toContain('"id": "animate_values"');
  expect(src).toContain('"id": "animate_duration"');
  // Inherit/override: 0 falls back to the theme-wide global default.
  expect(src).toContain('settings.won_countup_default_duration');
});

test('global animation fragment + compose step exist', () => {
  const fragment = join(process.cwd(), 'themes', 'build', 'won-animation-settings.json');
  expect(existsSync(fragment)).toBe(true);
  const obj = JSON.parse(readFileSync(fragment, 'utf8'));
  expect(obj.settings.some((s: any) => s.id === 'won_countup_default_duration')).toBe(true);
  const compose = readFileSync(join(process.cwd(), 'themes', 'build', 'compose.mjs'), 'utf8');
  // compose 2e injects every won-*-settings.json fragment (generalised in Phase 4);
  // the animation fragment is picked up by that glob.
  expect(compose).toContain('globalFragments');
  expect(compose).toContain('-settings\\.json');
  expect(compose).toContain('settings_schema.json');
});

// --- behavioural parser: load the browser IIFE in a Node sandbox. The util
// guards its DOM code behind `typeof document`, and exposes parseNumber/
// formatValue via module.exports — so evaluating it here is safe and DOM-free. ---
function loadUtil(): {
  parseNumber: (t: string) => any;
  formatValue: (v: number, meta: any) => string;
} {
  const code = readFileSync(UTIL, 'utf8');
  const mod: any = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', code)(mod, mod.exports);
  return mod.exports;
}
const { parseNumber, formatValue } = loadUtil();

test('parser keeps prefix/suffix and format; refuses ambiguous values', () => {
  // Space-grouped integer with a "+" suffix.
  const a = parseNumber('10 000+');
  expect(a.target).toBe(10000);
  expect(a.suffix).toBe('+');
  expect(a.decimals).toBe(0);
  expect(formatValue(a.target, a)).toMatch(/10.000\+/); // grouping char is a (no-break) space

  // Percentage.
  const b = parseNumber('98 %');
  expect(b.target).toBe(98);
  expect(b.suffix).toBe(' %');

  // Currency prefix + decimal + unit suffix.
  const c = parseNumber('€1.2M');
  expect(c.prefix).toBe('€');
  expect(c.target).toBeCloseTo(1.2);
  expect(c.decimals).toBe(1);
  expect(c.suffix).toBe('M');
  expect(formatValue(c.target, c)).toBe('€1.2M');

  // English thousands separator.
  const d = parseNumber('10,000');
  expect(d.target).toBe(10000);

  // Czech decimal comma (rating).
  const e = parseNumber('4,9★');
  expect(e.target).toBeCloseTo(4.9);
  expect(e.decimals).toBe(1);

  // Ambiguous — a second number in the string → left static (not animated).
  expect(parseNumber('24/7')).toBeNull();
  expect(parseNumber('3 z 5')).toBeNull();

  // No number at all.
  expect(parseNumber('Zdarma')).toBeNull();
});

test('formatValue restores exact final text at the end of the run', () => {
  const meta = parseNumber('1 234,5 kg');
  expect(meta.target).toBeCloseTo(1234.5);
  // Mid-run value re-formats with the same grouping + decimal separators.
  const mid = formatValue(1000, meta);
  expect(mid).toContain('kg');
});
