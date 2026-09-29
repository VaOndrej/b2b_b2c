// Builds the function fixtures (tests/fixtures/*.json) from the scenarios in
// tests/scenarios.js. The shared config and the node variables are made by the
// PUBLIC @won/core builders (sanitizeConfig → buildShopFunctionConfig,
// buildNodeVars) — never written by hand — so a change to how the engine
// encodes its config (e.g. code hashes) only needs `npm run fixtures -w
// won-discounts-engine`, and tests/fixtures.drift.test.js says so when the
// committed files are stale. The expected outputs are written by hand in the
// scenarios (red first): they are the spec, not a copy of the engine.
//
// Runs under vitest or tsx (the core is TypeScript), never inside the Wasm.

import { sanitizeConfig } from "@won/core/discounts/config";
import { buildNodeVars, buildShopFunctionConfig } from "@won/core/discounts/function-payload";

export const TARGETS = {
  lines: { export: "cart-lines-discounts-generate-run", target: "cart.lines.discounts.generate.run" },
  delivery: {
    export: "cart-delivery-options-discounts-generate-run",
    target: "cart.delivery-options.discounts.generate.run",
  },
};

export const TODAY = "2026-10-01";
export const NOW = `${TODAY}T12:00:00`;
/** The shop's IANA zone: rule schedules become shop-local days with it (buildShopFunctionConfig). */
export const SHOP_TIMEZONE = "Europe/Prague";
export const ALL_CLASSES = ["PRODUCT", "ORDER", "SHIPPING"];
export const DEFAULT_GROUP = "gid://shopify/CartDeliveryGroup/1";
/** The shop currency: the variants' cost prices are in it (margin protection, MVP 2). */
export const SHOP_CURRENCY = "CZK";

/**
 * @typedef {Record<string, unknown>} RawRule
 * @typedef {{ kind: "automatic" } | { kind: "code", ruleId: string }} NodeRole
 *
 * @typedef {object} ScenarioLine
 * @property {number} n                   line number: ids CartLine/n, ProductVariant/(1000 + n)
 * @property {string} price               amountPerQuantity.amount as Shopify sends it ("100.0")
 * @property {number} [qty]               default 1
 * @property {Record<string, unknown> | null} [won]   product metafield jsonValue (null = none)
 * @property {string} [gift]              `_won_gift` attribute value
 * @property {boolean} [custom]           a CustomProduct line (no product, no metafield)
 * @property {number} [variant]           variant number (default 1000 + n)
 * @property {string} [gid]              cart line id (default lineId(n))
 * @property {string} [variantGid]       variant id (default variantId(variant ?? 1000 + n))
 * @property {unknown} [variantMeta]      variant metafield `$app:won_discounts`/`variant` jsonValue
 *                                        (MVP 2 margin: `{cost, cur}`, cost in MAJOR units of the shop currency)
 *
 * @typedef {object} Scenario
 * @property {string} name
 * @property {string} description
 * @property {"lines" | "delivery"} target
 * @property {RawRule[]} rules
 * @property {Record<string, unknown>} [configExtra]   engine, campaigns … (merchant config)
 * @property {boolean} [realisticIds]   ids as the checkout sends them (budget carts, `withRealisticIds`)
 * @property {Record<string, unknown>} [margin]   modules.margin of the merchant config (MVP 2)
 * @property {string} [shopCurrency]      the shop currency (margin `cur`), default SHOP_CURRENCY
 * @property {unknown} [rate]             `presentmentCurrencyRate` (shop → cart), default "1.0";
 *                                        `rate: undefined` leaves the field out
 * @property {NodeRole} role
 * @property {(vars: Record<string, unknown>) => Record<string, unknown> | null} [varsPatch]
 * @property {"null" | Record<string, unknown>} [shopConfig]   override the built config
 * @property {string[]} [classes]
 * @property {string | null} [triggering]
 * @property {string[]} [entered]
 * @property {string} [currency]
 * @property {boolean} [campaignActive]
 * @property {string} [date]
 * @property {string} [country]
 * @property {string} [language]
 * @property {ScenarioLine[]} lines
 * @property {string[]} [deliveryGroups]
 * @property {{ operations: unknown[] }} expected
 */

const PRODUCTS = { kind: "products", productIds: [], variantIds: [] };

/**
 * Percentage off the lines whose product metafield lists `id`.
 * @param {string} id @param {number} percent @param {RawRule} [extra]
 * @returns {RawRule}
 */
export function pct(id, percent, extra = {}) {
  return { id, enabled: true, name: `Sleva ${id}`, method: "automatic", value: { kind: "percentage", percent }, target: PRODUCTS, ...extra };
}

/** @param {string} id @param {Record<string, number>} amount @param {RawRule} [extra] @returns {RawRule} */
export function fixed(id, amount, extra = {}) {
  return { id, enabled: true, name: `Sleva ${id}`, method: "automatic", value: { kind: "fixed", amount }, target: PRODUCTS, ...extra };
}

/** @param {string} id @param {number} percent @param {RawRule} [extra] @returns {RawRule} */
export function orderPct(id, percent, extra = {}) {
  return pct(id, percent, { target: { kind: "order" }, ...extra });
}

/** @param {string} id @param {RawRule} [extra] @returns {RawRule} */
export function freeShip(id, extra = {}) {
  return { id, enabled: true, name: `Doprava ${id}`, method: "automatic", value: { kind: "freeShipping" }, target: { kind: "shipping" }, ...extra };
}

/** @param {string[]} codes @param {RawRule} rule @returns {RawRule} */
export function withCodes(codes, rule) {
  return { ...rule, method: "code", codes };
}

export const lineId = (/** @type {number} */ n) => `gid://shopify/CartLine/${n}`;
export const variantId = (/** @type {number} */ n) => `gid://shopify/ProductVariant/${n}`;

/**
 * A rule id in the app's format (rule-form.ts `newRuleId`: `r_` + 20 lower-case
 * hex digits), derived from a scenario's logical id so the fixtures are stable.
 * @param {string} logical
 */
export function appRuleId(logical) {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let k = 0; k < logical.length; k += 1) {
    const c = logical.charCodeAt(k);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  // murmur3's finalizer: every hex digit depends on every character (like random ids).
  const mix = (/** @type {number} */ x) => {
    let h = x >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  };
  const hex = (/** @type {number} */ x) => x.toString(16).padStart(8, "0");
  return `r_${hex(mix(a))}${hex(mix(b ^ a))}${hex(mix(a + b)).slice(0, 4)}`;
}

/**
 * A scenario with the ids the checkout really sends (the budget carts, which
 * measure instructions): rule ids in the app's format everywhere they appear
 * (config, combinesWith, the product metafields' refs); cart line and delivery
 * group ids as Shopify numbers them in a function input — `gid://shopify/CartLine/0`,
 * `/1`, … (every line of the 640 dev-store runs logged in apps/won-discounts/
 * .shopify/logs, 2026-09-29) — and 14-digit variant ids. The hand-written
 * expected output gets the same id mapping and nothing else.
 * @param {Scenario} s
 * @returns {Scenario}
 */
export function withRealisticIds(s) {
  if (!s.realisticIds) return s;
  const ids = new Map();
  const rid = (/** @type {unknown} */ id) => {
    if (typeof id !== "string") return id;
    if (!ids.has(id)) ids.set(id, appRuleId(id));
    return ids.get(id);
  };
  const rules = s.rules.map((r) => ({
    ...r,
    id: rid(r.id),
    ...(r.combinesWith ? { combinesWith: { ...r.combinesWith, ruleIds: /** @type {string[]} */ (r.combinesWith.ruleIds).map(rid) } } : {}),
  }));
  if (new Set(ids.values()).size !== ids.size) throw new Error(`${s.name}: app rule ids collide`);
  const lines = s.lines.map((l) => ({
    ...l,
    gid: `gid://shopify/CartLine/${l.n - 1}`,
    variantGid: `gid://shopify/ProductVariant/${48468678900000 + (l.variant ?? l.n)}`,
    ...(l.won ? { won: { ...l.won, ...(Array.isArray(l.won.ruleIds) ? { ruleIds: l.won.ruleIds.map(rid) } : {}) } } : {}),
  }));
  const remap = (/** @type {unknown} */ v) =>
    JSON.parse(
      JSON.stringify(v)
        .replace(/gid:\/\/shopify\/CartLine\/(\d+)/g, (_, n) => `gid://shopify/CartLine/${Number(n) - 1}`)
        .replace(/gid:\/\/shopify\/CartDeliveryGroup\/(\d+)/g, (_, n) => `gid://shopify/CartDeliveryGroup/${Number(n) - 1}`),
    );
  return {
    ...s,
    rules,
    lines,
    deliveryGroups: (s.deliveryGroups ?? [DEFAULT_GROUP]).map((g) => remap(g)),
    expected: remap(s.expected),
    realisticIds: false,
  };
}

/**
 * The merchant config as the app stores it, then the shared function payload
 * the sync writes to the shop metafield (throws on sanitizer issues so a
 * scenario can never silently test a different config than it reads).
 * @param {Scenario} s
 */
export function merchantConfig(s) {
  const modules = { codes: { rules: s.rules }, ...(s.margin ? { margin: s.margin } : {}) };
  const { config, issues } = sanitizeConfig({ ...(s.configExtra ?? {}), modules });
  if (issues.length > 0) {
    throw new Error(`${s.name}: sanitizer issues ${JSON.stringify(issues.map((i) => `${i.path} ${i.code}`))}`);
  }
  return config;
}

/**
 * @param {ScenarioLine} l
 */
function cartLine(l) {
  const merchandise = l.custom
    ? { __typename: "CustomProduct" }
    : {
        __typename: "ProductVariant",
        id: l.variantGid ?? variantId(l.variant ?? 1000 + l.n),
        wonVariant: l.variantMeta === undefined ? null : { jsonValue: l.variantMeta },
        product: { wonProduct: l.won ? { jsonValue: l.won } : null },
      };
  return {
    id: l.gid ?? lineId(l.n),
    quantity: l.qty ?? 1,
    cost: { amountPerQuantity: { amount: l.price } },
    gift: l.gift === undefined ? null : { value: l.gift },
    merchandise,
  };
}

/**
 * The function input for a scenario, field for field what the input query selects.
 * @param {Scenario} scenario
 */
export function buildInput(scenario) {
  const s = withRealisticIds(scenario);
  const config = merchantConfig(s);
  const shopConfig =
    s.shopConfig === "null"
      ? null
      : {
          jsonValue:
            s.shopConfig ??
            buildShopFunctionConfig(config, { now: NOW, shopTimezone: SHOP_TIMEZONE, shopCurrency: s.shopCurrency ?? SHOP_CURRENCY }).payload,
        };
  const baseVars = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (buildNodeVars(s.role, config, NOW)));
  const vars = s.varsPatch ? s.varsPatch({ ...baseVars }) : baseVars;
  /** @type {Record<string, unknown>} */
  const cart = { cost: { subtotalAmount: { currencyCode: s.currency ?? "CZK" } } };
  if (s.target === "delivery") cart.deliveryGroups = (s.deliveryGroups ?? [DEFAULT_GROUP]).map((id) => ({ id }));
  cart.lines = s.lines.map(cartLine);
  return {
    triggeringDiscountCode: s.triggering ?? null,
    enteredDiscountCodes: (s.entered ?? []).map((code) => ({ code })),
    discount: {
      discountClasses: s.classes ?? ALL_CLASSES,
      vars: vars === null ? null : { jsonValue: vars },
    },
    shop: {
      config: shopConfig,
      localTime: { date: s.date ?? TODAY, campaignActive: s.campaignActive ?? false },
    },
    localization: { country: { isoCode: s.country ?? "CZ" }, language: { isoCode: s.language ?? "CS" } },
    // `rate: undefined` given explicitly: the field is left out of the input.
    ...(!("rate" in s) ? { presentmentCurrencyRate: "1.0" } : s.rate === undefined ? {} : { presentmentCurrencyRate: s.rate }),
    cart,
  };
}

/**
 * The fixture file content (the format of @shopify/shopify-function-test-helpers
 * loadFixture, plus a human description).
 * @param {Scenario} s
 */
export function buildFixture(s) {
  const t = TARGETS[s.target];
  return {
    scenario: s.description,
    payload: { export: t.export, target: t.target, input: buildInput(s), output: withRealisticIds(s).expected },
  };
}

/** @param {Scenario} s */
export const fixtureFileName = (s) => `${s.name}.json`;
