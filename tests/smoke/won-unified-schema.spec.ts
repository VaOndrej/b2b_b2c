import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Won unified-schema audit (static, no server needed).
//
// DOCTRINE (why this test exists): every won-* section must speak ONE editor
// language so a merchant learns it once — device Visibility first, the
// behavior-defining Mode select next, then all the words under Content, then
// Layout / Controls / Appearance, and Spacing last of the primary groups. This
// test reads the COMPOSED theme (themes/dist/horizon-dev) — that is what a
// merchant actually sees, and it is where compose injects the shared Visibility
// + Spacing groups. It fails when a section drifts from the canonical order.
//
// Spec: docs/superpowers/specs/2026-08-11-won-schema-unification-design.md

const DIST = join(process.cwd(), 'themes', 'dist', 'horizon-dev', 'sections');
const SCHEMA_RE = /{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/;

// Canonical rank of every header we place. Lower = higher in the editor. The
// two shared power-layers (type_motion, advanced) are appended by compose after
// the primary groups by design, so they rank after spacing.
const RANK: Record<string, number> = {
  visibility: 0, mode: 1, content: 2, source: 2, heading: 2, media: 3,
  layout: 4, price_per_unit: 5, ai_schema: 5, controls: 6, contact: 7,
  appearance: 8, spacing: 9, type_motion: 10, advanced: 11,
};

interface Setting { id?: string; type?: string; content?: string; visible_if?: string }
interface Schema { presets?: unknown[]; settings?: Setting[] }

function shownSections(): { name: string; settings: Setting[] }[] {
  const out: { name: string; settings: Setting[] }[] = [];
  if (!existsSync(DIST)) return out;
  for (const f of readdirSync(DIST).filter((x) => x.startsWith('won-') && x.endsWith('.liquid'))) {
    const m = readFileSync(join(DIST, f), 'utf8').match(SCHEMA_RE);
    if (!m) continue;
    let schema: Schema;
    try { schema = JSON.parse(m[1]); } catch { continue; }
    if (!Array.isArray(schema.presets) || schema.presets.length === 0) continue;
    if (!Array.isArray(schema.settings)) continue;
    out.push({ name: f.replace('won-', '').replace('.liquid', ''), settings: schema.settings });
  }
  return out;
}

function headerKeys(settings: Setting[]): string[] {
  return settings
    .filter((s) => s.type === 'header' && typeof s.content === 'string')
    .map((s) => s.content!.replace('t:won.headers.', ''));
}

const SECTIONS = shownSections();

test('composed theme has sections to audit', () => {
  expect(SECTIONS.length, 'no composed won sections — run `node themes/build/compose.mjs horizon` first').toBeGreaterThan(15);
});

test('every won section orders its group headers canonically', () => {
  const offenders: string[] = [];
  for (const { name, settings } of SECTIONS) {
    const keys = headerKeys(settings);
    const unknown = keys.filter((k) => !(k in RANK));
    if (unknown.length) { offenders.push(`${name}: unknown header(s) ${unknown.join(', ')}`); continue; }
    const ranks = keys.map((k) => RANK[k]);
    for (let i = 1; i < ranks.length; i++) {
      if (ranks[i] < ranks[i - 1]) { offenders.push(`${name}: ${keys[i]} appears after ${keys[i - 1]} (out of order: ${keys.join(' → ')})`); break; }
    }
  }
  expect(offenders, `sections out of canonical header order:\n${offenders.join('\n')}`).toEqual([]);
});

test('Visibility, when present, is the first group (after an optional About paragraph)', () => {
  const offenders: string[] = [];
  for (const { name, settings } of SECTIONS) {
    const firstHeaderIdx = settings.findIndex((s) => s.type === 'header');
    if (firstHeaderIdx === -1) continue;
    const first = settings[firstHeaderIdx];
    if (first.content !== 't:won.headers.visibility') continue; // section may legitimately have no visibility group
    // everything before the first header must be paragraphs only (the About line)
    const before = settings.slice(0, firstHeaderIdx);
    if (before.some((s) => s.type !== 'paragraph')) offenders.push(`${name}: settings precede the Visibility header`);
    // the two device toggles must sit directly under it
    const ids = [settings[firstHeaderIdx + 1]?.id, settings[firstHeaderIdx + 2]?.id];
    if (ids[0] !== 'hide_mobile' || ids[1] !== 'hide_desktop') offenders.push(`${name}: Visibility group is not hide_mobile+hide_desktop (got ${ids.join(', ')})`);
  }
  expect(offenders, offenders.join('\n')).toEqual([]);
});

test('a Mode group leads with an always-visible behavior select', () => {
  const offenders: string[] = [];
  for (const { name, settings } of SECTIONS) {
    const idx = settings.findIndex((s) => s.type === 'header' && s.content === 't:won.headers.mode');
    if (idx === -1) continue;
    const first = settings[idx + 1];
    if (!first || first.type !== 'select') { offenders.push(`${name}: Mode header not followed by a select`); continue; }
    // The mode select decides what every setting below means — it must never be
    // hidden behind another setting, or the merchant lands on an empty group.
    if (first.visible_if) offenders.push(`${name}: Mode select ${first.id} is gated by visible_if (${first.visible_if}) — would render an empty Mode group`);
  }
  expect(offenders, offenders.join('\n')).toEqual([]);
});

test('hide_mobile / hide_desktop live only under the Visibility group', () => {
  const offenders: string[] = [];
  for (const { name, settings } of SECTIONS) {
    // find the header preceding each device toggle
    let currentHeader = '';
    for (const s of settings) {
      if (s.type === 'header') currentHeader = (s.content || '').replace('t:won.headers.', '');
      if (s.id === 'hide_mobile' || s.id === 'hide_desktop') {
        if (currentHeader !== 'visibility') offenders.push(`${name}: ${s.id} sits under "${currentHeader}", not Visibility`);
      }
    }
  }
  expect(offenders, offenders.join('\n')).toEqual([]);
});
