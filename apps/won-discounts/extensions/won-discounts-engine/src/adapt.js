// @ts-check
// The discount function's only glue to the engine (spec §3 "Emise per uzel",
// DATA-4: one brain). Every Won node runs the SAME plan and emits only its own
// part:
//
//   function input ─adaptInput→ CartPlanInput ─planCart→ CartPlan
//                  ─emitForNode(role, triggering code)→ NodeEmission
//                  ─toCartLinesResult / toDeliveryResult→ function output
//
// Where each input comes from (input queries in this folder, T0/C7):
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
//     same product bought normally is an ordinary line).
//
// Never throws: the run wrappers turn any error into `{ operations: [] }`, so a
// broken config or input never blocks checkout (principle 4).

import { emitForNode } from "@won/core/discounts/emit";
import { fromMinorUnits, toMinorUnits } from "@won/core/discounts/money";
import { planCart } from "@won/core/discounts/plan";

/** Cart line attribute that marks a Won gift line (A1.2); its value is the gift tier id. */
export const GIFT_ATTRIBUTE = "_won_gift";

/**
 * @typedef {import("@won/core/discounts/cart").CartPlanInput} CartPlanInput
 * @typedef {import("@won/core/discounts/cart").CartLineInput} CartLineInput
 * @typedef {import("@won/core/discounts/emit").NodeRole} NodeRole
 * @typedef {import("@won/core/discounts/emit").NodeEmission} NodeEmission
 * @typedef {import("@won/core/discounts/emit").ProductCandidate} ProductCandidate
 *
 * @typedef {object} AdaptedInput
 * @property {CartPlanInput} cart
 * @property {unknown} config          the shop config jsonValue as read (planCart validates it)
 * @property {NodeRole | null} role    null = unknown/inconsistent variables → the node emits nothing
 * @property {string | null} triggeringCode
 * @property {string[]} classes        the node's discountClasses
 * @property {string[]} deliveryGroupIds
 *
 * @typedef {{ percentage: { value: number } }
 *   | { fixedAmount: { amount: string, appliesToEachItem?: boolean } }} CandidateValue
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
 * One cart line → CartLineInput. This is the hot path of a big cart and the JS
 * runtime charges ~3 000 Wasm instructions per function call, so it reads with
 * optional chaining and no helper calls; the engine re-validates every field
 * anyway (normalizeCart keeps only strings, only this variant's refs, …).
 *   - `ruleIds` / `variantRuleIds`: passed through as the sync wrote them;
 *   - `outlet`: `true` (every variant) or a list of variant GIDs;
 *   - gift: the `_won_gift` line attribute (a property of the line, not the product).
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

  return {
    cart: planInput,
    config: rec(shop.config).jsonValue ?? null,
    role: readRole(vars, triggeringCode),
    triggeringCode,
    classes: arr(discount.discountClasses).filter((c) => typeof c === "string").map(String),
    deliveryGroupIds: arr(cart.deliveryGroups)
      .map((group) => str(rec(group).id))
      .filter((id) => id !== ""),
  };
}

/**
 * What this node emits for its input: the full plan, then only its own part.
 * @param {AdaptedInput} adapted
 * @returns {NodeEmission}
 */
export function emissionFor(adapted) {
  if (adapted.role === null) return NO_EMISSION;
  // planCart and emitForNode never throw by contract; the config is validated inside.
  const plan = planCart(adapted.cart, /** @type {any} */ (adapted.config));
  return emitForNode(plan, adapted.role, adapted.triggeringCode);
}

/**
 * @param {{ percent?: number, fixedPerItem?: number, fixedTotal?: number }} value
 * @param {string} currency
 * @returns {CandidateValue | null}
 */
function candidateValue(value, currency) {
  if (value.percent !== undefined) return { percentage: { value: value.percent } };
  if (value.fixedPerItem !== undefined) {
    return { fixedAmount: { amount: fromMinorUnits(value.fixedPerItem, currency), appliesToEachItem: true } };
  }
  if (value.fixedTotal !== undefined) {
    return { fixedAmount: { amount: fromMinorUnits(value.fixedTotal, currency), appliesToEachItem: false } };
  }
  return null;
}

/**
 * Order / delivery values have no per-item variant.
 * @param {{ percent?: number, fixedTotal?: number }} value
 * @param {string} currency
 * @returns {CandidateValue | null}
 */
function totalValue(value, currency) {
  if (value.percent !== undefined) return { percentage: { value: value.percent } };
  if (value.fixedTotal !== undefined) return { fixedAmount: { amount: fromMinorUnits(value.fixedTotal, currency) } };
  return null;
}

/**
 * Product candidates, one per line from the engine; lines with the same rule,
 * message and per-line value (percent / fixed per item) share ONE candidate with
 * several targets — the same discount on each target, a much smaller output
 * (20 kB limit) for big carts. A `fixedTotal` (Pro stack) stays per line: it is a
 * total for exactly that line.
 * @param {ProductCandidate[]} candidates
 * @param {string} currency
 */
function productCandidates(candidates, currency) {
  /** @type {{ message: string, targets: { cartLine: { id: string } }[], value: CandidateValue }[]} */
  const out = [];
  /** @type {Map<string, (typeof out)[number]>} */
  const shared = new Map();
  for (const c of candidates) {
    const value = candidateValue(c, currency);
    if (!value) continue;
    const target = { cartLine: { id: c.lineId } };
    const key =
      c.percent !== undefined
        ? `${c.ruleId}\n${c.message}\np${c.percent}`
        : c.fixedPerItem !== undefined
          ? `${c.ruleId}\n${c.message}\ne${c.fixedPerItem}`
          : null;
    const existing = key === null ? undefined : shared.get(key);
    if (existing) {
      existing.targets.push(target);
      continue;
    }
    const candidate = { message: c.message, targets: [target], value };
    out.push(candidate);
    if (key !== null) shared.set(key, candidate);
  }
  return out;
}

/**
 * NodeEmission → `cart.lines.discounts.generate.run` output. Only the classes the
 * node was created with (a candidate of another class would be refused).
 * @param {NodeEmission} emission
 * @param {AdaptedInput} adapted
 * @returns {RunResult}
 */
export function toCartLinesResult(emission, adapted) {
  const currency = adapted.cart.currency;
  /** @type {Record<string, unknown>[]} */
  const operations = [];
  if (adapted.classes.includes("PRODUCT")) {
    const candidates = productCandidates(emission.productCandidates, currency);
    // Every candidate targets different lines (≤ 1 product allocation per line), so all apply.
    if (candidates.length > 0) operations.push({ productDiscountsAdd: { candidates, selectionStrategy: "ALL" } });
  }
  if (adapted.classes.includes("ORDER")) {
    const candidates = [];
    for (const c of emission.orderCandidates) {
      const value = totalValue(c, currency);
      if (!value) continue;
      candidates.push({
        message: c.message,
        targets: [{ orderSubtotal: { excludedCartLineIds: [...c.excludedLineIds] } }],
        value,
      });
    }
    if (candidates.length > 0) operations.push({ orderDiscountsAdd: { candidates, selectionStrategy: "FIRST" } });
  }
  return { operations };
}

/**
 * NodeEmission → `cart.delivery-options.discounts.generate.run` output: the
 * shipping winner on every delivery group of the cart.
 * @param {NodeEmission} emission
 * @param {AdaptedInput} adapted
 * @returns {RunResult}
 */
export function toDeliveryResult(emission, adapted) {
  if (!adapted.classes.includes("SHIPPING") || adapted.deliveryGroupIds.length === 0) return { operations: [] };
  const candidates = [];
  for (const c of emission.deliveryCandidates) {
    const value = totalValue(c, adapted.cart.currency);
    if (!value) continue;
    candidates.push({
      message: c.message,
      targets: adapted.deliveryGroupIds.map((id) => ({ deliveryGroup: { id } })),
      value,
    });
  }
  if (candidates.length === 0) return { operations: [] };
  return { operations: [{ deliveryDiscountsAdd: { candidates, selectionStrategy: "ALL" } }] };
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
    return toCartLinesResult(emissionFor(adapted), adapted);
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
    return toDeliveryResult(emissionFor(adapted), adapted);
  } catch {
    return { operations: [] };
  }
}
