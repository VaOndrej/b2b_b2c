import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * A new global theme setting must reach a deploy repo that already has a
 * settings_data.json.
 *
 * `config/settings_data.json` is owner:merchant — publish seeds it only when it is
 * ABSENT, because it is what the theme editor writes back. That rule is right, and
 * it has a hole: a setting the theme adds LATER never appears in an existing store's
 * settings_data, and a schema `default` only applies to keys that are missing from
 * the file the storefront actually reads. Shipping `won_unit_price_rules` this way
 * would have silently switched unit prices off on every existing client store.
 *
 * The contract: publish adds the won globals a store does not have yet, with the
 * default the schema declares, and NEVER touches a value the merchant already set.
 * Generic on purpose — it reads whatever `won_*` settings the build declares, so the
 * next global setting is covered without editing this file.
 */

const BUILD = join(process.cwd(), 'themes/dist/horizon-dev');

/** Horizon prefixes settings_data.json with a comment; JSON starts at the first brace. */
function parseSettings(raw: string) {
  return JSON.parse(raw.slice(raw.indexOf('{')));
}

/** Every won_* global the build's schema declares with a default. */
function declaredWonGlobals(): Record<string, unknown> {
  const schema = JSON.parse(readFileSync(join(BUILD, 'config/settings_schema.json'), 'utf8'));
  const out: Record<string, unknown> = {};
  for (const group of schema) {
    for (const s of group?.settings ?? []) {
      if (typeof s?.id === 'string' && s.id.startsWith('won_') && s.default !== undefined) {
        out[s.id] = s.default;
      }
    }
  }
  return out;
}

test('publish seeds new won globals into an existing settings_data, without overwriting merchant values', () => {
  expect(existsSync(BUILD), 'composed theme not found — run node themes/build/compose.mjs horizon').toBe(true);
  const declared = declaredWonGlobals();
  expect(Object.keys(declared).length, 'the build declares no won_* globals — nothing to prove').toBeGreaterThan(0);

  // Pick one to pin as a pre-existing merchant value, and one that must be added.
  const ids = Object.keys(declared);
  const [pinned, ...rest] = ids;
  expect(rest.length, 'need at least two won globals to test both directions').toBeGreaterThan(0);

  const repo = mkdtempSync(join(tmpdir(), 'won-publish-'));
  try {
    // A deploy repo that already has a settings_data.json — the merchant's file.
    mkdirSync(join(repo, 'config'), { recursive: true });
    const merchantValue = '__merchant_choice__';
    writeFileSync(
      join(repo, 'config/settings_data.json'),
      '/* merchant file */\n' + JSON.stringify({ current: { [pinned]: merchantValue, color_schemes: {} } }, null, 2) + '\n',
    );

    execFileSync('node', ['themes/build/publish.mjs', '--repo', repo, '--build', BUILD, '--apply'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
    });

    const after = parseSettings(readFileSync(join(repo, 'config/settings_data.json'), 'utf8'));

    expect(
      after.current[pinned],
      `publish overwrote a value the merchant already set (${pinned})`,
    ).toBe(merchantValue);

    const missing = rest.filter((id) => !(id in after.current));
    expect(
      missing,
      `won globals the build declares but publish never put in an existing settings_data ` +
        `(a store upgrading would silently lose the feature): ${JSON.stringify(missing)}`,
    ).toEqual([]);

    for (const id of rest) {
      expect(after.current[id], `${id} was seeded with the wrong value`).toEqual(declared[id]);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
