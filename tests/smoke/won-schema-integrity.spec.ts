import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Layer 2 of the E2E matrix — the schemas themselves.
 *
 * Walking 27 sections x ~50 settings by hand is not a test, it is a afternoon that
 * proves nothing about the 28th section. These are the defect CLASSES instead, each
 * one a thing that silently ships a control the merchant can never use:
 *
 *  1. a `t:` key with no locale entry renders the raw "t:won.settings.foo" as the
 *     label (conventions C4 — cs and en.default move together, 14 times out of 14);
 *  2. a `visible_if` that names a setting id which does not exist in that schema
 *     hides the control forever — a dead setting that reads as intentional;
 *  3. a range whose `default` is not a step in its own range is rejected by
 *     Shopify's upload parser (conventions C3), which theme check does not catch;
 *  4. a preset that needs child blocks but ships none inserts an empty surface
 *     (theme-block-ux §6).
 */

const DIST = join(process.cwd(), 'themes/dist/horizon-dev');

type File = { file: string; src: string; schema: any };

function schemas(): File[] {
  const out: File[] = [];
  for (const dir of ['sections', 'blocks']) {
    const abs = join(DIST, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((x) => x.endsWith('.liquid'))) {
      const src = readFileSync(join(abs, f), 'utf8');
      const m = src.match(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/);
      if (!m) continue;
      try {
        out.push({ file: `${dir}/${f}`, src, schema: JSON.parse(m[1]) });
      } catch {
        /* an unparseable schema is its own failure, caught by validate_theme */
      }
    }
  }
  return out;
}

/** Only won files: the vendor theme has its own conventions and its own locales. */
const won = () => schemas().filter((s) => s.file.includes('/won-') || s.file.includes('/_won'));

function allSettings(schema: any): any[] {
  return [
    ...(schema.settings ?? []),
    ...(schema.blocks ?? []).flatMap((b: any) => b.settings ?? []),
  ];
}

function locale(name: string): any {
  const f = join(DIST, 'locales', name);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

function lookup(dict: any, key: string): boolean {
  return key.split('.').reduce<any>((acc, k) => (acc == null ? acc : acc[k]), dict) !== undefined;
}

test('every t: key a won schema uses exists in BOTH locales', () => {
  const files = won();
  expect(files.length, 'composed theme not found — run node themes/build/compose.mjs horizon').toBeGreaterThan(0);
  const cs = locale('cs.schema.json');
  const en = locale('en.default.schema.json');
  expect(cs && en, 'schema locale files missing from the build').toBeTruthy();

  const missing: string[] = [];
  for (const { file, schema } of files) {
    const text = JSON.stringify(schema);
    for (const raw of text.match(/"t:won\.[a-zA-Z0-9_.]+"/g) ?? []) {
      const key = raw.slice(3, -1); // strip `"t:` and `"`
      const inCs = lookup(cs, key);
      const inEn = lookup(en, key);
      if (!inCs || !inEn) {
        missing.push(`${file}: ${key}${!inCs ? ' [chybí cs]' : ''}${!inEn ? ' [chybí en]' : ''}`);
      }
    }
  }
  expect(
    [...new Set(missing)],
    `schema keys with no translation — the merchant sees the raw key as the label:\n${[...new Set(missing)].join('\n')}`,
  ).toEqual([]);
});

test('every visible_if names a setting that exists in the same schema', () => {
  const offenders: string[] = [];
  for (const { file, schema } of won()) {
    const ids = new Set(allSettings(schema).map((s) => s.id).filter(Boolean));
    for (const s of allSettings(schema)) {
      const cond = s.visible_if;
      if (typeof cond !== 'string') continue;
      for (const ref of cond.match(/(?:section|block)\.settings\.([a-zA-Z0-9_]+)/g) ?? []) {
        const id = ref.split('.').pop()!;
        if (!ids.has(id)) offenders.push(`${file}: "${s.id}" is gated on "${id}", which no setting declares`);
      }
    }
  }
  expect(
    offenders,
    `a visible_if pointing at a non-existent setting hides its control forever:\n${offenders.join('\n')}`,
  ).toEqual([]);
});

test('every range default is a real step in its own range', () => {
  const offenders: string[] = [];
  for (const { file, schema } of won()) {
    for (const s of allSettings(schema)) {
      if (s.type !== 'range') continue;
      const { min, max, step, default: def, id } = s;
      if ([min, max, step, def].some((v) => typeof v !== 'number')) continue;
      if (def < min || def > max) {
        offenders.push(`${file}: range "${id}" default ${def} is outside ${min}..${max}`);
        continue;
      }
      const steps = (def - min) / step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        offenders.push(`${file}: range "${id}" default ${def} is not a step of ${step} from ${min}`);
      }
    }
  }
  expect(
    offenders,
    `Shopify's upload parser rejects these even though theme check passes (conventions C3):\n${offenders.join('\n')}`,
  ).toEqual([]);
});

/**
 * A preset is the merchant's first impression: inserting it must show something,
 * with zero configuration (theme-block-ux §6).
 *
 * "Something" is not only child blocks. A band ships its heading, body and button
 * label in the preset itself; a slide and an app slot ship theirs as schema
 * defaults. Judging presets by `blocks.length` alone flags all of those as empty
 * — which is why the predicate below asks the real question: after inserting
 * this preset and touching nothing, is there any content?
 */

const CONTENT_TYPES = new Set([
  'text', 'textarea', 'richtext', 'inline_richtext', 'html', 'liquid', 'image_picker', 'video', 'video_url',
]);

/**
 * Content does not only come from the merchant. A listing fills itself from the
 * page's collection, a buy-box block from the product, and a video block draws a
 * placeholder until a file is picked — all of which satisfy §6 on insert. Only a
 * component with none of these renders a genuinely blank surface.
 */
const DATA_DRIVEN = /\b(closest\.|product\b|collection\b|article\b|blog\b|cart\b|predictive_search\b|placeholder_svg_tag)/;

/** Returns the reason a preset renders empty, or null when it renders something. */
export function emptyPresetReason(schema: any, preset: any, rendersBlocks: boolean, body = ''): string | null {
  if (Array.isArray(preset.blocks) && preset.blocks.length > 0) return null;
  if (DATA_DRIVEN.test(body)) return null;

  // A data-driven source fills itself from the store and owns its empty state.
  const source = preset.settings?.source;
  if (source && source !== 'blocks') return null;

  const settings: any[] = [
    ...(schema.settings ?? []),
    ...(schema.blocks ?? []).flatMap((b: any) => b.settings ?? []),
  ];
  const contentIds = new Set(settings.filter((s) => CONTENT_TYPES.has(s.type)).map((s) => s.id));

  // Content the preset states itself.
  for (const [id, value] of Object.entries(preset.settings ?? {})) {
    if (contentIds.has(id) && value !== '' && value != null) return null;
  }
  // Content the schema already defaults to.
  for (const s of settings) {
    if (CONTENT_TYPES.has(s.type) && s.default !== undefined && s.default !== '') return null;
  }

  return rendersBlocks
    ? 'renders child blocks, ships none, and has no content of its own'
    : 'has no child blocks and no content of its own';
}

test('the predicate actually bites (red-proof)', () => {
  const schema = {
    settings: [
      { id: 'heading', type: 'text' },
      { id: 'gap', type: 'range', default: 16 },
    ],
  };
  // Nothing anywhere -> flagged.
  expect(emptyPresetReason(schema, { name: 'bare' }, true)).not.toBeNull();
  // Content in the preset -> fine.
  expect(emptyPresetReason(schema, { name: 'filled', settings: { heading: 'Ahoj' } }, true)).toBeNull();
  // Content as a schema default -> fine.
  const withDefault = { settings: [{ id: 'heading', type: 'text', default: 'Ahoj' }] };
  expect(emptyPresetReason(withDefault, { name: 'defaulted' }, true)).toBeNull();
  // Child blocks -> fine.
  expect(emptyPresetReason(schema, { name: 'blocky', blocks: [{ type: 'x' }] }, true)).toBeNull();
  // A non-content default (a range) must NOT count as content.
  expect(emptyPresetReason(schema, { name: 'geometry-only', settings: { gap: 24 } }, true)).not.toBeNull();
  // Drawing on page/product data, or a placeholder, counts as rendering something...
  expect(emptyPresetReason(schema, { name: 'listing' }, true, '{{ collection.products }}')).toBeNull();
  expect(emptyPresetReason(schema, { name: 'ph' }, true, "{{ 'x' | placeholder_svg_tag }}")).toBeNull();
  // ...but a body that merely mentions its own settings does not.
  expect(emptyPresetReason(schema, { name: 'bare2' }, true, '{{ block.settings.gap }}')).not.toBeNull();
});

test('every preset renders something with zero configuration', () => {
  const offenders: string[] = [];
  for (const { file, src, schema } of won()) {
    const rendersBlocks = /content_for\s+'blocks'/.test(src);
    for (const preset of schema.presets ?? []) {
      const reason = emptyPresetReason(schema, preset, rendersBlocks, src);
      if (reason) offenders.push(`${file}: preset "${preset.name}" ${reason}`);
    }
  }
  expect(
    offenders,
    `inserting these presets gives the merchant an empty surface (theme-block-ux §6):\n${offenders.join('\n')}`,
  ).toEqual([]);
});
