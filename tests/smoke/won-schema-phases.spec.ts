import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// won-schema engine Phases 3–7 — static wiring.
//  F3 AggregateRating (won-rating on the PDP), F4 MerchantReturnPolicy (global),
//  F5 HowTo (won-dosage), F6 comparison extraction hardening, F7 site WebSite schema.
// All follow the established pattern: canonical @id merge, honesty guards, safe
// escaping, opt-in with a visible effect. Live JSON-LD parity runs later on a
// theme dev server.

const ROOT = process.cwd();
const BASE = join(ROOT, 'themes', 'won-base');
const read = (rel: string) => readFileSync(join(BASE, rel), 'utf8');

test('F3 AggregateRating: won-rating emits schema only on the PDP, gated', () => {
  const s = read('snippets/won-rating.liquid');
  expect(s).toContain('"@type":"AggregateRating"');
  expect(s).toMatch(/if schema and product != blank/);
  expect(s).toMatch(/product\.url \| prepend: shop\.url/);
  expect(s).toMatch(/replace: '<\\?\/'/);

  const vp = read('sections/won-variant-picker.liquid');
  expect(vp).toMatch(/render 'won-rating', product: product, schema: true/);
  expect(vp).toMatch(/"id": "show_rating"[\s\S]*?"default": true/);
});

test('F4 MerchantReturnPolicy: snippet + global settings + PDP wiring', () => {
  const s = read('snippets/won-policy-schema.liquid');
  expect(s).toContain('"@type":"MerchantReturnPolicy"');
  expect(s).toContain('hasMerchantReturnPolicy');
  expect(s).toMatch(/enabled and product != blank and return_days > 0 and country != blank/);
  expect(s).toMatch(/product\.url \| prepend: shop\.url/);

  const frag = JSON.parse(readFileSync(join(ROOT, 'themes', 'build', 'won-policy-settings.json'), 'utf8'));
  const ids = frag.settings.map((x: any) => x.id);
  expect(ids).toContain('won_return_enabled');
  expect(ids).toContain('won_return_days');
  expect(ids).toContain('won_return_country');

  const vp = read('sections/won-variant-picker.liquid');
  expect(vp).toMatch(/render 'won-policy-schema'[\s\S]*settings\.won_return_enabled/);

  // compose injects every won-*-settings.json fragment (not just the animation one).
  const compose = readFileSync(join(ROOT, 'themes', 'build', 'compose.mjs'), 'utf8');
  expect(compose).toContain('globalFragments');
  expect(compose).toContain('-settings\\.json');
});

test('F5 HowTo: won-howto-schema from won-dosage, gated', () => {
  const s = read('snippets/won-howto-schema.liquid');
  expect(s).toContain('"@type":"HowTo"');
  expect(s).toContain('"@type":"HowToStep"');
  expect(s).toMatch(/replace: '<\\?\/'/);

  const dosage = read('blocks/won-dosage.liquid');
  expect(dosage).toMatch(/render 'won-howto-schema'[\s\S]*enabled: s\.emit_schema/);
  expect(dosage).toMatch(/separator: ':'/);
  expect(dosage).toMatch(/"id": "emit_schema"[\s\S]*?"default": true/);
});

test('F6 comparison: yes/no cells carry a text equivalent for extraction', () => {
  const cmp = read('sections/won-comparison.liquid');
  // Each ✓/✗ SVG (aria-hidden) is paired with visually-hidden text so an AI /
  // screen reader reads the cell instead of an empty box.
  const yesNoHidden = cmp.match(/won-visually-hidden">\{\{ val \}\}/g) || [];
  expect(yesNoHidden.length).toBeGreaterThanOrEqual(2);
});

test('F7 site schema: WebSite + SearchAction, homepage only, wired in <head>', () => {
  const s = read('snippets/won-site-schema.liquid');
  expect(s).toContain('"@type":"WebSite"');
  expect(s).toContain('"@type":"SearchAction"');
  expect(s).toMatch(/request\.page_type == 'index'/);

  const compose = readFileSync(join(ROOT, 'themes', 'build', 'compose.mjs'), 'utf8');
  expect(compose).toMatch(/render 'won-site-schema'/);
});

test('F8 trust bridge: won-trust reads won.* metafields → badge + additionalProperty, gated', () => {
  const s = read('snippets/won-trust.liquid');
  expect(s).toMatch(/product\.metafields\.won\.units_sold_30d/);
  expect(s).toMatch(/product\.metafields\.won\.bestseller/);
  expect(s).toContain('won-trust-badge');
  expect(s).toContain('"additionalProperty"');
  expect(s).toMatch(/product\.url \| prepend: shop\.url/); // canonical @id merge
  expect(s).toMatch(/units > 0/); // no fake claim when nothing sold
  expect(s).toMatch(/replace: '<\\?\/'/);

  const vp = read('sections/won-variant-picker.liquid');
  expect(vp).toMatch(/render 'won-trust'[\s\S]*enabled: s\.show_bestseller/);
  expect(vp).toMatch(/"id": "show_bestseller"[\s\S]*?"default": true/);
  expect(vp).toContain('"id": "bestseller_label"');
});
