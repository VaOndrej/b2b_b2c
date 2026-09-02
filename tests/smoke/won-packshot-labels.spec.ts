import { test, expect } from '@playwright/test';
import { PACKS, PRODUCT_ART } from '../../themes/demo/tools/scenes/pack-catalog.mjs';

/**
 * A packshot prints a product's name on it, so it can belong to exactly one product.
 *
 * The demo store reused nine packs across seventeen products. That is not a
 * stylistic shortcut — the art has the name SET IN IT, so "Pre-Workout Energy"
 * showed a bottle that says "Elektrolyty", "Denní Multivitamín" showed one that
 * says "D3 + K2", and "Ashwagandha" showed a pouch that says "Greens". A demo
 * whose product photos contradict its product names cannot be shown to a client.
 *
 * Two invariants over the catalogue, so a seventeenth product added tomorrow
 * cannot quietly borrow a sixteenth product's face:
 *   1. no packshot is pinned to more than one product;
 *   2. every word printed on the pack appears in the title of the product wearing it.
 *
 * Build-level on purpose: this is a data contract between render-packs.mjs and
 * seed-store-images.mjs, and it has to hold before anything is uploaded anywhere.
 */

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const packKey = (file: string) => file.replace(/\.(png|jpg|svg)$/i, '');

test('no packshot is shared by two products', async () => {
  const byArt = new Map<string, string[]>();
  for (const [title, file] of Object.entries(PRODUCT_ART)) {
    byArt.set(file as string, [...(byArt.get(file as string) ?? []), title]);
  }

  const shared = [...byArt.entries()].filter(([, titles]) => titles.length > 1);
  expect(
    shared.map(([file, titles]) => `${file} -> ${titles.join(' | ')}`),
    'a packshot carries one product name in its artwork, so it cannot serve two products',
  ).toEqual([]);
});

test('every packshot exists and prints the name of the product wearing it', async () => {
  const missing: string[] = [];
  const mislabelled: string[] = [];

  for (const [title, file] of Object.entries(PRODUCT_ART)) {
    const key = packKey(file as string);
    const pack = (PACKS as Record<string, { name: string; sub?: string }>)[key];
    if (!pack) {
      missing.push(`${title} -> ${file} (no such pack in PACKS)`);
      continue;
    }
    const haystack = norm(title);
    const words = pack.name.split(/[^\p{L}\p{N}]+/u).filter((w) => norm(w).length >= 2);
    const orphan = words.filter((w) => !haystack.includes(norm(w)));
    if (orphan.length) {
      mislabelled.push(`"${title}" wears a pack that reads "${pack.name}" (${file})`);
    }
  }

  expect(missing, 'a product is mapped to art that render-packs.mjs does not draw').toEqual([]);
  expect(
    mislabelled,
    'the shopper reads the name printed on the pack, not the file name — these contradict the product title',
  ).toEqual([]);
});
