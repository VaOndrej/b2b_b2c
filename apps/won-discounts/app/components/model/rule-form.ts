// The rule editor's form ⇄ DiscountRule. ONE parser for both sides (SEC-1, §2):
//   - the server action runs it on the submitted FormData and saves only what
//     it returns (the browser is never trusted: unknown currencies, ids, enums
//     and Pro fields without entitlement are dropped or refused here);
//   - the editor runs the very same function on `new FormData(form)` on every
//     native input/change event, so the live summary (§17b) can never describe
//     something different from what Save would store.
// The core sanitizer (saveConfig → sanitizeConfig) still runs after this as the
// last line of defence (DATA-2).

import {
  CONFIG_LIMITS,
  DISCOUNT_METHODS,
  DISCOUNT_TARGET_KINDS,
  DISCOUNT_VALUE_KINDS,
  MINIMUM_SCOPES,
  type DiscountMethod,
  type DiscountRule,
  type DiscountTarget,
  type DiscountTargetKind,
  type DiscountValueKind,
  type MinimumScope,
} from "@won/core/discounts/config";
import { shopDayStart } from "@won/core/discounts/function-payload";

import { fromMinorUnits, toMinorUnits } from "@won/core/discounts/money";

import { translator, type Locale } from "../../i18n";
import { ruleDays, writtenDays } from "./describe";
import { COLLECTION_GID, PRODUCT_GID, VARIANT_GID, splitCodes } from "./ids";
import type { FieldError } from "./types";

export const NAME_MAX = 200;

/** Form field names. Per-currency fields carry the ISO code: `amount_CZK`, `min_EUR`. */
export const FIELD = {
  name: "name",
  enabled: "enabled",
  valueKind: "valueKind",
  percent: "percent",
  amount: (currency: string) => `amount_${currency}`,
  target: "target",
  productIds: "productIds",
  variantIds: "variantIds",
  collectionIds: "collectionIds",
  method: "method",
  codes: "codes",
  minimum: (currency: string) => `min_${currency}`,
  minQty: "minQty",
  /** Where the minimum is measured: "cart" (the whole cart) or "entitled" (the rule's products). */
  minScope: "minScope",
  /** The rule as the editor loaded it (ruleVersionToken): a save over a rule changed since is refused (F12). */
  ruleVersion: "ruleVersion",
  startDate: "startDate",
  endDate: "endDate",
  usageLimit: "usageLimit",
  oncePerCustomer: "oncePerCustomer",
  markets: "markets",
  combinesWith: "combinesWith",
  /** A stored value in a currency whose market is off: kept unless listed here (§14a). */
  dropCurrency: "dropCurrency",
} as const;

/**
 * What a merchant typed ("100", "100,50", "1 000.5") in `currency` → minor units
 * via the engine's own converter. Empty → null ("no value", not zero); negative
 * or malformed → NaN (the form reports it).
 */
export function parseMoneyInput(raw: string, currency: string): number | null {
  const text = raw.replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (text === "") return null;
  const minor = toMinorUnits(text, currency);
  return minor === null ? Number.NaN : minor;
}

/** Minor units → the editable field value ("100" or "100.5"). */
export function minorToInput(minor: number, currency: string): string {
  const text = fromMinorUnits(minor, currency);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

export interface FormDataLike {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

export interface RuleFormContext {
  /** The rule id: the server's (existing rule or a fresh one), never the form's. */
  id: string;
  /** Currencies of the shop's markets: the only per-currency fields read. */
  currencies: readonly string[];
  /** Shop IANA time zone for schedule days (null → UTC, and the editor says so). */
  timezone: string | null;
  /** Server-derived Pro entitlement (BILL-1). Without it Pro fields are not writable. */
  pro: boolean;
  /** The stored rule being edited (keeps fields the form does not own). */
  existing?: DiscountRule | null;
  /** Won market handles (Pro market targeting). */
  marketHandles?: readonly string[];
  /** Every OTHER rule: code uniqueness and Pro combinations. */
  otherRules?: readonly { id: string; name: string; codes?: readonly string[] }[];
}

export interface RuleFormResult {
  /** Always a complete rule (the live summary renders drafts too); save only when errors is empty. */
  rule: DiscountRule;
  errors: FieldError[];
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INT_RE = /^\d{1,9}$/;

function isOneOf<T extends string>(v: string, list: readonly T[]): v is T {
  return (list as readonly string[]).includes(v);
}

/** A real calendar day `YYYY-MM-DD`. */
export function isCalendarDate(v: string): boolean {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The first instant of `date` in the shop's zone as an ISO date-time with its
 * offset ("2026-11-01T00:00:00+01:00"), the shape a rule schedule stores —
 * core `shopDayStart`, the same function the sync reads the days back with
 * (F1 concern 4): in zones whose clocks skip midnight (America/Santiago on
 * its spring-forward day) the day starts at 01:00, never at 23:00 of the day
 * before. An unknown zone falls back to UTC (the editor then says the days
 * are UTC days).
 */
export function shopMidnightIso(date: string, timeZone: string | null): string {
  if (!timeZone) return `${date}T00:00:00Z`;
  try {
    return shopDayStart(date, timeZone);
  } catch {
    return `${date}T00:00:00Z`;
  }
}

/** Deterministic JSON (sorted keys) for comparing rules. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * A short token of a stored rule (FNV-1a of its canonical JSON). The editor
 * sends the token of the rule it loaded; the server refuses a save or delete
 * when the stored rule no longer has it — someone else changed this rule
 * meanwhile (F12, `base_changed`), never a silent overwrite.
 */
export function ruleVersionToken(rule: DiscountRule): string {
  const text = canonical(rule);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `rv${hash.toString(16).padStart(8, "0")}${text.length.toString(16)}`;
}

/** Today's date in the shop's zone (UTC when unknown). */
export function shopToday(timeZone: string | null, now: Date = new Date()): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      if (DATE_RE.test(parts)) return parts;
    } catch {
      // unknown zone → UTC below
    }
  }
  return now.toISOString().slice(0, 10);
}

export function readRuleForm(form: FormDataLike, ctx: RuleFormContext): RuleFormResult {
  const errors: FieldError[] = [];
  const err = (field: string, key: FieldError["key"], params?: FieldError["params"]) => errors.push({ field, key, params });
  const str = (name: string): string => {
    const v = form.get(name);
    return typeof v === "string" ? v : "";
  };
  const all = (name: string): string[] =>
    form.getAll(name).filter((v): v is string => typeof v === "string");
  const checked = (name: string) => ["on", "true", "1"].includes(str(name));
  const existing = ctx.existing ?? null;
  const dropped = new Set(all(FIELD.dropCurrency).map((c) => c.trim().toUpperCase()));
  const keptOutside = (stored: Readonly<Record<string, number>> | undefined): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [c, minor] of Object.entries(stored ?? {})) {
      if (!ctx.currencies.includes(c) && !dropped.has(c) && typeof minor === "number") out[c] = minor;
    }
    return out;
  };

  // Name
  const name = str(FIELD.name).trim().slice(0, NAME_MAX);
  if (!name) err(FIELD.name, "editor.error.name");

  // Value
  const kindRaw = str(FIELD.valueKind) || "percentage";
  let valueKind: DiscountValueKind = "percentage";
  if (isOneOf(kindRaw, DISCOUNT_VALUE_KINDS)) valueKind = kindRaw;
  else err(FIELD.valueKind, "result.invalid");

  let value: DiscountRule["value"];
  if (valueKind === "freeShipping") {
    value = { kind: "freeShipping" };
  } else if (valueKind === "fixed") {
    const amount: Record<string, number> = {};
    let invalid = false;
    for (const currency of ctx.currencies) {
      const minor = parseMoneyInput(str(FIELD.amount(currency)), currency);
      if (minor === null) continue;
      if (Number.isNaN(minor) || minor <= 0) {
        invalid = true;
        err(FIELD.amount(currency), "editor.error.amount");
        continue;
      }
      amount[currency] = minor;
    }
    if (!invalid && Object.keys(amount).length === 0) err("amount", "editor.error.amountNone");
    // Values in currencies whose market is off are not form fields; they stay
    // stored unless the merchant removes them explicitly (never a silent drop).
    if (existing?.value.kind === "fixed") Object.assign(amount, keptOutside(existing.value.amount));
    value = { kind: "fixed", amount };
  } else {
    // "Zadej 1 až 100 %": the copy and the parser agree (decimals like 12,5 are fine).
    const percent = Number(str(FIELD.percent).trim().replace(",", "."));
    const valid = str(FIELD.percent).trim() !== "" && Number.isFinite(percent) && percent >= 1 && percent <= 100;
    if (!valid) err(FIELD.percent, "editor.error.percent");
    value = { kind: "percentage", percent: valid ? Math.round(percent * 100) / 100 : 0 };
  }

  // Target (free shipping always targets shipping)
  let target: DiscountTarget = { kind: "order" };
  if (valueKind === "freeShipping") {
    target = { kind: "shipping" };
  } else {
    const targetRaw = str(FIELD.target) || "order";
    let kind: DiscountTargetKind = "order";
    if (isOneOf(targetRaw, DISCOUNT_TARGET_KINDS)) kind = targetRaw;
    else err(FIELD.target, "result.invalid");
    if (kind === "products") {
      const productIds = [...new Set(all(FIELD.productIds).filter((id) => PRODUCT_GID.test(id)))].slice(0, CONFIG_LIMITS.listItems);
      const variantIds = [...new Set(all(FIELD.variantIds).filter((id) => VARIANT_GID.test(id)))].slice(0, CONFIG_LIMITS.listItems);
      if (productIds.length === 0 && variantIds.length === 0) err(FIELD.target, "editor.error.products");
      target = { kind: "products", productIds, variantIds };
    } else if (kind === "collections") {
      const ids = [...new Set(all(FIELD.collectionIds).filter((id) => COLLECTION_GID.test(id)))].slice(0, CONFIG_LIMITS.listItems);
      if (ids.length === 0) err(FIELD.target, "editor.error.collections");
      target = { kind: "collections", ids };
    } else {
      target = { kind };
    }
  }

  // Method + codes
  const methodRaw = str(FIELD.method) || "automatic";
  let method: DiscountMethod = "automatic";
  if (isOneOf(methodRaw, DISCOUNT_METHODS)) method = methodRaw;
  else err(FIELD.method, "result.invalid");

  const rule: DiscountRule = { id: ctx.id, enabled: checked(FIELD.enabled), name, method, value, target };

  if (method === "code") {
    const codes = splitCodes(str(FIELD.codes));
    const tooLong = codes.find((c) => c.length > CONFIG_LIMITS.codeLength);
    const taken = new Set((ctx.otherRules ?? []).flatMap((r) => (r.codes ?? []).map((c) => c.toUpperCase())));
    const clash = codes.find((c) => taken.has(c));
    if (codes.length === 0) err(FIELD.codes, "editor.error.codes");
    else if (tooLong) err(FIELD.codes, "editor.error.codeLength", { max: CONFIG_LIMITS.codeLength });
    else if (codes.length > CONFIG_LIMITS.codesPerRule) err(FIELD.codes, "editor.error.tooManyCodes", { max: CONFIG_LIMITS.codesPerRule });
    else if (clash) err(FIELD.codes, "editor.error.codeTaken", { code: clash });
    rule.codes = codes.filter((c) => c.length <= CONFIG_LIMITS.codeLength).slice(0, CONFIG_LIMITS.codesPerRule);
  }

  // Minimum (per currency) + minimum quantity
  const subtotal: Record<string, number> = {};
  for (const currency of ctx.currencies) {
    const minor = parseMoneyInput(str(FIELD.minimum(currency)), currency);
    if (minor === null) continue;
    if (Number.isNaN(minor) || minor < 0) {
      err(FIELD.minimum(currency), "editor.error.amount");
      continue;
    }
    subtotal[currency] = minor;
  }
  Object.assign(subtotal, keptOutside(existing?.minimum?.subtotal));
  const minQtyRaw = str(FIELD.minQty).trim();
  let quantity = 0;
  if (minQtyRaw !== "") {
    if (INT_RE.test(minQtyRaw)) quantity = Number(minQtyRaw);
    else err(FIELD.minQty, "editor.error.minQty");
  }
  if (Object.keys(subtotal).length > 0 || quantity > 0) {
    rule.minimum = {};
    if (Object.keys(subtotal).length > 0) rule.minimum.subtotal = subtotal;
    if (quantity > 0) rule.minimum.quantity = quantity;
    // Where it is measured (F1 concern 3): the form's choice, else what was
    // stored (an edit never resets "z vybraných produktů" to the cart), else cart.
    const scopeRaw = str(FIELD.minScope);
    const scope: MinimumScope = isOneOf(scopeRaw, MINIMUM_SCOPES) ? scopeRaw : (existing?.minimum?.scope ?? "cart");
    rule.minimum.scope = scope;
  }

  // Schedule: whole shop-local days, end day inclusive
  const start = str(FIELD.startDate).trim();
  const end = str(FIELD.endDate).trim();
  const startOk = start === "" || isCalendarDate(start);
  const endOk = end === "" || isCalendarDate(end);
  if (!startOk) err(FIELD.startDate, "editor.error.date");
  if (!endOk) err(FIELD.endDate, "editor.error.date");
  if (startOk && endOk && start && end && end < start) err(FIELD.endDate, "editor.error.schedule");
  if (startOk && endOk && (start || end) && !(start && end && end < start)) {
    rule.schedule = {};
    if (start) rule.schedule.startsAt = shopMidnightIso(start, ctx.timezone);
    if (end) rule.schedule.endsAt = shopMidnightIso(addDays(end, 1), ctx.timezone);
  }

  // Limits: Shopify supports them on code discounts only
  if (method === "code") {
    const usageRaw = str(FIELD.usageLimit).trim();
    const limits: NonNullable<DiscountRule["limits"]> = {};
    if (usageRaw !== "") {
      if (INT_RE.test(usageRaw) && Number(usageRaw) >= 1) limits.usageLimit = Number(usageRaw);
      else err(FIELD.usageLimit, "editor.error.usage");
    }
    if (checked(FIELD.oncePerCustomer)) limits.oncePerCustomer = true;
    if (Object.keys(limits).length > 0) rule.limits = limits;
  }

  // Pro: targeting + per-rule combinations. Writable only with entitlement
  // (BILL-1, the UI lock is a courtesy); otherwise the stored values stay as
  // they are — turning Pro off never erases the setup (§14a).
  if (ctx.pro) {
    const known = new Set(ctx.marketHandles ?? []);
    const markets = [...new Set(all(FIELD.markets).filter((h) => known.has(h)))];
    const segments = existing?.targeting?.segments;
    if (markets.length > 0 || (segments && segments.length > 0)) {
      rule.targeting = {};
      if (segments && segments.length > 0) rule.targeting.segments = [...segments];
      if (markets.length > 0) rule.targeting.markets = markets;
    }
    const others = new Set((ctx.otherRules ?? []).map((r) => r.id).filter((id) => id !== ctx.id));
    const ruleIds = [...new Set(all(FIELD.combinesWith).filter((id) => others.has(id)))];
    if (ruleIds.length > 0) rule.combinesWith = { ruleIds };
  } else {
    if (existing?.targeting) rule.targeting = structuredCloneJson(existing.targeting);
    if (existing?.combinesWith) rule.combinesWith = structuredCloneJson(existing.combinesWith);
  }

  // Fields the form does not own survive an edit.
  if (existing?.priority !== undefined) rule.priority = existing.priority;
  if (existing?.origin) rule.origin = { nativeId: existing.origin.nativeId };

  return { rule, errors };
}

function structuredCloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// --- Form defaults (rule → field values) ---------------------------------------------

export interface OutsideCurrencyValue {
  currency: string;
  /** Stored fixed amount in minor units, if any. */
  amount: number | null;
  /** Stored minimum subtotal in minor units, if any. */
  minimum: number | null;
}

export interface RuleFormDefaults {
  name: string;
  enabled: boolean;
  valueKind: DiscountValueKind;
  percent: string;
  /** Editable amounts, one per shop market currency. */
  amounts: Record<string, string>;
  target: DiscountTargetKind;
  productIds: string[];
  variantIds: string[];
  collectionIds: string[];
  method: DiscountMethod;
  codes: string;
  minimums: Record<string, string>;
  minQty: string;
  /** Where the minimum is measured ("cart" for new rules and rules without one). */
  minScope: MinimumScope;
  startDate: string;
  endDate: string;
  usageLimit: string;
  oncePerCustomer: boolean;
  markets: string[];
  combinesWith: string[];
  /** Stored values in currencies whose market is off: shown read-only, kept on save (§14a). */
  outside: OutsideCurrencyValue[];
  /** The same values keyed by form field name (what a submit of the untouched form sends). */
  fields: Record<string, string | string[] | boolean>;
}

/**
 * Field values for a rule. `timezone` (the shop's) turns the stored schedule into
 * shop-local days exactly like the sync does; without it, the written days.
 */
export function ruleFormDefaults(rule: DiscountRule, currencies: readonly string[], timezone?: string | null): RuleFormDefaults {
  const amount = rule.value.kind === "fixed" ? rule.value.amount : {};
  const subtotal = rule.minimum?.subtotal ?? {};
  const amounts: Record<string, string> = {};
  const minimums: Record<string, string> = {};
  for (const c of currencies) {
    amounts[c] = typeof amount[c] === "number" ? minorToInput(amount[c], c) : "";
    minimums[c] = typeof subtotal[c] === "number" ? minorToInput(subtotal[c], c) : "";
  }
  const outsideCodes = [...new Set([...Object.keys(amount), ...Object.keys(subtotal)])].filter((c) => !currencies.includes(c));
  const outside: OutsideCurrencyValue[] = outsideCodes.map((c) => ({
    currency: c,
    amount: typeof amount[c] === "number" ? amount[c] : null,
    minimum: typeof subtotal[c] === "number" ? subtotal[c] : null,
  }));
  const days = timezone === undefined ? writtenDays(rule) : ruleDays(rule, timezone);
  const target = rule.target;
  const d: Omit<RuleFormDefaults, "fields"> = {
    name: rule.name,
    enabled: rule.enabled,
    valueKind: rule.value.kind,
    percent: rule.value.kind === "percentage" ? String(rule.value.percent) : "10",
    amounts,
    target: target.kind,
    productIds: target.kind === "products" ? [...target.productIds] : [],
    variantIds: target.kind === "products" ? [...target.variantIds] : [],
    collectionIds: target.kind === "collections" ? [...target.ids] : [],
    method: rule.method,
    codes: (rule.codes ?? []).join("\n"),
    minimums,
    minQty: rule.minimum?.quantity ? String(rule.minimum.quantity) : "",
    minScope: rule.minimum?.scope ?? "cart",
    startDate: days.startsOn ?? "",
    endDate: days.endsOn ?? "",
    usageLimit: rule.limits?.usageLimit ? String(rule.limits.usageLimit) : "",
    oncePerCustomer: rule.limits?.oncePerCustomer === true,
    markets: [...(rule.targeting?.markets ?? [])],
    combinesWith: [...(rule.combinesWith?.ruleIds ?? [])],
    outside,
  };
  const fields: RuleFormDefaults["fields"] = {
    [FIELD.name]: d.name,
    [FIELD.enabled]: d.enabled,
    [FIELD.valueKind]: d.valueKind,
    [FIELD.percent]: d.percent,
    [FIELD.target]: d.target,
    [FIELD.productIds]: d.productIds,
    [FIELD.variantIds]: d.variantIds,
    [FIELD.collectionIds]: d.collectionIds,
    [FIELD.method]: d.method,
    [FIELD.codes]: d.codes,
    [FIELD.minQty]: d.minQty,
    [FIELD.minScope]: d.minScope,
    [FIELD.startDate]: d.startDate,
    [FIELD.endDate]: d.endDate,
    [FIELD.usageLimit]: d.usageLimit,
    [FIELD.oncePerCustomer]: d.oncePerCustomer,
    [FIELD.markets]: d.markets,
    [FIELD.combinesWith]: d.combinesWith,
  };
  for (const c of currencies) {
    fields[FIELD.amount(c)] = amounts[c];
    fields[FIELD.minimum(c)] = minimums[c];
  }
  return { ...d, fields };
}

// --- Recipes (Slevy a kódy → "Nová sleva z receptu") ----------------------------------

export const RECIPE_KEYS = ["percentAll", "amountOff", "freeShipping", "welcomeCode", "blank"] as const;
export type RecipeKey = (typeof RECIPE_KEYS)[number];

export function isRecipeKey(v: unknown): v is RecipeKey {
  return typeof v === "string" && (RECIPE_KEYS as readonly string[]).includes(v);
}

// Suggested amounts per currency (minor units). A suggestion for a currency we
// know, never a converted number (MKT-1): other currencies start empty and the
// editor shows them as "not offered" until the merchant fills them in.
const AMOUNT_OFF: Readonly<Record<string, number>> = { CZK: 10000, EUR: 400, USD: 500, GBP: 400, PLN: 2000 };
const AMOUNT_OFF_MIN: Readonly<Record<string, number>> = { CZK: 100000, EUR: 4000, USD: 5000, GBP: 4000, PLN: 20000 };
const FREE_SHIPPING_MIN: Readonly<Record<string, number>> = { CZK: 150000, EUR: 6000, USD: 7500, GBP: 6000, PLN: 30000 };

function pick(table: Readonly<Record<string, number>>, currencies: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of currencies) if (typeof table[c] === "number") out[c] = table[c];
  return out;
}

/** A pre-filled, valid draft for a recipe (onboarding step 4, "Nová sleva z receptu"). */
export function recipeRule(recipe: RecipeKey, opts: { id: string; locale: Locale; currencies: readonly string[] }): DiscountRule {
  const tr = translator(opts.locale);
  const base = { id: opts.id, enabled: true } as const;
  switch (recipe) {
    case "amountOff":
      return {
        ...base,
        name: tr.t("recipe.amountOff.name"),
        method: "automatic",
        value: { kind: "fixed", amount: pick(AMOUNT_OFF, opts.currencies) },
        target: { kind: "order" },
        minimum: { subtotal: pick(AMOUNT_OFF_MIN, opts.currencies) },
      };
    case "freeShipping":
      return {
        ...base,
        name: tr.t("recipe.freeShipping.name"),
        method: "automatic",
        value: { kind: "freeShipping" },
        target: { kind: "shipping" },
        minimum: { subtotal: pick(FREE_SHIPPING_MIN, opts.currencies) },
      };
    case "welcomeCode":
      return {
        ...base,
        name: tr.t("recipe.welcomeCode.name"),
        method: "code",
        codes: [tr.t("recipe.welcomeCode.code")],
        value: { kind: "percentage", percent: 10 },
        target: { kind: "order" },
        limits: { oncePerCustomer: true },
      };
    case "blank":
      return {
        ...base,
        name: tr.t("recipe.blank.name"),
        method: "automatic",
        value: { kind: "percentage", percent: 10 },
        target: { kind: "order" },
      };
    case "percentAll":
    default:
      return {
        ...base,
        name: tr.t("recipe.percentAll.name"),
        method: "automatic",
        value: { kind: "percentage", percent: 10 },
        target: { kind: "order" },
      };
  }
}

/** A fresh rule id, valid for the config (`[A-Za-z0-9_-]{1,64}`). */
export function newRuleId(): string {
  return `r_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
