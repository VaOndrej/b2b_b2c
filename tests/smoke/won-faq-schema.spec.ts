import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Won FAQ schema (Phase 1 of the AI-shopping-first "won-schema" engine) — static
// wiring. Because a section can't read its child theme-blocks' settings when they
// render via {% content_for 'blocks' %}, each FAQ ROW self-emits its FAQPage node,
// gated by the parent section's emit_faq_schema toggle. These tests lock that
// wiring + the honesty guard so schema can't ship on non-FAQ content or dead.

const BASE = join(process.cwd(), 'themes', 'won-base');
const read = (rel: string) => readFileSync(join(BASE, rel), 'utf8');

test('won-faq-schema snippet: FAQPage, honesty guard, safe escaping, doc', () => {
  const s = read('snippets/won-faq-schema.liquid');
  expect(s).toContain('{% doc %}');
  expect(s).toContain('@param {boolean} enabled');
  expect(s).toContain('"@type":"FAQPage"');
  expect(s).toContain('"@type":"Question"');
  expect(s).toContain('acceptedAnswer');
  // Honesty guard: emit nothing unless toggle on AND both parts non-blank.
  expect(s).toMatch(/if enabled and q != blank and a != blank/);
  // Escape the value through Liquid's json filter (proper JSON string encoding).
  expect(s).toMatch(/\| json/);
  // Neutralise any literal </script> inside FAQ text so it can't break out.
  expect(s).toMatch(/replace: '<\\?\/'/);
});

test('both FAQ row blocks self-emit the schema, gated by the section toggle', () => {
  const row = read('blocks/won-accordion-row.liquid');
  expect(row).toMatch(/render 'won-faq-schema'[\s\S]*enabled: section\.settings\.emit_faq_schema/);
  expect(row).toContain('question: s.summary');
  expect(row).toContain('answer: s.content');

  const panel = read('blocks/won-panel.liquid');
  expect(panel).toMatch(/render 'won-faq-schema'[\s\S]*enabled: section\.settings\.emit_faq_schema/);
  expect(panel).toContain('question: s.title');
  // won-panel emits only in the accordion branch (tabs are not a FAQ): the render
  // sits after the </details> row, inside the else branch.
  const detailsIdx = panel.indexOf('</details>');
  const renderIdx = panel.indexOf("render 'won-faq-schema'");
  expect(detailsIdx).toBeGreaterThan(-1);
  expect(renderIdx).toBeGreaterThan(detailsIdx);
});

test('smart defaults: accordion ON, panels OFF', () => {
  const acc = read('sections/won-accordion.liquid');
  expect(acc).toMatch(/"id": "emit_faq_schema"[\s\S]*?"default": true/);

  const panels = read('sections/won-panels.liquid');
  expect(panels).toMatch(/"id": "emit_faq_schema"[^}]*"default": false/);
  // panels only exposes it in accordion mode (not for tabs).
  expect(panels).toMatch(/"id": "emit_faq_schema"[^}]*section\.settings\.display == 'accordion'/);
});
