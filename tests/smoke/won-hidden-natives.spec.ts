import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A native section is "hidden from the picker" when compose step 2c strips its
// `presets` array. The file must still exist and still render — templates that
// already reference it keep working. This guards both halves.
//
// No server needed — this reads the composed output on disk.
//
const HIDDEN = ['product-list', 'featured-blog-posts'];

for (const name of HIDDEN) {
  test(`${name} is hidden from the section picker but still renders`, () => {
    const src = readFileSync(join('themes/dist/horizon-dev/sections', `${name}.liquid`), 'utf8');

    expect(src.length, `${name}.liquid must still exist and be non-empty`).toBeGreaterThan(0);
    expect(src, `${name} must keep its schema`).toContain('{% schema %}');
    expect(src, `${name} must have no presets left`).not.toContain('"presets"');
  });
}

// The sections kept ON PURPOSE. Hiding one of these would be a silent scope
// creep, so the list is asserted from the other direction too: they must all
// still offer presets. See the spec's triage table for why each one stays.
const KEPT = [
  'quick-order-list',
  'featured-product',
  'featured-product-information',
  'custom-liquid',
  'divider',
];

for (const name of KEPT) {
  test(`${name} stays visible in the picker`, () => {
    const src = readFileSync(join('themes/dist/horizon-dev/sections', `${name}.liquid`), 'utf8');
    expect(src, `${name} is deliberately kept native — it must keep its presets`).toContain('"presets"');
  });
}
