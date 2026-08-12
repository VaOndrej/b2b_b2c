import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Won settings-coverage audit (static, no server needed).
//
// DOCTRINE (why this test exists): every setting a merchant can see in the
// theme editor MUST do something — a toggle or select that changes nothing is a
// broken promise. This test fails when a won-* section (or one of its child
// blocks) declares a schema setting `id` that is never referenced anywhere in
// the theme source (its own liquid, its blocks, shared snippets or assets).
// It runs in the smoke suite and in CI, so a NEW won block or a NEW setting on
// an existing block cannot ship dead — the rule holds going forward.
//
// It does NOT prove a wired setting is *visibly* effective in every content
// configuration (e.g. carousel dots hide when the rail fits on one page — see
// won-carousel-controls.spec.ts for the behavioural side). Static wiring is the
// floor; behavioural specs cover the settings whose effect is content-dependent.

const BASE = join(process.cwd(), 'themes', 'won-base');

// Shared style-controls (W3-b): injected into every won section by compose 2d
// and consumed by snippets/won-style-vars.liquid — never authored per-section,
// so they can't be found as `s.<id>` in a section file. Excluded here; their
// wiring is covered by tests/smoke/customization-layer.spec.ts.
const STYLE_IDS = new Set([
  'corner_radius', 'border_width', 'border_style', 'border_color', 'shadow',
  'accent_override', 'bg_color', 'text_color', 'hide_mobile', 'hide_desktop',
  'padding_top', 'padding_bottom', 'heading_weight', 'letter_spacing',
  'line_height', 'text_transform', 'animate_in', 'show_advanced', 'pad_inline',
  'section_opacity', 'custom_shadow',
]);

const SCHEMA_RE = /{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/;

function readDir(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => exts.some((e) => f.endsWith(e)))
    .map((f) => readFileSync(join(dir, f), 'utf8'));
}

// Corpus = every place a setting id can legitimately be consumed. Blocks read
// `section.settings.<id>`, sections render blocks, both pull shared snippets and
// JS/CSS assets — all of it counts as "used". Schema bodies are stripped so a
// setting's own declaration never counts as its usage.
function buildCorpus(): string {
  const files = [
    ...readDir(join(BASE, 'sections'), ['.liquid']),
    ...readDir(join(BASE, 'blocks'), ['.liquid']),
    ...readDir(join(BASE, 'snippets'), ['.liquid']),
    ...readDir(join(BASE, 'assets'), ['.js', '.css']),
  ];
  return files.map((t) => t.replace(new RegExp(SCHEMA_RE, 'g'), '')).join('\n');
}

const CORPUS = buildCorpus();

function isUsed(id: string): boolean {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Whole-token match: the id appears bounded by non-word chars anywhere in the
  // source (`s.id`, `settings.id`, `s[...]`, a data-attr, a CSS var, etc.).
  if (new RegExp(`(?<![\\w])${esc}(?![\\w])`).test(CORPUS)) return true;
  // Dynamic key: ids like `option1_style` are read via
  // `assign key = 'option' | append: position | append: '_style'` — match the
  // constant suffix that is appended.
  const suffix = id.match(/_[a-z]+$/)?.[0];
  if (suffix && new RegExp(`append:\\s*['"]${suffix}['"]`).test(CORPUS)) return true;
  return false;
}

interface Setting { id?: string; type?: string; }
interface Schema { presets?: unknown[]; settings?: Setting[]; blocks?: { type?: string; settings?: Setting[] }[]; }

function shownSections(): { name: string; schema: Schema }[] {
  const dir = join(BASE, 'sections');
  const out: { name: string; schema: Schema }[] = [];
  for (const f of readdirSync(dir).filter((x) => x.startsWith('won-') && x.endsWith('.liquid'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    const m = src.match(SCHEMA_RE);
    if (!m) continue;
    let schema: Schema;
    try { schema = JSON.parse(m[1]); } catch { continue; }
    // Only sections that appear in the "Add section" picker (have presets) can
    // actually be configured by a merchant; deprecated back-compat sections are
    // hidden and their settings are unreachable, so they're out of scope.
    if (!Array.isArray(schema.presets) || schema.presets.length === 0) continue;
    out.push({ name: f.replace('won-', '').replace('.liquid', ''), schema });
  }
  return out;
}

function deadSettings(schema: Schema): string[] {
  const all: { id?: string; type?: string }[] = [...(schema.settings || [])];
  for (const b of schema.blocks || []) for (const s of b.settings || []) all.push(s);
  const dead: string[] = [];
  for (const s of all) {
    if (!s.id || s.type === 'header' || s.type === 'paragraph' || STYLE_IDS.has(s.id)) continue;
    if (!isUsed(s.id)) dead.push(s.id);
  }
  return dead;
}

test('every won-* section setting (and child-block setting) is wired to the theme source', () => {
  const sections = shownSections();
  expect(sections.length, 'found no shown won sections — corpus/path wrong?').toBeGreaterThan(10);

  const offenders: string[] = [];
  for (const { name, schema } of sections) {
    const dead = deadSettings(schema);
    if (dead.length) offenders.push(`won-${name}: ${dead.join(', ')}`);
  }

  expect(
    offenders,
    `Dead settings — declared in schema but referenced nowhere in liquid/blocks/snippets/assets.\n` +
      `Each is a control a merchant can toggle with no visible effect. Wire it or remove it:\n  ` +
      offenders.join('\n  '),
  ).toEqual([]);
});
