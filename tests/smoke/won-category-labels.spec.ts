import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The composed locale must not present two identically-labelled picker groups.
// Won's five categories live under `won.categories`; Horizon's under
// `categories`. A collision means the merchant sees two groups with the same
// name and cannot tell which one carries Won's rules.
//
// No server needed — this reads the composed output on disk.

const LOCALES = ['cs.schema.json', 'en.default.schema.json'];

for (const file of LOCALES) {
  test(`composed ${file} has no duplicate picker category labels`, () => {
    const raw = readFileSync(join('themes/dist/horizon-dev/locales', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[}\]])/g, '$1');
    const data = JSON.parse(raw);

    const wonLabels: string[] = Object.values(data.won?.categories ?? {});
    const horizonLabels: string[] = Object.values(data.categories ?? {});

    expect(wonLabels.length).toBeGreaterThan(0);
    expect(horizonLabels.length).toBeGreaterThan(0);

    const collisions = wonLabels.filter((l) => horizonLabels.includes(l));
    expect(collisions, `labels shared by Won and Horizon: ${collisions.join(', ')}`).toEqual([]);
  });
}
