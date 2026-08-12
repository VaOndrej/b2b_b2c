import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Won product schema (Phase 2 of the won-schema engine) — static wiring.
// Spec/nutrition rows become Product.additionalProperty (PropertyValue) so AI +
// search read the product's facts. Same self-emit pattern as Phase 1 (a section
// can't read child block settings through content_for): each table block emits a
// supplementary Product node keyed by the canonical product URL (@id) so engines
// merge it onto the product. Emits nothing off a PDP / disabled / no valid pairs.

const BASE = join(process.cwd(), 'themes', 'won-base');
const read = (rel: string) => readFileSync(join(BASE, rel), 'utf8');

test('won-product-schema snippet: Product + additionalProperty, canonical @id, guard, escaping', () => {
  const s = read('snippets/won-product-schema.liquid');
  expect(s).toContain('{% doc %}');
  expect(s).toContain('"@type":"Product"');
  expect(s).toContain('"additionalProperty"');
  expect(s).toContain('"@type":"PropertyValue"');
  // Keyed by the canonical product URL so nodes merge onto the product.
  expect(s).toMatch(/product\.url \| prepend: shop\.url/);
  expect(s).toContain('"@id"');
  // Only on a real product page.
  expect(s).toMatch(/product != blank/);
  // Both modes handled.
  expect(s).toMatch(/mode == 'kv'/);
  expect(s).toMatch(/mode == 'lines'/);
  // Safe JSON encoding + </script> neutralisation.
  expect(s).toMatch(/\| json/);
  expect(s).toMatch(/replace: '<\\?\/'/);
});

test('spec + nutrition tables self-emit with the right separator, gated by toggle', () => {
  const param = read('blocks/won-param-table.liquid');
  expect(param).toMatch(/render 'won-product-schema'[\s\S]*enabled: s\.emit_schema/);
  expect(param).toMatch(/separator: ':'/);

  const nutri = read('blocks/won-nutrition-table.liquid');
  expect(nutri).toMatch(/render 'won-product-schema'[\s\S]*enabled: s\.emit_schema/);
  expect(nutri).toMatch(/separator: '\|'/);
});

test('emit_schema toggle present and ON by default on both blocks', () => {
  for (const f of ['blocks/won-param-table.liquid', 'blocks/won-nutrition-table.liquid']) {
    const src = read(f);
    expect(src).toMatch(/"id": "emit_schema"[\s\S]*?"default": true/);
  }
});
