// Množstevní slevy in the admin (MVP 3): the form the screen posts, parsed by
// ONE function — the server validates it (SEC-1, app/lib/integration/
// tiers.server.ts) and the screen reads its live draft with it (§2, §17b) — so
// the state line, the preview and what Save stores never disagree. Values per
// market currency, never converted (MKT-1): an empty amount = the break is not
// offered in that currency. Pure (no React), tests/ui/tiers.test.ts.
//
// The preview math mirrors the storefront block (contracts K2/K6): the break
// that applies is the highest one whose minimum the count reaches; an amount is
// per item and never more than the item's price; a currency without a value =
// that break is not shown there.

import { CONFIG_LIMITS, createDefaultConfig, type TierBreak, type TierSet, type TiersModule } from "@won/core/discounts/config";
import { gateConfigForPlan } from "@won/core/discounts/plan-gate";
import { buildTiersPayload } from "@won/core/discounts/tiers";
import { describeTierBreak, describeTierSet, formatMoney, type DescribableTierBreak } from "@won/core/discounts/describe";
import { splitAmountKey, currencyExponent } from "@won/core/discounts/money";

import type { Locale, Translator } from "../../i18n";
import { COLLECTION_GID, PRODUCT_GID } from "./ids";
import { parseMoneyInput, type FormDataLike } from "./rule-form";
import { formatDateTime } from "./signals";
import type { CurrencyView, FieldError, StorefrontSyncView, TierBreakView, TierScopeView, TierSetView, TiersBlockView } from "./types";

/** Where the Množstevní slevy form posts (app/routes/app.tiers.tsx). */
export const TIERS_ACTION = "/app/tiers";

/** The largest "od X ks" a break takes: the core's own limit (the sanitizer clamps to it). */
export const TIER_MIN_QTY_MAX: number = CONFIG_LIMITS.tierMinQty;

/**
 * Form fields. Sets are listed in `set[]` (config order); each set's fields are
 * keyed by its id, each break's by a row key the screen gives it (`r0`, `r1`…) and
 * lists in `set.<id>.row[]`, so a removed or added row never shifts another
 * row's values. A set has ONE kind (`set.<id>.kind`: percent | amount) for all
 * its breaks (controller ruling, MVP 3).
 */
export const TIERS_FIELD = {
  intent: "intent",
  configVersion: "configVersion",
  replaceUnreadable: "replaceUnreadable",
  set: "set[]",
  scope: (sid: string) => `set.${sid}.scope`,
  count: (sid: string) => `set.${sid}.count`,
  product: (sid: string) => `set.${sid}.product[]`,
  collection: (sid: string) => `set.${sid}.collection[]`,
  row: (sid: string) => `set.${sid}.row[]`,
  min: (sid: string, row: string) => `set.${sid}.${row}.min`,
  /** The set's kind (controller ruling: a set is single-kind — every break a percent, or every break an amount per item). */
  kind: (sid: string) => `set.${sid}.kind`,
  percent: (sid: string, row: string) => `set.${sid}.${row}.percent`,
  amount: (sid: string, row: string, currency: string) => `set.${sid}.${row}.amount.${currency}`,
  /** A break's amounts as a whole (the "enter at least one currency" error). */
  amounts: (sid: string, row: string) => `set.${sid}.${row}.amount`,
  /**
   * "1" = a set this page shows but does not edit (a Pro set on Free, a dormant
   * extra whole-store set): it is never re-parsed from the form — the server
   * keeps the STORED set by its id, exactly as stored (§14a; audit P3-4).
   */
  kept: (sid: string) => `set.${sid}.kept`,
} as const;

export const TIERS_INTENT = { save: "save" } as const;

export const TIER_COUNT_MODES = ["line", "product", "cart"] as const;
export type TierCountMode = (typeof TIER_COUNT_MODES)[number];

const SET_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ROW_KEY = /^r\d{1,4}$/;
const MIN_QTY = /^\d{1,6}$/;
/** Up to two decimals; a comma decimal too. */
const PERCENT = /^\d{1,3}(?:[.,]\d{1,2})?$/;

/** A fresh tier set id, valid for the config (`[A-Za-z0-9_-]{1,64}`). */
export function newTierSetId(): string {
  return `t_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/**
 * The id of the whole-store set a shop without one edits on this page: "global", or the first free
 * "global-2", "global-3"… when a Pro set already has that id. Deterministic — the server render and
 * the browser's first render must agree on it (a random id in a state initialiser would not).
 */
export function freeGlobalSetId(sets: readonly { id: string }[]): string {
  const taken = new Set(sets.map((s) => s.id));
  if (!taken.has("global")) return "global";
  for (let n = 2; ; n += 1) if (!taken.has(`global-${n}`)) return `global-${n}`;
}

/** Ready-made percent tiers offered for an empty set (one click fills the rows; every value stays editable). */
export const TIER_PRESETS: readonly { id: string; breaks: readonly { minQty: number; percent: number }[] }[] = [
  { id: "3-5-10", breaks: [{ minQty: 3, percent: 5 }, { minQty: 5, percent: 10 }, { minQty: 10, percent: 15 }] },
  { id: "2-4-6", breaks: [{ minQty: 2, percent: 5 }, { minQty: 4, percent: 10 }, { minQty: 6, percent: 15 }] },
  { id: "6-12-24", breaks: [{ minQty: 6, percent: 5 }, { minQty: 12, percent: 10 }, { minQty: 24, percent: 15 }] },
];

/** "3 / 5 / 10 ks → 5 / 10 / 15 %" (computed from the preset, a decimal comma except in English). */
export function tierPresetLabel(preset: (typeof TIER_PRESETS)[number], tr: Translator): string {
  const pct = (n: number) => (tr.locale === "en" ? String(n) : String(n).replace(".", ","));
  return tr.t("tiers.preset.label", { mins: preset.breaks.map((b) => b.minQty).join(" / "), percents: preset.breaks.map((b) => pct(b.percent)).join(" / ") });
}

/**
 * What a typed row still lacks before it counts (the summary, the preview and a save take complete rows only):
 * "min" = no usable "od X ks", "value" = no usable percent / no amount in any currency; null = complete.
 * The same grammar as readTiersForm, so the mark at the row and the parser never disagree.
 */
export function tierRowGap(kind: "percent" | "amount", row: { min: string; percent: string; amounts: readonly string[] }): "min" | "value" | null {
  const min = row.min.trim();
  if (!(MIN_QTY.test(min) && Number(min) >= 1 && Number(min) <= TIER_MIN_QTY_MAX)) return "min";
  if (kind === "percent") return readPercent(row.percent.trim()) === null ? "value" : null;
  return row.amounts.some((a) => a.trim() !== "") ? null : "value";
}

/** The share of the checkout's room for tiers from which the page starts showing it (below it there is nothing to do). */
export const TIER_CAPACITY_WARN_PERCENT = 80;

/** Is the room for tiers worth a line on the page: close to the limit, or over it? */
export function tierCapacityShown(use: Pick<TierPayloadUse, "percent" | "fits">): boolean {
  return !use.fits || use.percent >= TIER_CAPACITY_WARN_PERCENT;
}

export interface TiersFormContext {
  /** Currencies of the enabled markets: the amount fields the screen shows. */
  currencies: readonly string[];
  /** Currencies with stored values whose market is off: kept as hidden fields (§14a), read too. */
  keptCurrencies?: readonly string[];
  /** Known product / collection titles (Shopify's), so the draft keeps showing names. Never read from the form. */
  titles?: ReadonlyMap<string, string>;
  /** A kept set (TIERS_FIELD.kept) by its id: the stored one (server) / the shown one (draft); unknown → `tiers.error.set`. */
  keep?: (id: string) => TierSetView | undefined;
}

export interface TiersFormResult {
  /** What the form says, as far as it parses (the live draft; on the server: what is saved when `errors` is empty). */
  sets: TierSetView[];
  errors: FieldError[];
  /** Ids of the kept sets (taken as stored, never parsed — the server saves the stored set itself). */
  kept: string[];
}

function str(v: FormDataEntryValue | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

function uniqueStrings(values: FormDataEntryValue[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const s = str(v);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function readPercent(raw: string): number | null {
  if (!PERCENT.test(raw)) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

/**
 * The Množstevní slevy form → sets (TierSetView, config order) + field errors.
 * The server saves only when `errors` is empty (SEC-1); the screen uses `sets`
 * as its live draft (rows that do not parse are left out of the draft).
 */
export function readTiersForm(form: FormDataLike, ctx: TiersFormContext): TiersFormResult {
  const F = TIERS_FIELD;
  const errors: FieldError[] = [];
  const sets: TierSetView[] = [];
  const kept: string[] = [];
  const currencies = [...new Set([...ctx.currencies, ...(ctx.keptCurrencies ?? [])])].filter((c) => splitAmountKey(c) !== null);
  const title = (id: string) => ctx.titles?.get(id) ?? "";
  const ids = uniqueStrings(form.getAll(F.set));
  if (ids.some((id) => !SET_ID.test(id))) errors.push({ field: F.set, key: "tiers.error.set" });
  const valid = ids.filter((id) => SET_ID.test(id));
  if (valid.length > CONFIG_LIMITS.tierSets) errors.push({ field: F.set, key: "tiers.error.tooManySets", params: { max: CONFIG_LIMITS.tierSets } });

  for (const sid of valid.slice(0, CONFIG_LIMITS.tierSets)) {
    // A kept set: never re-parsed (its stored values may be outside this form's grammar, audit P3-4).
    if (str(form.get(F.kept(sid))) === "1") {
      const stored = ctx.keep?.(sid);
      if (stored) {
        sets.push(stored);
        kept.push(sid);
      } else errors.push({ field: F.set, key: "tiers.error.set" });
      continue;
    }
    // Scope.
    let scope: TierScopeView = { kind: "global" };
    if (str(form.get(F.scope(sid))) === "selection") {
      const products = uniqueStrings(form.getAll(F.product(sid)));
      const collections = uniqueStrings(form.getAll(F.collection(sid)));
      if (products.some((id) => !PRODUCT_GID.test(id))) errors.push({ field: F.product(sid), key: "tiers.error.product" });
      if (collections.some((id) => !COLLECTION_GID.test(id))) errors.push({ field: F.collection(sid), key: "tiers.error.collection" });
      const p = products.filter((id) => PRODUCT_GID.test(id));
      const c = collections.filter((id) => COLLECTION_GID.test(id));
      if (p.length > CONFIG_LIMITS.listItems) errors.push({ field: F.product(sid), key: "tiers.error.tooManyItems", params: { max: CONFIG_LIMITS.listItems } });
      if (c.length > CONFIG_LIMITS.listItems) errors.push({ field: F.collection(sid), key: "tiers.error.tooManyItems", params: { max: CONFIG_LIMITS.listItems } });
      if (p.length === 0 && c.length === 0 && products.length === 0 && collections.length === 0) {
        errors.push({ field: F.scope(sid), key: "tiers.error.scopeEmpty" });
      }
      scope = {
        kind: "selection",
        products: p.slice(0, CONFIG_LIMITS.listItems).map((id) => ({ id, title: title(id) })),
        collections: c.slice(0, CONFIG_LIMITS.listItems).map((id) => ({ id, title: title(id) })),
      };
    }

    // Counting.
    const countRaw = str(form.get(F.count(sid)));
    const countAcross: TierCountMode = (TIER_COUNT_MODES as readonly string[]).includes(countRaw) ? (countRaw as TierCountMode) : "line";
    if (countAcross !== countRaw) errors.push({ field: F.count(sid), key: "tiers.error.count" });

    // Breaks: all of the set's one kind.
    const kind: "percent" | "amount" = str(form.get(F.kind(sid))) === "amount" ? "amount" : "percent";
    const rows = uniqueStrings(form.getAll(F.row(sid))).filter((r) => ROW_KEY.test(r));
    if (rows.length > CONFIG_LIMITS.breaksPerTierSet) {
      errors.push({ field: F.row(sid), key: "tiers.error.tooManyBreaks", params: { max: CONFIG_LIMITS.breaksPerTierSet } });
    }
    const breaks: TierBreakView[] = [];
    const seen = new Set<number>();
    const rowOf = new Map<number, string>();
    for (const row of rows.slice(0, CONFIG_LIMITS.breaksPerTierSet)) {
      let ok = true;
      const minRaw = str(form.get(F.min(sid, row)));
      const minQty = MIN_QTY.test(minRaw) ? Number(minRaw) : Number.NaN;
      if (!(minQty >= 1 && minQty <= TIER_MIN_QTY_MAX)) {
        errors.push({ field: F.min(sid, row), key: "tiers.error.min", params: { max: TIER_MIN_QTY_MAX } });
        ok = false;
      } else if (seen.has(minQty)) {
        errors.push({ field: F.min(sid, row), key: "tiers.error.minTaken", params: { min: minQty } });
        ok = false;
      } else {
        // Taken as soon as a row names it, even when that row's value is wrong (the second row is the duplicate).
        seen.add(minQty);
      }
      let percent: number | null = null;
      const amount: Record<string, number> = {};
      if (kind === "percent") {
        percent = readPercent(str(form.get(F.percent(sid, row))));
        if (percent === null) {
          errors.push({ field: F.percent(sid, row), key: "tiers.error.percent" });
          ok = false;
        }
      } else {
        for (const currency of currencies) {
          const minor = parseMoneyInput(str(form.get(F.amount(sid, row, currency))), currency);
          if (minor === null) continue;
          if (!Number.isFinite(minor) || minor <= 0 || minor > CONFIG_LIMITS.moneyMinorUnits) {
            errors.push({ field: F.amount(sid, row, currency), key: "tiers.error.amount" });
            ok = false;
            continue;
          }
          amount[currency] = minor;
        }
        if (ok && Object.keys(amount).length === 0) {
          errors.push({ field: F.amounts(sid, row), key: "tiers.error.amountNone" });
          ok = false;
        }
      }
      if (!ok) continue;
      rowOf.set(minQty, row);
      breaks.push({ minQty, kind, percent, amount });
    }
    breaks.sort((a, b) => a.minQty - b.minQty);
    errors.push(...notAscending(sid, breaks, rowOf));
    sets.push({ id: sid, scope, countAcross, breaks });
  }
  return { sets, errors, kept };
}

/**
 * A higher break never gives less than a lower one (controller ruling: a lower
 * percent, or a lower amount in any currency): "od 5 ks" below "od 3 ks" is a
 * typo, and it would let Free's per-product counting land on a larger discount
 * than the Pro setup gave (plan-gate.ts). Said at the higher row.
 */
function notAscending(sid: string, breaks: readonly TierBreakView[], rowOf: ReadonlyMap<number, string>): FieldError[] {
  const F = TIERS_FIELD;
  const out: FieldError[] = [];
  for (let i = 1; i < breaks.length; i += 1) {
    const hi = breaks[i]!;
    const row = rowOf.get(hi.minQty);
    if (!row) continue;
    const lower = breaks.slice(0, i).filter((b) => b.kind === hi.kind);
    if (hi.kind === "percent") {
      const prev = lower[lower.length - 1];
      if (prev && (hi.percent ?? 0) < (prev.percent ?? 0)) out.push({ field: F.percent(sid, row), key: "tiers.error.notAscending", params: { min: prev.minQty } });
      continue;
    }
    for (const [currency, value] of Object.entries(hi.amount)) {
      const prev = [...lower].reverse().find((b) => b.amount[currency] !== undefined);
      if (prev && value < (prev.amount[currency] ?? 0)) out.push({ field: F.amount(sid, row, currency), key: "tiers.error.notAscending", params: { min: prev.minQty } });
    }
  }
  return out;
}

// --- View ↔ config ---------------------------------------------------------------------------------

/** A set as the form edits it → the config's TierSet (what saveConfig sanitizes again). */
export function tierSetToConfig(view: TierSetView): TierSet {
  const scope: TierSet["scope"] =
    view.scope.kind === "global"
      ? "global"
      : {
          ...(view.scope.products.length > 0 ? { productIds: view.scope.products.map((p) => p.id) } : {}),
          ...(view.scope.collections.length > 0 ? { collectionIds: view.scope.collections.map((c) => c.id) } : {}),
        };
  return {
    id: view.id,
    scope,
    countAcross: view.countAcross,
    breaks: view.breaks.map((b): TierBreak => (b.kind === "percent" ? { minQty: b.minQty, percent: b.percent ?? 0 } : { minQty: b.minQty, amountOff: { ...b.amount } })),
  };
}

/** A stored set → the form's view (breaks ascending; titles from Shopify, "" when unknown — never an id on screen). */
export function tierSetView(set: TierSet, titles: ReadonlyMap<string, string>): TierSetView {
  const scope: TierScopeView =
    set.scope === "global"
      ? { kind: "global" }
      : {
          kind: "selection",
          products: (set.scope.productIds ?? []).map((id) => ({ id, title: titles.get(id) ?? "" })),
          collections: (set.scope.collectionIds ?? []).map((id) => ({ id, title: titles.get(id) ?? "" })),
        };
  const breaks = [...set.breaks]
    .sort((a, b) => a.minQty - b.minQty)
    .map((b): TierBreakView =>
      b.percent !== undefined || b.amountOff === undefined
        ? { minQty: b.minQty, kind: "percent", percent: b.percent ?? 0, amount: {} }
        : { minQty: b.minQty, kind: "amount", percent: null, amount: { ...b.amountOff } },
    );
  return { id: set.id, scope, countAcross: set.countAcross, breaks };
}

// --- The tier cap (CONFIG_LIMITS.tierPayloadBytes) ---------------------------------------------------------

export interface TierPayloadUse {
  /** UTF-8 bytes of the tiers' part of the shop config — the larger of the config as stored and gated for Free. */
  bytes: number;
  budget: number;
  /** Share of the room used, rounded UP (100 % never hides an overflow). */
  percent: number;
  fits: boolean;
}

/**
 * How much of the checkout's room for quantity tiers `sets` take: exactly
 * core's measure (buildShopFunctionConfigWorstCase `tiers`: JSON of
 * buildTiersPayload, for the stored AND the Free-gated config — Free counts a
 * whole-cart set per product, 3 B longer). Pure and client-safe: the screen
 * shows it live, the server refuses a save over the cap with it (audit, cap
 * 550 B; tests pin it to core's own number).
 */
export function tierPayloadUse(sets: readonly TierSet[]): TierPayloadUse {
  const bytesOf = (tiers: TiersModule) => new TextEncoder().encode(JSON.stringify(buildTiersPayload(tiers))).length;
  const stored: TiersModule = { sets: sets.map((s) => JSON.parse(JSON.stringify(s)) as TierSet) };
  const base = createDefaultConfig();
  const free = gateConfigForPlan({ ...base, modules: { ...base.modules, tiers: stored } }, "free").config.modules.tiers;
  const bytes = Math.max(bytesOf(stored), bytesOf(free));
  const budget = CONFIG_LIMITS.tierPayloadBytes;
  return { bytes, budget, percent: Math.ceil((bytes * 100) / budget), fits: bytes <= budget };
}

// --- Wording ------------------------------------------------------------------------------------------

/** The view as the core describer reads it (a percent break, or an amount per currency). */
function describable(set: TierSetView): { breaks: DescribableTierBreak[] } {
  return {
    breaks: set.breaks.map((b) => (b.kind === "percent" ? { minQty: b.minQty, percent: b.percent ?? 0 } : { minQty: b.minQty, amountOff: { ...b.amount } })),
  };
}

/**
 * The set's state line (§17, §17a: core describeTierSet, the same formatter the
 * engine's explanation uses): "Od 3 ks −10 %, od 5 ks −15 %"; amounts in the
 * market currencies (`currencies`), those without a value named (MKT-1); no set
 * or no break → core's "Bez množstevních slev".
 */
export function tierSummary(set: TierSetView | null, tr: Translator, currencies?: readonly string[], labels?: Readonly<Record<string, string>>): string {
  return describeTierSet(set ? describable(set) : { breaks: [] }, { locale: tr.locale, ...(currencies ? { currencies } : {}), ...(labels ? { labels } : {}) });
}

/** One break in words (core describeTierBreak), in one currency when given. */
export function tierBreakText(b: TierBreakView, tr: Translator, currency?: string): string {
  const d: DescribableTierBreak = b.kind === "percent" ? { minQty: b.minQty, percent: b.percent ?? 0 } : { minQty: b.minQty, amountOff: { ...b.amount } };
  return describeTierBreak(d, { locale: tr.locale, ...(currency ? { currency } : {}) });
}

/** "Celý obchod" · "3 produkty · 2 kolekce". */
export function scopeSummary(scope: TierScopeView, tr: Translator): string {
  if (scope.kind === "global") return tr.t("tiers.scope.global");
  const parts: string[] = [];
  if (scope.products.length > 0) parts.push(tr.tp("count.product", scope.products.length));
  if (scope.collections.length > 0) parts.push(tr.tp("count.collection", scope.collections.length));
  return parts.length > 0 ? parts.join(" · ") : tr.t("tiers.scope.empty");
}

/**
 * An exception's name in the list (kolo 3, bod 7): what it is for — the first two picked names, then "a další N".
 * Products first, then collections (the order the page lists them in); nothing picked yet = "Zatím nic nevybráno".
 */
export function exceptionTitle(scope: TierScopeView, tr: Translator): string {
  if (scope.kind === "global") return tr.t("tiers.scope.global");
  const names = [
    ...scope.products.map((p) => p.title.trim() || tr.t("common.untitledProduct")),
    ...scope.collections.map((c) => c.title.trim() || tr.t("common.untitledCollection")),
  ];
  if (names.length === 0) return tr.t("tiers.scope.empty");
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? tr.t("tiers.pro.titleMore", { names: shown, n: names.length - 2 }) : shown;
}

/** How the set counts items, in words. */
export function countLabel(mode: TierCountMode, tr: Translator): string {
  return tr.t(mode === "line" ? "tiers.count.line" : mode === "product" ? "tiers.count.product" : "tiers.count.cart");
}

/**
 * MKT-1: currencies of the enabled markets that an amount break of `set` has no
 * value for (the break is not offered there), with the markets' names and the
 * breaks it concerns. Percent breaks apply in every currency.
 */
export function missingCurrencies(set: TierSetView, currencies: readonly CurrencyView[]): { currency: string; markets: string[]; minQty: number[] }[] {
  const out: { currency: string; markets: string[]; minQty: number[] }[] = [];
  for (const view of currencies) {
    const minQty = set.breaks.filter((b) => b.kind === "amount" && b.amount[view.code] === undefined).map((b) => b.minQty);
    if (minQty.length > 0) out.push({ currency: view.code, markets: view.markets.map((m) => m.name), minQty });
  }
  return out;
}

// --- Preview (the storefront block's arithmetic, K6) ----------------------------------------------------

/** The example the preview shows before anything is saved (labelled "Ukázka", never the shop's data — §12, §15a). */
export const TIERS_SAMPLE_SET: TierSetView = {
  id: "sample",
  scope: { kind: "global" },
  countAcross: "product",
  breaks: [
    { minQty: 3, kind: "percent", percent: 10, amount: {} },
    { minQty: 5, kind: "percent", percent: 15, amount: {} },
  ],
};

export interface PreviewRow {
  minQty: number;
  active: boolean;
  /** The block hides a break that saves nothing (a percent the margin ceiling cut to 0). */
  hidden: boolean;
  /** What the row says it saves: the percent (after the ceiling, one decimal) or the amount per item (the block's discount `d`). */
  save: { kind: "percent"; percent: number } | { kind: "amount"; amount: number };
  /** The item's price at this break (price − d). */
  unitPrice: number;
}

export interface TiersPreviewModel {
  /** Breaks offered in the preview currency (MKT-1), in the set's order. */
  rows: PreviewRow[];
  /** The break that applies at the count (its minimum), or null. */
  active: number | null;
  /** The per-item figure of the live line: price − floor(line discount / quantity). */
  unitPrice: number;
  /** The live line after the discount: price × quantity − line discount. */
  total: number;
  /** The nearest higher break that lowers the per-item price, and how many more items reach it; null at the top. */
  next: { minQty: number; add: number; unitPrice: number } | null;
  /** Nothing is saved at any break: the block renders `data-state="empty"` (hidden). */
  empty: boolean;
}

/**
 * The block's table and live line — a port of the storefront's own pure logic
 * (extensions/won-discounts-storefront/assets/won-discounts-tiers-core.js
 * `compute`, the same steps as blocks/quantity_tiers.liquid; tests/ui/
 * tiers-preview-parity.test.ts runs both on the same fixtures, so they cannot
 * drift):
 *   per item (the rows) d = floor(pct % × price), or the amount, capped by the
 *     per-item ceiling floor(price × max / 100) and the price (a capped percent
 *     row says the percent it really gives);
 *   the count = quantity + items already in the cart counted toward the tier
 *     (the admin preview has no cart: `inCart` 0); the active break is the
 *     highest offered minimum ≤ count;
 *   the live line like the engine: a percent rounds ONCE per line,
 *     round(price × qty × pct / 100), capped by qty × the per-item ceiling
 *     (audit P2-1: the engine's floor is per item); an amount is d × qty; per
 *     item = price − floor(line / qty);
 *   next = the nearest higher break whose row price is below that per-item price.
 * Units: the storefront's (Liquid money units, major × 100) — previewTiersLiquid
 * converts from minor units. `maxPercent` = the margin ceiling (100 = none).
 */
export function previewTiers(
  set: TierSetView,
  opts: { unitPrice: number; currency: string; quantity: number; maxPercent?: number; inCart?: number },
): TiersPreviewModel {
  const price = Math.max(0, Math.round(opts.unitPrice));
  const max = Math.min(100, Math.max(0, opts.maxPercent ?? 100));
  // The per-item ceiling of a variant without a cost price (K6): floor(price × max / 100).
  const cap = Math.floor((price * max) / 100);
  const qty = Math.max(1, Math.floor(opts.quantity));
  const count = qty + Math.max(0, Math.floor(opts.inCart ?? 0));
  const rows: (PreviewRow & { d: number; pct: number | null })[] = [];
  for (const b of set.breaks) {
    if (!(b.minQty > 0)) continue;
    let d: number;
    let pct: number | null = null;
    if (b.kind === "percent") {
      pct = b.percent ?? 0;
      d = Math.floor((price * pct) / 100);
    } else {
      const off = b.amount[opts.currency];
      if (off === undefined) continue;
      d = off;
    }
    const full = d;
    d = Math.max(0, Math.min(d, cap, price));
    // A row the ceiling lowered says the percent it really gives (the block's rule).
    const shown = pct === null ? null : d >= full ? pct : Math.min(pct, max);
    rows.push({
      minQty: b.minQty,
      active: false,
      hidden: d <= 0,
      save: shown !== null ? { kind: "percent", percent: Math.round(shown * 10) / 10 } : { kind: "amount", amount: d },
      unitPrice: price - d,
      d,
      pct,
    });
  }
  let active: (typeof rows)[number] | null = null;
  for (const row of rows) if (row.minQty <= count && (!active || row.minQty > active.minQty)) active = row;
  let line = 0;
  if (active) {
    // Like the engine: a percent rounds once per line; the margin allows quantity × the per-item ceiling (audit P2-1).
    if (active.pct === null) line = active.d * qty;
    else line = Math.max(0, Math.min(Math.round((price * qty * active.pct) / 100), cap * qty, price * qty));
  }
  const unit = price - Math.floor(line / qty);
  let next: (typeof rows)[number] | null = null;
  for (const row of rows) if (row.minQty > count && row.unitPrice < unit && (!next || row.minQty < next.minQty)) next = row;
  return {
    rows: rows.map((row) => ({
      minQty: row.minQty,
      active: active !== null && row.minQty === active.minQty,
      hidden: row.hidden,
      save: row.save,
      unitPrice: row.unitPrice,
    })),
    active: active ? active.minQty : null,
    unitPrice: unit,
    total: price * qty - line,
    next: next ? { minQty: next.minQty, add: next.minQty - count, unitPrice: next.unitPrice } : null,
    empty: !rows.some((r) => r.d > 0),
  };
}

/** Minor units of `currency` → the storefront's Liquid money units (major × 100, whatever the exponent). */
export function liquidFactor(currency: string): number {
  return 10 ** (2 - currencyExponent(currency));
}

/** previewTiers on a price and amounts in minor units: computed in Liquid money units, like the storefront. */
export function previewTiersLiquid(set: TierSetView, opts: { unitPrice: number; currency: string; quantity: number; maxPercent?: number }): TiersPreviewModel {
  const f = liquidFactor(opts.currency);
  const scaled: TierSetView =
    f === 1
      ? set
      : {
          ...set,
          breaks: set.breaks.map((b) => {
            const off = b.amount[opts.currency];
            return off === undefined ? b : { ...b, amount: { ...b.amount, [opts.currency]: off * f } };
          }),
        };
  return previewTiers(scaled, { ...opts, unitPrice: opts.unitPrice * f });
}

// --- Money like the storefront ------------------------------------------------------------------------------

/** The placeholders of a Shopify money format → [thousands, decimal mark, decimals] (won-discounts-tiers-core.js FORMATS). */
const MONEY_FORMATS: Readonly<Record<string, readonly [string, string, number]>> = {
  amount: [",", ".", 2],
  amount_no_decimals: [",", ".", 0],
  amount_with_comma_separator: [".", ",", 2],
  amount_no_decimals_with_comma_separator: [".", ",", 0],
  amount_with_space_separator: [" ", ",", 2],
  amount_no_decimals_with_space_separator: [" ", ".", 0],
  amount_with_period_and_space_separator: [" ", ".", 2],
  amount_with_apostrophe_separator: ["'", ".", 2],
};

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  curren: "¤",
  dollar: "$",
};

/** HTML entities as a browser shows them (a money format like `&euro;{{amount}}` is HTML, Liquid prints it as markup). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * An amount in Liquid money units (major × 100) as the storefront writes it:
 * the shop's money format (every placeholder, like the block's `money()`),
 * HTML stripped and entities decoded (what the page shows). Without a usable
 * format: the admin's own money format (core formatMoney).
 */
export function formatLiquidMoney(cents: number, currency: string, format: string | null | undefined, locale: Locale): string {
  const text = typeof format === "string" ? decodeEntities(format.replace(/<[^>]*>/g, "")).trim() : "";
  let used = false;
  const out = text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) => {
    const f = MONEY_FORMATS[key];
    if (!f) return whole;
    used = true;
    const [whole_, fraction] = (Math.round(cents) / 100).toFixed(f[2]).split(".");
    return (whole_ ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, f[0]) + (f[2] && fraction ? f[1] + fraction : "");
  });
  return used ? out : formatMoney(cents / liquidFactor(currency), currency, locale);
}

/** An amount in minor units of `currency`, written like the storefront (see formatLiquidMoney). */
export function formatShopMoney(minor: number, currency: string, format: string | null | undefined, locale: Locale): string {
  return formatLiquidMoney(minor * liquidFactor(currency), currency, format, locale);
}

// --- The table on the product page and the storefront config --------------------------------------------------

/**
 * A product template as the merchant knows it from Shopify's template picker: „bundle“, not the file name
 * "product.bundle" (audit 6 Oct 2026, slovníček).
 */
function templateNames(alternates: readonly string[], tr: Translator): string {
  return tr.list(alternates.map((name) => `„${name.replace(/^product\./, "")}“`));
}

/** The alternate product templates that also have the table ("Je i u produktů se šablonou „bundle“."), or null. */
export function blockAlternatesText(block: TiersBlockView, tr: Translator): string | null {
  return block.state === "on" && block.alternates && block.alternates.length > 0 ? tr.t("tiers.block.alsoAlternate", { templates: templateNames(block.alternates, tr) }) : null;
}

/** Is the table on the live theme's product page (read_themes)? One sentence (§11d, §12). */
export function blockText(block: TiersBlockView, tr: Translator): string {
  switch (block.state) {
    case "on":
      return tr.t("tiers.block.on", { theme: block.themeName || "—" });
    case "off":
      // Only in an alternate template: most products do not use it (audit P3-8).
      return block.alternates && block.alternates.length > 0
        ? tr.t("tiers.block.onlyAlternate", { templates: templateNames(block.alternates, tr) })
        : tr.t("tiers.block.off");
    case "no_scope":
      return tr.t("tiers.block.noScope");
    case "unknown":
    default:
      return tr.t("tiers.block.unknown");
  }
}

/** The storefront config metafield (K5) in words. */
export function storefrontSyncText(view: StorefrontSyncView, tr: Translator): string {
  switch (view.state) {
    case "synced":
      return tr.t("tiers.storefront.synced", { date: view.at ? formatDateTime(view.at, tr.locale) : "—" });
    case "pending":
      return tr.t("tiers.storefront.pending");
    case "failed":
      // No older storefront config on the site: there is no "previous table" to fall back to (review fix 7).
      return tr.t(view.previous === false ? "tiers.storefront.failedFirst" : "tiers.storefront.failed", { date: formatDateTime(view.at, tr.locale) });
    case "missing":
      return tr.t("tiers.storefront.missing");
    case "unknown":
    default:
      return tr.t("tiers.storefront.unknown");
  }
}
