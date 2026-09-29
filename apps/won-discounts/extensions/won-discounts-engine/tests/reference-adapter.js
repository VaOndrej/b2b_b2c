// @ts-check
// The REFERENCE adapter: the JS function's glue to the TS engine, kept as the
// parity oracle for the Rust function (README.md "Parity", DATA-4: one brain).
// The Rust function (src/) reproduces exactly what this computes:
//
//   function input ─adaptInput→ CartPlanInput ─planCart→ CartPlan
//                  ─emitForNode(role, triggering code)→ NodeEmission
//                  ─mapToFunctionOutput (@won/core function-output.ts)→ function output
//
// Where each input comes from (input queries in src/, T0/C7):
//   - shared config: app-owned SHOP metafield `$app:won_discounts`/`function_config`
//     (`shop.config.jsonValue`); over 10 000 B it arrives as null → the plan is
//     `config_missing` and the node emits nothing;
//   - node variables: the node's own `$app:won_discounts`/`function_vars`
//     (`discount.vars.jsonValue`: role, ruleId, campaignId, varsVersion; its
//     campaignStart/campaignEnd are bound to the query variables, C4);
//   - campaign: `shop.localTime.campaignActive` = dateTimeBetween(start, end);
//   - today: `shop.localTime.date` (shop-local day, schedules are day-granular);
//   - country: `localization.country.isoCode` (Pro market targeting);
//   - per line: `ruleIds` ∪ `variantRuleIds[variant]` + `outlet` from the product
//     metafield `$app:won_discounts`/`product`, the gift tier from the `_won_gift` line
//     attribute (a gift is a property of the cart line, not of the product: the
//     same product bought normally is an ordinary line);
//   - margin protection (MVP 2): the variant's cost price `{cost, cur}` from the
//     variant metafield `$app:won_discounts`/`variant` (cost in MAJOR units of the
//     shop currency), the product's `marginRefs` from the product metafield, and
//     `presentmentCurrencyRate` (shop currency → cart currency, a Decimal). They
//     are passed on as read; the engine decides what is usable (margin.ts).
//
// Never throws: the run wrappers turn any error into `{ operations: [] }`.
// Used by tests/parity.test.js and apps/won-discounts/tests/contracts/function.contract.test.ts.

import { emitForNode } from "@won/core/discounts/emit";
import {
  mapToFunctionOutput,
  OUTPUT_BUDGET_BYTES,
  OUTPUT_LIMIT_BYTES,
  outputBudget,
  outputBytes,
  outputLimit,
} from "@won/core/discounts/function-output";
import { toMinorUnits } from "@won/core/discounts/money";
import { planCart } from "@won/core/discounts/plan";

/** Cart line attribute that marks a Won gift line (A1.2); its value is the gift tier id. */
export const GIFT_ATTRIBUTE = "_won_gift";

/**
 * @typedef {import("@won/core/discounts/cart").CartPlanInput} CartPlanInput
 * @typedef {import("@won/core/discounts/cart").CartLineInput} CartLineInput
 * @typedef {import("@won/core/discounts/emit").NodeRole} NodeRole
 * @typedef {import("@won/core/discounts/emit").NodeEmission} NodeEmission
 *
 * @typedef {object} AdaptedInput
 * @property {CartPlanInput} cart
 * @property {unknown} config          the shop config jsonValue as read (planCart validates it)
 * @property {NodeRole | null} role    null = unknown/inconsistent variables → the node emits nothing
 * @property {string | null} triggeringCode
 * @property {string[]} classes        the node's discountClasses
 * @property {string[]} deliveryGroupIds
 * @property {number} lineCount       cart lines in the input (Shopify scales the output limit with it)
 *
 * @typedef {{ operations: Record<string, unknown>[] }} RunResult
 */

/** @type {NodeEmission} */
const NO_EMISSION = Object.freeze({ productCandidates: [], orderCandidates: [], deliveryCandidates: [] });

/**
 * @param {unknown} v
 * @returns {Record<string, unknown>}
 */
function rec(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {};
}

/**
 * @param {unknown} v
 * @returns {unknown[]}
 */
function arr(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function str(v) {
  return typeof v === "string" ? v : "";
}

/**
 * @param {unknown} v
 * @returns {string | null}
 */
function nonEmpty(v) {
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * The node's role from its `function_vars`. A code node MUST have a rule id; an
 * automatic node never has a triggering code (C1), so an automatic role with one
 * is inconsistent and emits nothing rather than giving automatic value twice.
 * @param {Record<string, unknown>} vars
 * @param {string | null} triggeringCode
 * @returns {NodeRole | null}
 */
function readRole(vars, triggeringCode) {
  if (vars.role === "automatic") return triggeringCode === null ? { kind: "automatic" } : null;
  const ruleId = nonEmpty(vars.ruleId);
  if (vars.role === "code" && ruleId !== null) return { kind: "code", ruleId };
  return null;
}

/**
 * LanguageCode → the engine's message language (rule names win; this only
 * phrases the fallback for an unnamed rule).
 * @param {unknown} isoCode
 * @returns {"cs" | "en" | undefined}
 */
function readLocale(isoCode) {
  if (typeof isoCode !== "string" || isoCode === "") return undefined;
  const lang = isoCode.slice(0, 2).toUpperCase();
  return lang === "CS" || lang === "SK" ? "cs" : "en";
}

/** @type {readonly string[]} */
const NO_REFS = Object.freeze([]);

/**
 * A `Decimal` scalar (Shopify sends a decimal string, e.g. "0.0405"; the local
 * runner may pass a number) → a number, or undefined. A string must be plain
 * decimal digits after trim, with at most 15 significant digits and at most 22
 * decimals (leading zeros and trailing decimal zeros not counted); it is then
 * `Number(text)`. "1e3", "0x10", "", "1.", junk and longer text are undefined:
 * the Rust function reads exactly this set without float-parsing tables
 * (src/json.rs DecimalNumber, one exact division), so both read the same number.
 * @param {unknown} v
 * @returns {number | undefined}
 */
export function decimalNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return undefined;
  const text = v.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return undefined;
  const decimals = (m[2] ?? "").replace(/0+$/, "");
  const significant = (m[1] + decimals).replace(/^0+/, "");
  return significant.length <= 15 && decimals.length <= 22 ? Number(text) : undefined;
}

/**
 * One cart line → CartLineInput. This is the hot path of a big cart and the JS
 * runtime charges ~3 000 Wasm instructions per function call, so it reads with
 * optional chaining and no helper calls; the engine re-validates every field
 * anyway (normalizeCart keeps only strings, only this variant's refs, …).
 *   - `ruleIds` / `variantRuleIds`: passed through as the sync wrote them;
 *   - `outlet`: `true` (every variant) or a list of variant GIDs;
 *   - gift: the `_won_gift` line attribute (a property of the line, not the product);
 *   - margin (MVP 2): `marginRefs` from the product metafield, `cost` / `cur` from the
 *     variant metafield — as read (normalizeCart keeps a number / a string / strings).
 * @param {any} line
 * @param {string} currency
 * @returns {CartLineInput | null}
 */
function readLine(line, currency) {
  const id = line?.id;
  if (typeof id !== "string" || id === "") return null;
  const merchandise = line.merchandise;
  const isVariant = merchandise?.__typename === "ProductVariant";
  const variantId = isVariant && typeof merchandise.id === "string" ? merchandise.id : "";
  const won = isVariant ? merchandise.product?.wonProduct?.jsonValue : null;
  const amount = line.cost?.amountPerQuantity?.amount;
  /** @type {CartLineInput} */
  const out = {
    id,
    variantId,
    // Not selected (input query cost and size): the engine targets by refs.
    productId: "",
    quantity: typeof line.quantity === "number" ? line.quantity : 0,
    unitPrice: typeof amount === "string" || typeof amount === "number" ? (toMinorUnits(amount, currency) ?? 0) : 0,
    ruleIds: NO_REFS,
  };
  if (typeof won === "object" && won !== null) {
    if (Array.isArray(won.ruleIds)) out.ruleIds = won.ruleIds;
    const byVariant = won.variantRuleIds;
    if (typeof byVariant === "object" && byVariant !== null) out.variantRuleIds = byVariant;
    const outlet = won.outlet;
    if (outlet === true || (Array.isArray(outlet) && variantId !== "" && outlet.includes(variantId))) out.outlet = true;
    if (won.marginRefs !== undefined) out.marginRefs = won.marginRefs;
  }
  const cost = isVariant ? merchandise.wonVariant?.jsonValue : null;
  if (typeof cost === "object" && cost !== null) {
    if (cost.cost !== undefined) out.unitCost = cost.cost;
    // `cur` matters only for a cost the engine could use (a number > 0); the Rust
    // function skips reading it otherwise (instruction budget), and so does this.
    if (cost.cur !== undefined && typeof cost.cost === "number" && cost.cost > 0) out.unitCostCurrency = cost.cur;
  }
  const gift = line.gift?.value;
  if (typeof gift === "string" && gift !== "") out.giftTierId = gift;
  return out;
}

/**
 * Function input (either run target) → the engine's cart, the shared config, the
 * node's role and what the output needs. Tolerant: junk is read as "nothing".
 * @param {unknown} input
 * @returns {AdaptedInput}
 */
export function adaptInput(input) {
  const root = rec(input);
  const discount = rec(root.discount);
  const vars = rec(rec(discount.vars).jsonValue);
  const shop = rec(root.shop);
  const localTime = rec(shop.localTime);
  const cart = rec(root.cart);
  const currency = str(rec(rec(cart.cost).subtotalAmount).currencyCode).toUpperCase();
  const triggeringCode = nonEmpty(root.triggeringDiscountCode);

  /** @type {CartLineInput[]} */
  const lines = [];
  const rawLines = arr(cart.lines);
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = readLine(rawLines[i], currency);
    if (line) lines.push(line);
  }
  /** @type {string[]} */
  const enteredCodes = [];
  for (const entry of arr(root.enteredDiscountCodes)) {
    const code = nonEmpty(rec(entry).code);
    if (code !== null) enteredCodes.push(code);
  }

  /** @type {CartPlanInput} */
  const planInput = {
    currency,
    lines,
    enteredCodes,
    campaign: {
      id: nonEmpty(vars.campaignId),
      active: localTime.campaignActive === true,
      varsVersion: nonEmpty(vars.varsVersion),
    },
  };
  // Shop-local day: rule schedules are shop-local dates in the shared config.
  const today = nonEmpty(localTime.date);
  if (today !== null) planInput.today = today;
  const localization = rec(root.localization);
  const countryCode = nonEmpty(rec(localization.country).isoCode);
  if (countryCode !== null) planInput.countryCode = countryCode;
  const locale = readLocale(rec(localization.language).isoCode);
  if (locale) planInput.locale = locale;
  // Margin protection converts cost prices from the shop currency into the cart's with it.
  const rate = decimalNumber(root.presentmentCurrencyRate);
  if (rate !== undefined) planInput.shopToCartRate = rate;

  return {
    cart: planInput,
    config: rec(shop.config).jsonValue ?? null,
    role: readRole(vars, triggeringCode),
    triggeringCode,
    classes: arr(discount.discountClasses).filter((c) => typeof c === "string").map(String),
    // Shopify scales its output limit with the cart's line count (over 200 lines).
    lineCount: arr(cart.lines).length,
    deliveryGroupIds: arr(cart.deliveryGroups)
      .map((group) => str(rec(group).id))
      .filter((id) => id !== ""),
  };
}

/**
 * What this node emits for its input: the full plan, then only its own part.
 * @param {AdaptedInput} adapted
 * @returns {{ plan: import("@won/core/discounts/plan").CartPlan | null, emission: NodeEmission }}
 */
export function emissionFor(adapted) {
  if (adapted.role === null) return { plan: null, emission: NO_EMISSION };
  // planCart and emitForNode never throw by contract; the config is validated inside.
  const plan = planCart(adapted.cart, /** @type {any} */ (adapted.config));
  return { plan, emission: emitForNode(plan, adapted.role, adapted.triggeringCode) };
}

// --- The output mapping ------------------------------------------------------------------
//
// NodeEmission → function output lives in @won/core (function-output.ts): one
// TS implementation for this oracle and for the admin's "Vyzkoušet košík"
// (checkoutPreview). It groups candidates, emits exact values (a rounding tie
// as its exact amount), keeps the output under Shopify's 20 kB limit (Pro
// stacks → top rule, then the smallest candidates dropped) and puts a fixed
// shipping amount on the first delivery group only. src/output.rs reproduces it.

export { OUTPUT_BUDGET_BYTES, OUTPUT_LIMIT_BYTES, outputBudget, outputBytes, outputLimit };

/**
 * The node's output for both targets, and what the output budget cost.
 * @param {NodeEmission} emission
 * @param {AdaptedInput} adapted
 * @param {import("@won/core/discounts/plan").CartPlan | null} plan
 */
export function mapOutput(emission, adapted, plan) {
  return mapToFunctionOutput(emission, {
    plan,
    classes: adapted.classes,
    lineCount: adapted.lineCount,
    deliveryGroupIds: adapted.deliveryGroupIds,
  });
}

/**
 * NodeEmission → `cart.lines.discounts.generate.run` output.
 * @param {NodeEmission} emission
 * @param {AdaptedInput} adapted
 * @param {import("@won/core/discounts/plan").CartPlan | null} plan
 * @returns {RunResult}
 */
export function toCartLinesResult(emission, adapted, plan) {
  return /** @type {RunResult} */ (mapOutput(emission, adapted, plan).lines);
}

/**
 * NodeEmission → `cart.delivery-options.discounts.generate.run` output.
 * @param {NodeEmission} emission
 * @param {AdaptedInput} adapted
 * @param {import("@won/core/discounts/plan").CartPlan | null} plan
 * @returns {RunResult}
 */
export function toDeliveryResult(emission, adapted, plan) {
  return /** @type {RunResult} */ (mapOutput(emission, adapted, plan).delivery);
}

/**
 * @param {unknown} input
 * @returns {RunResult}
 */
export function runCartLines(input) {
  try {
    const classes = arr(rec(rec(input).discount).discountClasses);
    if (!classes.includes("PRODUCT") && !classes.includes("ORDER")) return { operations: [] };
    const adapted = adaptInput(input);
    const { plan, emission } = emissionFor(adapted);
    return toCartLinesResult(emission, adapted, plan);
  } catch {
    return { operations: [] };
  }
}

/**
 * @param {unknown} input
 * @returns {RunResult}
 */
export function runDelivery(input) {
  try {
    if (!arr(rec(rec(input).discount).discountClasses).includes("SHIPPING")) return { operations: [] };
    const adapted = adaptInput(input);
    const { plan, emission } = emissionFor(adapted);
    return toDeliveryResult(emission, adapted, plan);
  } catch {
    return { operations: [] };
  }
}
