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

import { CONFIG_LIMITS, type TierBreak, type TierSet } from "@won/core/discounts/config";
import { describeTierBreak, describeTierSet, formatMoney, type DescribableTierBreak } from "@won/core/discounts/describe";
import { currencyExponent } from "@won/core/discounts/money";

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

export interface TiersFormContext {
  /** Currencies of the enabled markets: the amount fields the screen shows. */
  currencies: readonly string[];
  /** Currencies with stored values whose market is off: kept as hidden fields (§14a), read too. */
  keptCurrencies?: readonly string[];
  /** Known product / collection titles (Shopify's), so the draft keeps showing names. Never read from the form. */
  titles?: ReadonlyMap<string, string>;
}

export interface TiersFormResult {
  /** What the form says, as far as it parses (the live draft; on the server: what is saved when `errors` is empty). */
  sets: TierSetView[];
  errors: FieldError[];
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
  const currencies = [...new Set([...ctx.currencies, ...(ctx.keptCurrencies ?? [])])].filter((c) => /^[A-Z]{3}$/.test(c));
  const title = (id: string) => ctx.titles?.get(id) ?? "";
  const ids = uniqueStrings(form.getAll(F.set));
  if (ids.some((id) => !SET_ID.test(id))) errors.push({ field: F.set, key: "tiers.error.set" });
  const valid = ids.filter((id) => SET_ID.test(id));
  if (valid.length > CONFIG_LIMITS.tierSets) errors.push({ field: F.set, key: "tiers.error.tooManySets", params: { max: CONFIG_LIMITS.tierSets } });

  for (const sid of valid.slice(0, CONFIG_LIMITS.tierSets)) {
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
  return { sets, errors };
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
export function tierSummary(set: TierSetView | null, tr: Translator, currencies?: readonly string[]): string {
  return describeTierSet(set ? describable(set) : { breaks: [] }, { locale: tr.locale, ...(currencies ? { currencies } : {}) });
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
  /** What the row says it saves: the percent (after the ceiling, one decimal) or the amount per item (minor units). */
  save: { kind: "percent"; percent: number } | { kind: "amount"; amount: number };
  /** The item's price at this break, minor units. */
  unitPrice: number;
}

export interface TiersPreviewModel {
  /** Breaks offered in the preview currency (MKT-1), in the set's order. */
  rows: PreviewRow[];
  /** The break that applies at `quantity` (its minimum), or null. */
  active: number | null;
  /** The item's price at `quantity`. */
  unitPrice: number;
  /** The next break that lowers the price, and how many more items reach it; null at the top. */
  next: { minQty: number; add: number; unitPrice: number } | null;
  /** Nothing is saved at any break: the block renders `data-state="empty"` (hidden). */
  empty: boolean;
}

/**
 * The block's table at `quantity` items of a product priced `unitPrice` (minor
 * units of `currency`) — step for step what blocks/quantity_tiers.liquid and
 * won-discounts-tiers.js compute (K6): per break the discount per item `d` =
 * round(min(percent, max) % of the price) or the amount in the currency, then
 * capped by the margin ceiling floor(price × max / 100) and the price; the row
 * price is price − d; the active break is the highest minimum the count
 * reaches; the next is the first higher break that lowers the price. `maxPercent`
 * = the margin ceiling (100 = none; the admin preview has no cost price).
 */
export function previewTiers(set: TierSetView, opts: { unitPrice: number; currency: string; quantity: number; maxPercent?: number }): TiersPreviewModel {
  const price = Math.max(0, Math.round(opts.unitPrice));
  const max = Math.min(100, Math.max(0, opts.maxPercent ?? 100));
  const ceiling = Math.floor((price * max) / 100);
  const count = Math.max(1, Math.floor(opts.quantity));
  const rows: PreviewRow[] = [];
  let activeMin = 0;
  let activeD = 0;
  for (const b of set.breaks) {
    if (!(b.minQty > 0)) continue;
    let d: number;
    let save: PreviewRow["save"];
    if (b.kind === "percent") {
      const pct = Math.min(b.percent ?? 0, max);
      d = Math.round((pct * price) / 100);
      save = { kind: "percent", percent: Math.round(pct * 10) / 10 };
    } else {
      const off = b.amount[opts.currency];
      if (off === undefined) continue;
      d = off;
      save = { kind: "amount", amount: 0 };
    }
    d = Math.max(0, Math.min(d, ceiling, price));
    if (save.kind === "amount") save = { kind: "amount", amount: d };
    rows.push({ minQty: b.minQty, active: false, hidden: d <= 0, save, unitPrice: price - d });
    if (b.minQty <= count && b.minQty > activeMin) {
      activeMin = b.minQty;
      activeD = d;
    }
  }
  const unit = price - activeD;
  for (const row of rows) row.active = row.minQty === activeMin;
  const next = rows.find((r) => r.minQty > count && r.unitPrice < unit) ?? null;
  return {
    rows,
    active: activeMin > 0 ? activeMin : null,
    unitPrice: unit,
    next: next ? { minQty: next.minQty, add: next.minQty - count, unitPrice: next.unitPrice } : null,
    empty: !rows.some((r) => !r.hidden),
  };
}

// --- Money like the storefront ------------------------------------------------------------------------------

const MONEY_PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/;

function delimited(cents: number, precision: number, thousands: string, decimal: string): string {
  const fixed = (cents / 100).toFixed(precision);
  const [whole, fraction] = fixed.split(".");
  const grouped = (whole ?? "0").replace(/(\d)(?=(\d\d\d)+(?!\d))/g, `$1${thousands}`);
  return fraction ? `${grouped}${decimal}${fraction}` : grouped;
}

/**
 * An amount as the shop's storefront writes it: the shop's money format
 * (Shopify `{{amount_with_comma_separator}} Kč` etc., Liquid money units =
 * major × 100 whatever the currency's exponent), HTML stripped. Without a usable
 * format: the admin's own money format (core formatMoney).
 */
export function formatShopMoney(minor: number, currency: string, format: string | null | undefined, locale: Locale): string {
  const text = typeof format === "string" ? format.replace(/<[^>]*>/g, "").trim() : "";
  const placeholder = MONEY_PLACEHOLDER.exec(text)?.[1];
  const cents = Math.round(minor * 10 ** (2 - currencyExponent(currency)));
  let value: string | null = null;
  switch (placeholder) {
    case "amount":
      value = delimited(cents, 2, ",", ".");
      break;
    case "amount_no_decimals":
      value = delimited(cents, 0, ",", ".");
      break;
    case "amount_with_comma_separator":
      value = delimited(cents, 2, ".", ",");
      break;
    case "amount_no_decimals_with_comma_separator":
      value = delimited(cents, 0, ".", ",");
      break;
    case "amount_with_apostrophe_separator":
      value = delimited(cents, 2, "'", ".");
      break;
    case "amount_no_decimals_with_space_separator":
      value = delimited(cents, 0, " ", ",");
      break;
    case "amount_with_space_separator":
      value = delimited(cents, 2, " ", ",");
      break;
    case "amount_with_period_and_space_separator":
      value = delimited(cents, 2, " ", ".");
      break;
    default:
      value = null;
  }
  if (value === null) return formatMoney(minor, currency, locale);
  return text.replace(MONEY_PLACEHOLDER, value);
}

// --- The table on the product page and the storefront config --------------------------------------------------

/** Is the table on the live theme's product page (read_themes)? One sentence (§11d, §12). */
export function blockText(block: TiersBlockView, tr: Translator): string {
  switch (block.state) {
    case "on":
      return tr.t("tiers.block.on", { theme: block.themeName || "—" });
    case "off":
      return tr.t("tiers.block.off");
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
      return tr.t("tiers.storefront.failed", { date: formatDateTime(view.at, tr.locale) });
    case "missing":
      return tr.t("tiers.storefront.missing");
    case "unknown":
    default:
      return tr.t("tiers.storefront.unknown");
  }
}
