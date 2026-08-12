import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// won-product-trust — a drop-in PDP trust block (option 1): makes the F3/F4/F8
// signals render on ANY product page, not only won-variant-picker ones. Thin
// wrapper over the shared snippets; static wiring guards that reuse.

const BASE = join(process.cwd(), 'themes', 'won-base');
const read = (rel: string) => readFileSync(join(BASE, rel), 'utf8');

test('won-product-trust block reuses the shared snippets (no duplicated logic)', () => {
  const b = read('blocks/won-product-trust.liquid');
  expect(b).toContain('{% doc %}');
  expect(b).toContain('{% schema %}');
  expect(b).toMatch(/render 'won-rating', product: product, schema: true/);
  expect(b).toMatch(/render 'won-trust'[\s\S]*enabled: true, product: product/);
  expect(b).toMatch(/render 'won-policy-schema'[\s\S]*settings\.won_return_enabled/);
  // Addable in the picker + gated toggles with a merchant-editable badge label.
  expect(b).toContain('"presets"');
  expect(b).toMatch(/"id": "show_rating"[\s\S]*?"default": true/);
  expect(b).toMatch(/"id": "show_bestseller"[\s\S]*?"default": true/);
  expect(b).toContain('"id": "bestseller_label"');
});

test('name locale key resolves in both languages', () => {
  for (const f of ['locales/cs.schema.json', 'locales/en.default.schema.json']) {
    const j = JSON.parse(read(f));
    expect(j.won.names.product_trust, `${f} won.names.product_trust`).toBeTruthy();
  }
});
