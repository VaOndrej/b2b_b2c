// @ts-check
// The REFERENCE adapter: the JS function's glue to the TS engine, kept as the
// parity oracle for the Rust function (README.md "Parity", DATA-4: one brain).
// The Rust function (src/) reproduces exactly what this computes:
//
//   function input ─adaptInput→ CartPlanInput ─planCart→ CartPlan
//                  ─emitForNode(role, triggering code)→ NodeEmission
//                  ─toCartLinesResult / toDeliveryResult→ function output
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
//     same product bought normally is an ordinary line).
//
// Never throws: the run wrappers turn any error into `{ operations: [] }`.
// Used by tests/parity.test.js and apps/won-discounts/tests/contracts/function.contract.test.ts.

import { describeRule } from "@won/core/discounts/describe";
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
 * @property {number} lineCount       cart lines in the input (Shopify scales the output limit with it)
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

// --- Product candidates and the output size ------------------------------------------------
//
// Shopify refuses a function output over 20 kB (1 kB = 1000 B) for carts up to
// 200 lines — the limit scales with the line count above that
// (shopify.dev/docs/api/functions/2026-04, "Resource limits") — and then the
// node gives NO discount at all. So:
//   1. every product value is emitted exactly, in the most groupable form:
//      - a fixed amount per item equal to the unit price (the item is free) → 100 %;
//      - a Pro stack (fixed total T on a line of subtotal S, quantity q):
//        T = S → 100 %; a stack of whole percents P whose Math.round(S × ΣP / 100)
//        is T → ΣP %; T divisible by q → T / q per item; else T once on that line;
//   2. candidates with the same message and value share one candidate with
//      several targets (a fixed total on one line never groups: shared, it would
//      be applied ONCE across all its targets);
//   3. over the budget (19 000 B, scaled like Shopify's limit) every Pro stack
//      is emitted as its top rule's own value instead (it groups; the customer
//      keeps the larger part of the stack), then, as a last resort, the product
//      candidates that save the least are dropped until the output fits.
// Sizes are the UTF-8 bytes of the compact JSON (what JSON.stringify writes).

/** Shopify's function output limit for carts up to 200 lines, bytes. */
export const OUTPUT_LIMIT_BYTES = 20000;
/** What the function allows itself, ≥ 5 % under the limit. */
export const OUTPUT_BUDGET_BYTES = 19000;

/** @param {number} lineCount */
export function outputBudget(lineCount) {
  return Math.floor((OUTPUT_BUDGET_BYTES * Math.max(200, lineCount)) / 200);
}

/** @param {unknown} value */
export function outputBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** @param {number} value @returns {{ key: string, value: CandidateValue }} */
const percentValue = (value) => ({ key: `p${value}`, value: { percentage: { value } } });

/**
 * @param {number} minor @param {string} currency
 * @returns {{ key: string, value: CandidateValue }}
 */
const perItemValue = (minor, currency) => ({
  key: `e${minor}`,
  value: { fixedAmount: { amount: fromMinorUnits(minor, currency), appliesToEachItem: true } },
});

/**
 * The rule outcome of a stack component (what the plan knows of the rule).
 * @param {import("@won/core/discounts/plan").CartPlan} plan @param {string} ruleId
 */
function ruleOf(plan, ruleId) {
  return plan.rules.find((r) => r.ruleId === ruleId);
}

/**
 * ΣP when every component of the stack is a whole-percent rule, else null.
 * @param {import("@won/core/discounts/plan").CartPlan} plan
 * @param {import("@won/core/discounts/plan").PlanStack} stack
 */
function wholePercentSum(plan, stack) {
  let sum = 0;
  for (const component of stack.components) {
    const value = ruleOf(plan, component.ruleId)?.describable.value;
    if (value?.kind !== "percentage" || !Number.isInteger(value.percent)) return null;
    sum += value.percent;
  }
  return sum;
}

/**
 * One emitted product candidate → its exact output value, grouping key (null =
 * never grouped) and message.
 * @param {ProductCandidate} c
 * @param {import("@won/core/discounts/plan").PlanLine} line
 * @param {import("@won/core/discounts/plan").CartPlan} plan
 * @returns {{ key: string | null, value: CandidateValue }}
 */
function exactProductValue(c, line, plan) {
  const currency = plan.currency;
  if (c.percent !== undefined) return percentValue(c.percent);
  if (c.fixedPerItem !== undefined) {
    return c.fixedPerItem === line.unitPrice ? percentValue(100) : perItemValue(c.fixedPerItem, currency);
  }
  const total = /** @type {number} */ (c.fixedTotal);
  if (total === line.subtotal) return percentValue(100);
  const stack = /** @type {import("@won/core/discounts/plan").PlanStack} */ (line.product);
  const percent = wholePercentSum(plan, stack);
  if (percent !== null && Math.round((line.subtotal * percent) / 100) === total) return percentValue(percent);
  if (line.quantity > 0 && total % line.quantity === 0) return perItemValue(total / line.quantity, currency);
  return { key: null, value: { fixedAmount: { amount: fromMinorUnits(total, currency), appliesToEachItem: false } } };
}

/**
 * A Pro stack emitted as its top rule's own value (the first component, which
 * the stack never caps): the rule's percent, or its fixed amount per item.
 * @param {import("@won/core/discounts/plan").PlanLine} line
 * @param {import("@won/core/discounts/plan").CartPlan} plan
 * @returns {{ key: string, value: CandidateValue, message: string, amount: number }}
 */
function topRuleValue(line, plan) {
  const stack = /** @type {import("@won/core/discounts/plan").PlanStack} */ (line.product);
  const top = stack.components[0];
  const rule = /** @type {import("@won/core/discounts/plan").RuleOutcome} */ (ruleOf(plan, top.ruleId));
  const message = rule.name || describeRule(rule.describable, plan.locale, plan.currency, { short: true });
  if (rule.describable.value.kind === "percentage") return { ...percentValue(rule.describable.value.percent), message, amount: top.amount };
  const perItem = top.amount / line.quantity;
  const value = perItem === line.unitPrice ? percentValue(100) : perItemValue(perItem, plan.currency);
  return { ...value, message, amount: top.amount };
}

/**
 * The node's product candidates, grouped. Each emitted candidate is matched to
 * its plan line (the emission follows the plan's line order).
 * @param {NodeEmission} emission
 * @param {import("@won/core/discounts/plan").CartPlan} plan
 * @param {boolean} degradeStacks
 * @returns {{ message: string, targets: { cartLine: { id: string } }[], value: CandidateValue, amount: number }[]}
 */
function productCandidates(emission, plan, degradeStacks) {
  /** @type {{ message: string, targets: { cartLine: { id: string } }[], value: CandidateValue, amount: number }[]} */
  const out = [];
  /** @type {Map<string, (typeof out)[number]>} */
  const shared = new Map();
  let next = 0;
  for (const c of emission.productCandidates) {
    while (next < plan.lines.length && !(plan.lines[next].lineId === c.lineId && plan.lines[next].product)) next += 1;
    const line = plan.lines[next];
    next += 1;
    if (!line?.product) continue;
    const stacked = line.product.components.length > 1;
    const mapped =
      degradeStacks && stacked
        ? topRuleValue(line, plan)
        : { ...exactProductValue(c, line, plan), message: c.message, amount: c.amount };
    const target = { cartLine: { id: c.lineId } };
    const key = mapped.key === null ? null : JSON.stringify([mapped.message, mapped.key]);
    const existing = key === null ? undefined : shared.get(key);
    if (existing) {
      existing.targets.push(target);
      existing.amount += mapped.amount;
      continue;
    }
    const candidate = { message: mapped.message, targets: [target], value: mapped.value, amount: mapped.amount };
    out.push(candidate);
    if (key !== null) shared.set(key, candidate);
  }
  return out;
}

/**
 * NodeEmission → `cart.lines.discounts.generate.run` output. Only the classes the
 * node was created with (a candidate of another class would be refused), within
 * the output budget (see "Product candidates and the output size").
 * @param {NodeEmission} emission
 * @param {AdaptedInput} adapted
 * @param {import("@won/core/discounts/plan").CartPlan | null} plan
 * @returns {RunResult}
 */
export function toCartLinesResult(emission, adapted, plan) {
  const currency = adapted.cart.currency;
  /** @type {Record<string, unknown>[]} */
  const orderOperations = [];
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
    if (candidates.length > 0) orderOperations.push({ orderDiscountsAdd: { candidates, selectionStrategy: "FIRST" } });
  }
  /** @param {{ message: string, targets: unknown[], value: CandidateValue }[]} products */
  const result = (products) => {
    const operations = [];
    // Every candidate targets different lines (≤ 1 product allocation per line), so all apply.
    if (products.length > 0) {
      operations.push({
        productDiscountsAdd: {
          candidates: products.map(({ message, targets, value }) => ({ message, targets, value })),
          selectionStrategy: "ALL",
        },
      });
    }
    return { operations: [...operations, ...orderOperations] };
  };
  if (!adapted.classes.includes("PRODUCT") || plan === null) return result([]);

  const budget = outputBudget(adapted.lineCount);
  let products = productCandidates(emission, plan, false);
  if (outputBytes(result(products)) <= budget) return result(products);
  products = productCandidates(emission, plan, true);
  while (products.length > 0 && outputBytes(result(products)) > budget) {
    // Last resort: drop the candidate that saves the least (ties: the later one).
    let drop = 0;
    for (let k = 1; k < products.length; k += 1) if (products[k].amount <= products[drop].amount) drop = k;
    products = products.filter((_, k) => k !== drop);
  }
  return result(products);
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
    return toDeliveryResult(emissionFor(adapted).emission, adapted);
  } catch {
    return { operations: [] };
  }
}
