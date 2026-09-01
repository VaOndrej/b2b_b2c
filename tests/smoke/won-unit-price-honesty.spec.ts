import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Unit price honesty.
 *
 * A unit price ("$72.99 / 100 g") is a claim about a reference amount the shop
 * knows. If the theme cannot read that amount and substitutes a constant, the
 * number it prints is fiction — and fiction on a price is worse than silence
 * (EshopAudit PRC-001, severity kritická: the price must be transparent).
 *
 * The defect this guards: won-price-per-unit resolved the amount from
 * `product.metafields`, but a product with a size/count axis carries its weight
 * and servings PER VARIANT (that is deliberate — a product-level value would lie).
 * The read therefore came back blank on every multi-variant product and the block
 * fell through to the schema default `amount: 1000`, printing price/10 under a
 * "/ 100 g" label. Every capsule PDP in the demo catalog showed a number that
 * means nothing, and every powder PDP inverted its own value story: the 2 500 g
 * pack looked 2.3x MORE expensive per 100 g than the 1 000 g pack.
 *
 * The invariants are written so a NEW product or a NEW consumer of the unit price
 * is covered without editing this file:
 *   1. behavioural — wherever a variant axis carries a quantity, the reference
 *      amount implied by the printed number must track that quantity;
 *   2. structural — exactly one implementation may compute a unit price, and the
 *      theme may not ship a default reference amount to fall back on.
 */

// ---------------------------------------------------------------- helpers

/** "$1,899.95" / "1 899,95 Kč" -> 189995 (minor units). Separator-agnostic. */
function moneyToMinor(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;
  const lastSep = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
  // A separator with exactly two trailing digits is the decimal point; anything
  // else (or none) is a thousands group, so the value is a whole unit.
  const isDecimal = lastSep > -1 && cleaned.length - lastSep - 1 === 2;
  const digits = cleaned.replace(/[.,]/g, '');
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return isDecimal ? n : n * 100;
}

/** "1 000 g" / "180 kapslí" -> 1000 / 180. Handles NBSP + narrow NBSP groups. */
function quantityIn(label: string): number | null {
  const m = label.replace(/[  \s]/g, '').match(/\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

type Ppu = { value: number; unit: string } | null;

/** Server-rendered unit price for one variant. No JS — this is Liquid's output. */
async function ppuFor(request: APIRequestContext, handle: string, variantId: number): Promise<Ppu> {
  const res = await request.get(`/products/${handle}?variant=${variantId}`);
  if (!res.ok()) return null;
  const html = await res.text();
  const value = html.match(/class="won-ppu__value"[^>]*>([^<]*)</);
  const unit = html.match(/class="won-ppu__unit"[^>]*>([^<]*)</);
  if (!value) return null;
  const minor = moneyToMinor(value[1]);
  if (minor === null || minor <= 0) return null;
  return { value: minor, unit: (unit?.[1] ?? '').trim() };
}

/** Demo handles come from the repo's own catalog, so a new product is covered. */
function demoHandles(): string[] {
  const p = join(process.cwd(), 'themes/demo/tools/supplement-catalog.json');
  if (!existsSync(p)) return [];
  const data = JSON.parse(readFileSync(p, 'utf8')) as { products: { handle: string }[] };
  return data.products.map((x) => x.handle);
}

// ------------------------------------------------- 1. behavioural invariant

test('the printed unit price tracks the quantity on the variant axis', async ({ request }) => {
  const checked: string[] = [];
  const offenders: string[] = [];

  for (const handle of demoHandles()) {
    const res = await request.get(`/products/${handle}.js`);
    if (!res.ok()) continue;
    const product = (await res.json()) as {
      variants: { id: number; title: string; price: number; available: boolean }[];
    };

    // A quantity axis = variant titles that carry DIFFERENT numbers ("500 g" vs
    // "2 500 g", "90 kapslí" vs "180 kapslí"). A flavour axis carries none and is
    // skipped: there the reference amount legitimately stays constant.
    const points = product.variants
      .map((v) => ({ ...v, qty: quantityIn(v.title) }))
      .filter((v): v is typeof v & { qty: number } => v.qty !== null);
    const distinct = new Set(points.map((p) => p.qty));
    if (points.length < 2 || distinct.size < 2) continue;

    const [a, b] = [points[0], points[points.length - 1]];
    const pa = await ppuFor(request, handle, a.id);
    const pb = await ppuFor(request, handle, b.id);
    // Nothing rendered = the honest outcome when no reference amount is known.
    // This invariant only judges numbers that ARE printed.
    if (!pa || !pb) continue;
    checked.push(handle);

    if (pa.unit !== pb.unit) {
      offenders.push(`${handle}: unit label changes between variants (${pa.unit} vs ${pb.unit})`);
      continue;
    }

    // unit = price / amount, so amount = price / unit. The unit factor (100 g,
    // kg, serving) cancels in the ratio, which is why the label must match above.
    const impliedRatio = (b.price / pb.value) / (a.price / pa.value);
    const qtyRatio = b.qty / a.qty;
    const drift = Math.abs(impliedRatio - qtyRatio) / qtyRatio;
    if (drift > 0.05) {
      offenders.push(
        `${handle}: "${a.title}"->"${b.title}" quantity x${qtyRatio.toFixed(2)} but the printed ` +
          `unit price implies a reference amount x${impliedRatio.toFixed(2)} ` +
          `(${(a.price / 100).toFixed(2)}->${(pa.value / 100).toFixed(2)}/${pa.unit}, ` +
          `${(b.price / 100).toFixed(2)}->${(pb.value / 100).toFixed(2)}/${pb.unit})`,
      );
    }
  }

  expect(checked.length, 'no product printed a unit price on a quantity axis — the test proved nothing').toBeGreaterThan(1);
  expect(offenders, `unit price does not follow the variant's real quantity:\n${offenders.join('\n')}`).toEqual([]);
});

// ------------------------------------------------- 2. structural invariants

const DIST = join(process.cwd(), 'themes/dist/horizon-dev');
const SHARED = 'won-unit-price.liquid';

function themeFiles(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = [];
  for (const dir of ['blocks', 'sections', 'snippets']) {
    const abs = join(DIST, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((x) => x.endsWith('.liquid'))) {
      out.push({ file: `${dir}/${f}`, src: readFileSync(join(abs, f), 'utf8') });
    }
  }
  return out;
}

test('only one file computes a unit price', () => {
  const files = themeFiles();
  expect(files.length, 'composed theme not found — run node themes/build/compose.mjs horizon').toBeGreaterThan(0);

  // The unit LABEL keys are the fingerprint of the computation: a file that
  // prints "/ 100 g" is a file that decided what to divide by.
  const owners = files
    .filter((f) => /won\.unit\.(per_100g|per_kg|per_serving)/.test(f.src))
    .map((f) => f.file);

  expect(owners, 'a unit price is computed outside the shared resolver — drift is how three copies of this bug shipped').toEqual([`snippets/${SHARED}`]);
});

test('no consumer ships a fabricated reference amount as a default', () => {
  for (const { file, src } of themeFiles()) {
    const schema = src.match(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/);
    if (!schema) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(schema[1]);
    } catch {
      continue;
    }
    const settings: any[] = [...(parsed.settings ?? []), ...(parsed.blocks ?? []).flatMap((b: any) => b.settings ?? [])];
    for (const s of settings) {
      // Any setting that feeds the reference amount of a unit price.
      if (!/(^|_)(amount|ppu_amount)$/.test(String(s.id ?? ''))) continue;
      expect(
        s.default,
        `${file}: setting "${s.id}" ships default ${s.default} — a reference amount nobody measured. ` +
          `Leave it empty so a missing metafield renders nothing instead of fiction.`,
      ).toBeUndefined();
    }
  }
});

// ------------------------------- 3. one merchant-editable source for the ladder

/**
 * The unit-price ladder is a catalogue decision, not a per-section one: which
 * metafield carries the reference amount, and what unit the price is quoted per.
 * It therefore lives in ONE global theme setting the merchant can extend —
 * `won_unit_price_rules`, one rule per line:
 *
 *     won.net_weight_g | 100 | t:won.unit.per_100g
 *     won.volume_ml    | 100 | 100 ml
 *
 * Rules are tried in order; the first whose metafield yields a positive number
 * wins. A `t:` label resolves through the locale files, anything else is printed
 * literally, so a client can add "per wash", "za kus", "per 100 ml" without a
 * code change. Only metafield paths are accepted — a literal amount would be the
 * fabrication this whole file exists to stop.
 */

function themeSettingsSchema(): any[] {
  const f = join(DIST, 'config/settings_schema.json');
  if (!existsSync(f)) return [];
  return JSON.parse(readFileSync(f, 'utf8'));
}

function unitPriceRulesSetting(): any | null {
  for (const group of themeSettingsSchema()) {
    for (const s of group?.settings ?? []) {
      if (s?.id === 'won_unit_price_rules') return s;
    }
  }
  return null;
}

/** "won.net_weight_g | 100 | t:won.unit.per_100g" -> parts */
function parseRules(raw: string) {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split('|').map((x) => x.trim()))
    .map(([metafield, per, label]) => ({ metafield, per, label }));
}

test('the unit-price ladder is one global, merchant-editable setting', () => {
  const setting = unitPriceRulesSetting();
  expect(setting, 'no global `won_unit_price_rules` setting — the ladder is not merchant-editable').not.toBeNull();
  expect(setting!.type, '`won_unit_price_rules` must be a textarea so a client can add their own units').toBe('textarea');

  const rules = parseRules(String(setting!.default ?? ''));
  expect(rules.length, 'the shipped ladder is empty — a fresh theme would show no unit price at all').toBeGreaterThan(0);

  for (const r of rules) {
    // A literal amount here would apply one made-up quantity to the whole
    // catalogue — exactly the defect this file guards.
    expect(
      r.metafield,
      `rule "${r.metafield}" is not a metafield path (namespace.key); a literal reference amount is never honest`,
    ).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/i);
    expect(Number(r.per), `rule "${r.metafield}" has a non-positive unit count "${r.per}"`).toBeGreaterThan(0);
    expect(r.label, `rule "${r.metafield}" has no unit label — a number with no unit means nothing`).toBeTruthy();
  }
});

test('no file hardcodes a reference metafield or unit', () => {
  const offenders: string[] = [];
  const rules = parseRules(String(unitPriceRulesSetting()?.default ?? ''));
  const paths = rules.map((r) => r.metafield).filter(Boolean);
  // Nothing to look for on a theme that has not declared its ladder yet — the
  // test above already fails in that case.
  if (paths.length === 0) return;

  // Strip Liquid comments first: the resolver DOCUMENTS the rule syntax with real
  // example lines, and prose is not a dependency. Only executable Liquid counts.
  const stripComments = (src: string) =>
    src
      .replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '')
      .replace(/\{%-?\s*doc\s*-?%\}[\s\S]*?\{%-?\s*enddoc\s*-?%\}/g, '');

  for (const { file, src } of themeFiles()) {
    const code = stripComments(src);
    for (const p of paths) {
      if (code.includes(p)) offenders.push(`${file} hardcodes "${p}"`);
    }
  }

  expect(
    offenders,
    `the reference metafield belongs to the theme setting, not to Liquid — a client whose ` +
      `catalogue uses a different namespace must not have to edit code:\n${offenders.join('\n')}`,
  ).toEqual([]);
});

test('every unit label on the storefront comes from the declared ladder', async ({ request }) => {
  const rules = parseRules(String(unitPriceRulesSetting()?.default ?? ''));
  expect(rules.length, 'no ladder declared — nothing to validate the storefront against').toBeGreaterThan(0);

  // `t:` labels resolve through the storefront locale of the running theme.
  const locale = JSON.parse(readFileSync(join(DIST, 'locales/en.default.json'), 'utf8'));
  const resolve = (label: string) => {
    if (!label.startsWith('t:')) return label;
    return label
      .slice(2)
      .split('.')
      .reduce<any>((acc, k) => (acc == null ? acc : acc[k]), locale);
  };
  const allowed = new Set(rules.map((r) => resolve(r.label)).filter(Boolean));

  const seen = new Set<string>();
  for (const handle of demoHandles()) {
    const res = await request.get(`/products/${handle}`);
    if (!res.ok()) continue;
    const html = await res.text();
    for (const m of html.matchAll(/class="won-ppu__unit"[^>]*>\s*\/?\s*([^<]*)</g)) {
      const label = m[1].trim();
      if (label) seen.add(label);
    }
  }

  expect(seen.size, 'no unit label rendered anywhere — the storefront proved nothing').toBeGreaterThan(0);
  const stray = [...seen].filter((l) => !allowed.has(l));
  expect(
    stray,
    `unit labels on the storefront that no rule declares: ${JSON.stringify(stray)} ` +
      `(declared: ${JSON.stringify([...allowed])})`,
  ).toEqual([]);
});
