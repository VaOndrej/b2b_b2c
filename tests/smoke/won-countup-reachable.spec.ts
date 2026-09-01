import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A global theme setting must have a consumer the merchant can actually reach.
 *
 * `won_countup_default_duration` lives in the theme settings under Animation, so a
 * merchant sees it and can change it. Its only consumer was `won-stats.liquid` —
 * a section whose presets were stripped when `won-grid` absorbed it, so it is not
 * in the "Add section" picker at all. The live stats path (won-grid, source:
 * stats, presets `stats_row` / `trust_band`) rendered plain numbers and never read
 * the setting. Every value of that control was therefore unreachable, and the spec
 * that "covers" count-up asserts wiring on the deprecated file, so it stayed green
 * the whole time.
 *
 * The invariant generalises: a `won_*` global must be read by at least one section
 * that ships a preset. Deprecated files do not count — a merchant cannot insert them.
 */

const DIST = join(process.cwd(), 'themes/dist/horizon-dev');

type Section = { file: string; src: string; reachable: boolean };

function sections(): Section[] {
  const dir = join(DIST, 'sections');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('won-') && f.endsWith('.liquid'))
    .map((f) => {
      const src = readFileSync(join(dir, f), 'utf8');
      const schema = src.match(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/);
      let reachable = false;
      if (schema) {
        try {
          const parsed = JSON.parse(schema[1]);
          reachable = Array.isArray(parsed.presets) && parsed.presets.length > 0;
        } catch {
          /* a schema we cannot parse is judged by the other guards */
        }
      }
      return { file: f, src, reachable };
    });
}

/** Every won_* global the theme declares to the merchant. */
function declaredGlobals(): string[] {
  const f = join(DIST, 'config/settings_schema.json');
  if (!existsSync(f)) return [];
  const out: string[] = [];
  for (const group of JSON.parse(readFileSync(f, 'utf8'))) {
    for (const s of group?.settings ?? []) {
      if (typeof s?.id === 'string' && s.id.startsWith('won_')) out.push(s.id);
    }
  }
  return out;
}

test('every global theme setting is read by a section a merchant can insert', () => {
  const all = sections();
  expect(all.length, 'composed theme not found — run node themes/build/compose.mjs horizon').toBeGreaterThan(0);

  // Snippets are shared machinery: a global read there reaches whoever renders it,
  // so they count as reachable consumers too.
  const snippetDir = join(DIST, 'snippets');
  const snippets = existsSync(snippetDir)
    ? readdirSync(snippetDir).filter((f) => f.endsWith('.liquid')).map((f) => readFileSync(join(snippetDir, f), 'utf8'))
    : [];

  const reachable = [...all.filter((s) => s.reachable).map((s) => s.src), ...snippets];
  const orphaned = declaredGlobals().filter((id) => !reachable.some((src) => src.includes(id)));

  expect(
    orphaned,
    `globals the merchant can change but nothing reachable reads — the only consumers are ` +
      `deprecated sections that are not in the "Add section" picker:\n` +
      orphaned.map((o) => `  ${o}`).join('\n'),
  ).toEqual([]);
});
