// The function scenarios (spec §3 A1, "Emise per uzel"): one entry per fixture
// file in tests/fixtures/. Each states the merchant config, the node (role,
// classes, triggering code), the cart, and the EXPECTED output written by hand
// from the spec — never copied from a run. tests/fixture-builder.js turns a
// scenario into the function input; `npm run fixtures -w won-discounts-engine`
// writes the files; tests/fixtures.drift.test.js keeps them in sync.

import {
  appRuleId,
  buildInput,
  DEFAULT_GROUP,
  fixed,
  freeShip,
  lineId,
  orderPct,
  pct,
  productId,
  variantId,
  withCodes,
} from "./fixture-builder.js";
import { inputLimit, messagePackBytes } from "./input-size.js";
import { generateBatchCodes } from "@won/core/discounts/code-batch";

/** @typedef {import("./fixture-builder.js").Scenario} Scenario */

// --- Expected-output helpers ---------------------------------------------------------------

const NONE = { operations: [] };
const out = (/** @type {unknown[]} */ ...operations) => ({ operations });
const percent = (/** @type {number} */ value) => ({ percentage: { value } });
const perItem = (/** @type {string} */ amount) => ({ fixedAmount: { amount, appliesToEachItem: true } });
const lineTotal = (/** @type {string} */ amount) => ({ fixedAmount: { amount, appliesToEachItem: false } });
/** An order (or delivery) fixed amount. */
const amountOff = (/** @type {string} */ amount) => ({ fixedAmount: { amount } });

/** @param {string} message @param {number[]} lines @param {unknown} value */
const pc = (message, lines, value) => ({ message, targets: lines.map((n) => ({ cartLine: { id: lineId(n) } })), value });
/** @param {unknown[]} candidates */
const products = (...candidates) => ({ productDiscountsAdd: { candidates, selectionStrategy: "ALL" } });
/** @param {string} message @param {number[]} excluded @param {unknown} value */
const order = (message, excluded, value) => ({
  orderDiscountsAdd: {
    candidates: [{ message, targets: [{ orderSubtotal: { excludedCartLineIds: excluded.map(lineId) } }], value }],
    selectionStrategy: "FIRST",
  },
});
/** @param {string} message @param {unknown} value @param {string[]} [groups] */
const delivery = (message, value, groups = [DEFAULT_GROUP]) => ({
  deliveryDiscountsAdd: {
    candidates: [{ message, targets: groups.map((id) => ({ deliveryGroup: { id } })), value }],
    selectionStrategy: "ALL",
  },
});

const AUTO = /** @type {const} */ ({ kind: "automatic" });
const codeNode = (/** @type {string} */ ruleId) => ({ kind: /** @type {const} */ ("code"), ruleId });
const won = (/** @type {string[]} */ ...ruleIds) => ({ ruleIds });
/** The variant metafield `$app:won_discounts`/`variant` (MVP 2): cost in MAJOR units of `cur`. */
const costOf = (/** @type {number} */ cost, cur = "CZK") => ({ cost, cur });
/** modules.margin of the merchant config with protection ON. */
const marginOn = (/** @type {Record<string, number>} */ global, /** @type {Record<string, unknown>[]} */ perCollection = []) => ({
  enabled: true,
  global,
  perCollection,
});

// --- Shared configs ------------------------------------------------------------------------

/** Markets of the "amounts per market" scenarios: two euro markets (Germany's has two countries) and the Czech one. */
const MARKET_AMOUNT_MARKETS = [
  { handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] },
  { handle: "sk", currency: "EUR", enabled: true, countries: ["SK"] },
  { handle: "de", currency: "EUR", enabled: true, countries: ["DE", "AT"] },
];

/** modules.tiers of the merchant config (MVP 3): `sets` = TierSet[]. */
const tiers = (/** @type {Record<string, unknown>[]} */ ...sets) => ({ sets });
/** A tier set: `scope` "global" or `{ productIds }` (Pro), counted per `countAcross`. */
const tierSet = (/** @type {string} */ id, /** @type {string} */ countAcross, /** @type {Record<string, unknown>[]} */ breaks, /** @type {unknown} */ scope = "global") => ({
  id,
  scope,
  countAcross,
  breaks,
});
const MINUS = "\u2212";
const NBSP = "\u00a0";
/** describeTierBreak (cs) of a percent break: "Od 3 ks −10 %". */
const fromPct = (/** @type {number} */ n, /** @type {number} */ p) => `Od ${n} ks ${MINUS}${p}${NBSP}%`;
/** describeTierBreak (cs) of an amount break: "Od 2 ks −50 Kč za kus" (`money` as formatMoney writes it). */
const fromAmount = (/** @type {number} */ n, /** @type {string} */ money) => `Od ${n} ks ${MINUS}${money} za kus`;

const SUMMER = pct("summer", 10, { name: "Letní sleva" });
const WELCOME = withCodes(["WELCOME15"], pct("welcome", 15, { name: "Vítejte" }));
/** A generated batch (code-batch.ts) of a fixed seed: 100 codes "BF-" + 10 characters. */
const BATCH = { id: "b1", prefix: "BF-", count: 100, seed: "000102030405060708090a0b0c0d0e0f", length: 10, alphabet: "both" };
const BATCH_CODES = generateBatchCodes(BATCH);
const BATCH_RULE = pct("davka", 15, { name: "Black Friday", method: "code", codeBatches: [BATCH] });
const ORDER5 = orderPct("order5", 5, { name: "5 % na objednávku" });
const SHIP = freeShip("ship", { name: "Doprava zdarma", minimum: { subtotal: { CZK: 100000 } } });

/** @returns {Scenario[]} */
function allScenarios() {
  return [
  // --- automatic node alone --------------------------------------------------------------
  {
    name: "lines-auto-alone",
    description: "Automatic node, one automatic rule: only the targeted line gets 10 %.",
    target: "lines",
    rules: [SUMMER],
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", won: won("summer") },
      { n: 2, price: "200.0", qty: 2, won: null },
    ],
    expected: out(products(pc("Letní sleva", [1], percent(10)))),
  },
  {
    name: "lines-auto-value-mapping",
    description:
      "Automatic node: lines with the same rule share one candidate; a fixed amount per item is capped at the unit price, and a capped one (50 Kč on a 30 Kč item: the item is free) is emitted as 100 % — the same discount, and it groups across prices.",
    target: "lines",
    rules: [SUMMER, fixed("tenoff", { CZK: 5000 }, { name: "Sleva 50 Kč" })],
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", won: won("summer") },
      { n: 2, price: "249.9", qty: 3, won: won("summer") },
      { n: 3, price: "30.0", qty: 2, won: won("tenoff") },
      { n: 4, price: "80.0", won: won("tenoff") },
    ],
    expected: out(
      products(
        pc("Letní sleva", [1, 2], percent(10)),
        pc("Sleva 50 Kč", [3], percent(100)),
        pc("Sleva 50 Kč", [4], perItem("50.00")),
      ),
    ),
  },
  {
    name: "lines-variant-targeting",
    description:
      "Product metafield variantRuleIds: only the listed variant of the product gets the rule; ruleIds applies to every variant.",
    target: "lines",
    rules: [SUMMER, pct("vip", 20, { name: "VIP varianta" })],
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", variant: 11, won: { ruleIds: ["summer"], variantRuleIds: { [variantId(11)]: ["vip"] } } },
      { n: 2, price: "100.0", variant: 12, won: { ruleIds: ["summer"], variantRuleIds: { [variantId(11)]: ["vip"] } } },
    ],
    expected: out(products(pc("VIP varianta", [1], percent(20)), pc("Letní sleva", [2], percent(10)))),
  },

  // --- code node triggered with its own code ---------------------------------------------
  {
    name: "lines-code-own-trigger",
    description: "Code node triggered by its own code (entered in lower case): 15 % on the targeted line.",
    target: "lines",
    rules: [WELCOME],
    role: codeNode("welcome"),
    triggering: "welcome15",
    entered: ["welcome15"],
    lines: [
      { n: 1, price: "100.0", won: won("welcome") },
      { n: 2, price: "50.0", won: null },
    ],
    expected: out(products(pc("Vítejte", [1], percent(15)))),
  },
  {
    name: "lines-code-trigger-mismatch",
    description: "Code node whose triggering code is not one of its rule's codes emits nothing.",
    target: "lines",
    rules: [WELCOME],
    role: codeNode("welcome"),
    triggering: "SOMEONEELSE",
    entered: ["SOMEONEELSE", "WELCOME15"],
    lines: [{ n: 1, price: "100.0", won: won("welcome") }],
    expected: NONE,
  },

  // --- automatic + code on the same line: only the winner's node emits -------------------
  {
    name: "lines-compete-code-wins-auto-node",
    description: "Code 15 % beats automatic 10 % on line 1: the automatic node emits only line 2.",
    target: "lines",
    rules: [SUMMER, WELCOME],
    role: AUTO,
    entered: ["WELCOME15"],
    lines: [
      { n: 1, price: "100.0", won: won("summer", "welcome") },
      { n: 2, price: "100.0", won: won("summer") },
    ],
    expected: out(products(pc("Letní sleva", [2], percent(10)))),
  },
  {
    name: "lines-compete-code-wins-code-node",
    description: "Code 15 % beats automatic 10 % on line 1: the code node emits line 1.",
    target: "lines",
    rules: [SUMMER, WELCOME],
    role: codeNode("welcome"),
    triggering: "WELCOME15",
    entered: ["WELCOME15"],
    lines: [
      { n: 1, price: "100.0", won: won("summer", "welcome") },
      { n: 2, price: "100.0", won: won("summer") },
    ],
    expected: out(products(pc("Vítejte", [1], percent(15)))),
  },
  {
    name: "lines-compete-auto-wins-auto-node",
    description: "Automatic 20 % beats code 15 % on line 1: the automatic node emits both lines.",
    target: "lines",
    rules: [pct("summer", 20, { name: "Letní sleva" }), WELCOME],
    role: AUTO,
    entered: ["WELCOME15"],
    lines: [
      { n: 1, price: "100.0", won: won("summer", "welcome") },
      { n: 2, price: "100.0", won: won("summer") },
    ],
    expected: out(products(pc("Letní sleva", [1, 2], percent(20)))),
  },
  {
    name: "lines-compete-auto-wins-code-node",
    description: "Automatic 20 % beats code 15 % everywhere: the code node emits nothing (Shopify shows the code as not applicable).",
    target: "lines",
    rules: [pct("summer", 20, { name: "Letní sleva" }), WELCOME],
    role: codeNode("welcome"),
    triggering: "WELCOME15",
    entered: ["WELCOME15"],
    lines: [
      { n: 1, price: "100.0", won: won("summer", "welcome") },
      { n: 2, price: "100.0", won: won("summer") },
    ],
    expected: NONE,
  },

  // --- order + product stack ---------------------------------------------------------------
  {
    name: "lines-order-product-stack-auto",
    description:
      "Automatic product 10 % and automatic order 5 % stack; a custom (non-product) line is part of the order subtotal.",
    target: "lines",
    rules: [SUMMER, ORDER5],
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", won: won("summer") },
      { n: 2, price: "300.0", won: null },
      { n: 3, price: "40.0", custom: true },
    ],
    expected: out(products(pc("Letní sleva", [1], percent(10))), order("5 % na objednávku", [], percent(5))),
  },
  {
    name: "lines-order-product-stack-code-node",
    description: "Code order discount + automatic product discount: the code node emits only its order discount.",
    target: "lines",
    rules: [SUMMER, withCodes(["OBJ100"], { ...ORDER5, id: "obj", name: "100 Kč na objednávku", value: { kind: "fixed", amount: { CZK: 10000 } } })],
    role: codeNode("obj"),
    triggering: "OBJ100",
    entered: ["OBJ100"],
    lines: [
      { n: 1, price: "100.0", won: won("summer") },
      { n: 2, price: "300.0", won: null },
    ],
    expected: out({
      orderDiscountsAdd: {
        candidates: [
          {
            message: "100 Kč na objednávku",
            targets: [{ orderSubtotal: { excludedCartLineIds: [] } }],
            value: { fixedAmount: { amount: "100.00" } },
          },
        ],
        selectionStrategy: "FIRST",
      },
    }),
  },
  {
    name: "lines-product-class-only",
    description: "A node without the ORDER class never emits an order candidate (only the classes it was created with).",
    target: "lines",
    rules: [SUMMER, ORDER5],
    role: AUTO,
    classes: ["PRODUCT"],
    lines: [{ n: 1, price: "100.0", won: won("summer") }],
    expected: out(products(pc("Letní sleva", [1], percent(10)))),
  },

  // --- free shipping on the delivery target ----------------------------------------------
  {
    name: "delivery-free-shipping-auto",
    description: "Automatic free shipping over 1 000 Kč: 100 % on every delivery group.",
    target: "delivery",
    rules: [SUMMER, SHIP],
    role: AUTO,
    lines: [
      { n: 1, price: "700.0", won: won("summer") },
      { n: 2, price: "400.0", won: null },
    ],
    deliveryGroups: [DEFAULT_GROUP, "gid://shopify/CartDeliveryGroup/2"],
    expected: out(delivery("Doprava zdarma", percent(100), [DEFAULT_GROUP, "gid://shopify/CartDeliveryGroup/2"])),
  },
  {
    name: "delivery-free-shipping-below-minimum",
    description: "Free shipping minimum 1 000 Kč not reached (pre-discount subtotal 900 Kč): no delivery discount.",
    target: "delivery",
    rules: [SHIP],
    role: AUTO,
    lines: [{ n: 1, price: "300.0", qty: 3, won: null }],
    expected: NONE,
  },
  {
    name: "delivery-free-shipping-code",
    description: "Free-shipping code on its code node: 100 % on the delivery group.",
    target: "delivery",
    rules: [withCodes(["DOPRAVA"], freeShip("shipcode", { name: "Doprava zdarma s kódem" }))],
    role: codeNode("shipcode"),
    triggering: "DOPRAVA",
    entered: ["DOPRAVA"],
    lines: [{ n: 1, price: "100.0", won: null }],
    expected: out(delivery("Doprava zdarma s kódem", percent(100))),
  },
  // "A node without the SHIPPING class never emits a delivery candidate": no fixture any more — the delivery
  // query does not read the classes (MVP 5) and Shopify runs the target only for a SHIPPING node; the guard for
  // an input that lists them is tests/parity.test.js "delivery: the classes".
  {
    name: "lines-free-shipping-only",
    description: "The lines target of a node with only a free-shipping rule emits nothing (shipping is the delivery target's job).",
    target: "lines",
    rules: [SHIP],
    role: AUTO,
    lines: [{ n: 1, price: "2000.0", won: null }],
    expected: NONE,
  },

  // --- outlet and gift lines are excluded ------------------------------------------------
  {
    name: "lines-outlet-excluded",
    description:
      "Outlet line (product metafield outlet: true) gets no product discount and is excluded from the order subtotal.",
    target: "lines",
    rules: [SUMMER, ORDER5],
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", won: won("summer") },
      { n: 2, price: "100.0", won: { ruleIds: ["summer"], outlet: true } },
      { n: 3, price: "100.0", variant: 31, won: { ruleIds: ["summer"], outlet: [variantId(31)] } },
      { n: 4, price: "100.0", variant: 32, won: { ruleIds: ["summer"], outlet: [variantId(31)] } },
    ],
    expected: out(products(pc("Letní sleva", [1, 4], percent(10))), order("5 % na objednávku", [2, 3], percent(5))),
  },
  {
    name: "lines-outlet-variant-flag",
    description:
      "MVP 5 (Výprodej, O6): a variant whose own metafield outlet is exactly true is on sale — no product discount, out of the order subtotal (with or without a product metafield); false or the text \"true\" is not a flag.",
    target: "lines",
    rules: [SUMMER, ORDER5],
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", won: won("summer") },
      { n: 2, price: "100.0", won: won("summer"), variantOutlet: true },
      { n: 3, price: "100.0", won: won("summer"), variantOutlet: false },
      { n: 4, price: "100.0", won: won("summer"), variantOutlet: "true" },
      { n: 5, price: "100.0", variantOutlet: true },
    ],
    expected: out(products(pc("Letní sleva", [1, 3, 4], percent(10))), order("5 % na objednávku", [2, 5], percent(5))),
  },
  {
    name: "lines-outlet-variant-flag-with-anything",
    description: "MVP 5: with engine.combination.outletWithAnything the variant flag excludes nothing (the same as a product outlet).",
    target: "lines",
    rules: [SUMMER, ORDER5],
    role: AUTO,
    configExtra: { engine: { combination: { outletWithAnything: true } } },
    lines: [
      { n: 1, price: "100.0", won: won("summer") },
      { n: 2, price: "100.0", won: won("summer"), variantOutlet: true },
    ],
    expected: out(products(pc("Letní sleva", [1, 2], percent(10))), order("5 % na objednávku", [], percent(5))),
  },
  {
    name: "lines-gift-excluded",
    description: "A `_won_gift` line is outside every discount: no product discount, excluded from the order subtotal.",
    target: "lines",
    rules: [SUMMER, ORDER5],
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", won: won("summer") },
      { n: 2, price: "100.0", gift: "tier-1", won: won("summer") },
    ],
    expected: out(products(pc("Letní sleva", [1], percent(10))), order("5 % na objednávku", [2], percent(5))),
  },

  // --- currency ------------------------------------------------------------------------------
  {
    name: "lines-currency-missing",
    description: "A fixed amount with no value for the cart currency (EUR only, cart in CZK) is never applied — not 0, not converted.",
    target: "lines",
    rules: [fixed("eur5", { EUR: 500 }, { name: "5 EUR" })],
    role: AUTO,
    lines: [{ n: 1, price: "100.0", won: won("eur5") }],
    expected: NONE,
  },
  {
    name: "lines-currency-eur",
    description: "The same rule in an EUR cart: 5.00 per item.",
    target: "lines",
    rules: [fixed("eur5", { EUR: 500 }, { name: "5 EUR" })],
    role: AUTO,
    currency: "EUR",
    country: "SK",
    language: "SK",
    lines: [{ n: 1, price: "12.5", qty: 2, won: won("eur5") }],
    expected: out(products(pc("5 EUR", [1], perItem("5.00")))),
  },

  // --- schedules (shop-local day) --------------------------------------------------------------
  {
    name: "lines-schedule-not-started",
    description: "A rule starting tomorrow (shop date 2026-10-01, Prague offset) is not live today.",
    target: "lines",
    rules: [pct("summer", 10, { name: "Letní sleva", schedule: { startsAt: "2026-10-02T00:00:00+02:00" } })],
    role: AUTO,
    lines: [{ n: 1, price: "100.0", won: won("summer") }],
    expected: NONE,
  },
  {
    name: "lines-schedule-last-day",
    description: "A rule ending today at 23:59:59 is live all day (day granularity, end inclusive).",
    target: "lines",
    rules: [pct("summer", 10, { name: "Letní sleva", schedule: { startsAt: "2026-09-01T00:00:00+02:00", endsAt: "2026-10-01T23:59:59+02:00" } })],
    role: AUTO,
    lines: [{ n: 1, price: "100.0", won: won("summer") }],
    expected: out(products(pc("Letní sleva", [1], percent(10)))),
  },

  // --- shared config missing / invalid -----------------------------------------------------
  {
    name: "lines-config-null",
    description: "Shop config null (e.g. over 10 000 B, C7): no operations, no error.",
    target: "lines",
    rules: [SUMMER],
    role: AUTO,
    shopConfig: "null",
    lines: [{ n: 1, price: "100.0", won: won("summer") }],
    expected: NONE,
  },
  {
    name: "lines-config-invalid",
    description: "Shop config of the wrong shape (the C7 prototype value {percent: 9}): no operations.",
    target: "lines",
    rules: [SUMMER],
    role: AUTO,
    shopConfig: { percent: 9 },
    lines: [{ n: 1, price: "100.0", won: won("summer") }],
    expected: NONE,
  },
  {
    name: "delivery-config-null",
    description: "Shop config null on the delivery target: no operations.",
    target: "delivery",
    rules: [SHIP],
    role: AUTO,
    shopConfig: "null",
    lines: [{ n: 1, price: "2000.0", won: null }],
    expected: NONE,
  },
  {
    name: "lines-vars-missing",
    description:
      "No node variables (local runner only: on the platform the run fails before the JS, C4): the role is unknown, nothing is emitted.",
    target: "lines",
    rules: [SUMMER],
    role: AUTO,
    varsPatch: () => null,
    lines: [{ n: 1, price: "100.0", won: won("summer") }],
    expected: NONE,
  },
  {
    name: "lines-auto-role-with-trigger",
    description: "Automatic variables on a node that has a triggering code are inconsistent: nothing is emitted (never automatic value twice).",
    target: "lines",
    rules: [SUMMER],
    role: AUTO,
    triggering: "WELCOME15",
    entered: ["WELCOME15"],
    lines: [{ n: 1, price: "100.0", won: won("summer") }],
    expected: NONE,
  },

  // --- campaigns (C4/C7 versioned variables) -------------------------------------------------
  campaign("lines-campaign-match", "Campaign live and the node's campaign id + varsVersion match the shop config: override 30 % applies.", {
    active: true,
    expected: out(products(pc("Letní sleva", [1], percent(30)))),
  }),
  campaign(
    "lines-campaign-version-mismatch",
    "Campaign live but the node's varsVersion is stale (mid-sync): no campaign overrides, the base 10 % applies.",
    {
      active: true,
      varsPatch: (vars) => ({ ...vars, varsVersion: "vstale000" }),
      expected: out(products(pc("Letní sleva", [1], percent(10)))),
    },
  ),
  campaign("lines-campaign-inactive", "Campaign window not live (dateTimeBetween false): the base 10 % applies.", {
    active: false,
    expected: out(products(pc("Letní sleva", [1], percent(10)))),
  }),

  // --- campaign tier sets (MVP 6.1, plan-tiers.ts step 8) -------------------------------------
  campaignTiers(
    "lines-campaign-tiers-live",
    "A live campaign that carries tier sets: the function reads the campaign's sets instead of the base ones. The global set is 2 items −10 % in the base and 2 items −20 %, 4 items −30 % in the campaign: line 1 (2 items) gets 20 %, line 2 (4 items) 30 %. The Pro set of product 3 has no override: its 2 items −5 % ships in the campaign's sets too (line 3).",
    { active: true, expected: out(products(pc(fromPct(2, 20), [1], percent(20)), pc(fromPct(4, 30), [2], percent(30)), pc(fromPct(2, 5), [3], percent(5)))) },
  ),
  campaignTiers("lines-campaign-tiers-inactive", "The same config outside the campaign's window (dateTimeBetween false): the base sets, 2 items −10 % on lines 1 and 2.", {
    active: false,
    expected: out(products(pc(fromPct(2, 10), [1, 2], percent(10)), pc(fromPct(2, 5), [3], percent(5)))),
  }),
  campaignTiers(
    "lines-campaign-tiers-version-mismatch",
    "The campaign is live but the node's varsVersion is stale (mid-sync): the base sets apply, as for a rule override.",
    {
      active: true,
      varsPatch: (vars) => ({ ...vars, varsVersion: "vstale000" }),
      expected: out(products(pc(fromPct(2, 10), [1, 2], percent(10)), pc(fromPct(2, 5), [3], percent(5)))),
    },
  ),

  // --- a big variant outlet list on many lines of one product --------------------------------
  outletListShared(),

  // --- minimum scope (audit MVP 1 native F5) ---------------------------------------------------
  {
    name: "lines-minimum-cart-vs-entitled",
    description:
      "Two product rules with a 1 000 Kč minimum. The cart minimum counts the whole cart (1 100 Kč: applies); the entitled minimum counts only its own lines (300 Kč: does not apply).",
    target: "lines",
    rules: [
      pct("cart", 10, { name: "Košík nad 1000", minimum: { subtotal: { CZK: 100000 } } }),
      pct("entitled", 20, { name: "Nákup nad 1000 z vybraných", minimum: { subtotal: { CZK: 100000 }, scope: "entitled" } }),
    ],
    role: AUTO,
    lines: [
      { n: 1, price: "600.0", won: won("cart") },
      { n: 2, price: "300.0", won: won("entitled") },
      { n: 3, price: "200.0", won: null },
    ],
    expected: out(products(pc("Košík nad 1000", [1], percent(10)))),
  },
  {
    name: "lines-minimum-entitled-reached",
    description:
      "The entitled minimum (1 000 Kč and 3 items of its own lines, an outlet line of the rule included, a gift line never) is reached: 20 % on its discountable lines.",
    target: "lines",
    rules: [pct("entitled", 20, { name: "Nákup nad 1000 z vybraných", minimum: { subtotal: { CZK: 100000 }, quantity: 3, scope: "entitled" } })],
    role: AUTO,
    lines: [
      { n: 1, price: "400.0", qty: 2, won: won("entitled") },
      { n: 2, price: "200.0", won: { ruleIds: ["entitled"], outlet: true } },
      { n: 3, price: "900.0", gift: "tier-1", won: won("entitled") },
    ],
    expected: out(products(pc("Nákup nad 1000 z vybraných", [1], percent(20)))),
  },

  // --- rounding ties are emitted as exact amounts (audit MVP 1 drift #4) ---------------------------
  {
    name: "lines-rounding-tie-exact",
    description:
      "10 % of 10.05 Kč is 100.5 haléřů: Shopify might round that tie down, so the line gets its exact 1.01 Kč per item; 10.04 Kč keeps the percent. A Pro stack 10 % + 5 % on 3 × 33.30 Kč (1 498.5 → 14.99 Kč) is its exact total once, not 15 %. The order percent on a half-way base (10 % of 104.05 Kč) is its exact 10.41 Kč.",
    target: "lines",
    rules: [
      pct("ten", 10, { name: "Deset" }),
      pct("a", 10, { name: "A", combinesWith: { ruleIds: ["b"] } }),
      pct("b", 5, { name: "B" }),
      orderPct("obj", 10, { name: "Objednávka" }),
    ],
    role: AUTO,
    lines: [
      { n: 1, price: "10.05", won: won("ten") },
      { n: 2, price: "10.04", won: won("ten") },
      { n: 3, price: "33.30", qty: 3, won: won("a", "b") },
      { n: 4, price: "1.06", won: null },
    ],
    // Order base: 10.05 + 10.04 + 99.90 + 1.06 − (1.01 + 1.00 + 14.99) = 104.05 Kč → 1 040.5 haléřů → 10.41 Kč.
    expected: out(
      products(pc("Deset", [1], perItem("1.01")), pc("Deset", [2], percent(10)), pc("A + B", [3], lineTotal("14.99"))),
      { orderDiscountsAdd: { candidates: [{ message: "Objednávka", targets: [{ orderSubtotal: { excludedCartLineIds: [] } }], value: { fixedAmount: { amount: "10.41" } } }], selectionStrategy: "FIRST" } },
    ),
  },

  // --- a fixed shipping amount on a split shipment (audit MVP 1 drift #5) ------------------------
  {
    name: "delivery-fixed-shipping-first-group",
    description:
      "A fixed 50 Kč off shipping with two delivery groups: only the first group gets it (the plan gives 50 Kč once; a candidate on both groups could be applied to each).",
    target: "delivery",
    rules: [fixed("flat", { CZK: 5000 }, { name: "50 Kč z dopravy", target: { kind: "shipping" } })],
    role: AUTO,
    lines: [{ n: 1, price: "700.0", won: null }],
    deliveryGroups: [DEFAULT_GROUP, "gid://shopify/CartDeliveryGroup/2"],
    expected: out({
      deliveryDiscountsAdd: {
        candidates: [{ message: "50 Kč z dopravy", targets: [{ deliveryGroup: { id: DEFAULT_GROUP } }], value: { fixedAmount: { amount: "50.00" } } }],
        selectionStrategy: "ALL",
      },
    }),
  },

  // --- a 3-decimal currency (fixtures were CZK / EUR only) ------------------------------------------
  {
    name: "lines-currency-bhd",
    description: "A BHD cart (3 decimals): 1.250 BHD per item and 10 % print in the currency's minor units.",
    target: "lines",
    rules: [fixed("bhd", { BHD: 1250 }, { name: "1.250 BHD" }), pct("ten", 10, { name: "Deset" })],
    role: AUTO,
    currency: "BHD",
    country: "BH",
    language: "EN",
    lines: [
      { n: 1, price: "12.5", qty: 2, won: won("bhd") },
      { n: 2, price: "7.25", won: won("ten") },
    ],
    // 10 % of 7.250 BHD = 725 fils (no tie): the percent.
    expected: out(products(pc("1.250 BHD", [1], perItem("1.250")), pc("Deset", [2], percent(10)))),
  },

  // --- margin protection (MVP 2, spec §3 bod 7; @won/core margin.ts) --------------------------
  //
  // Floor of one item: cost known → ceil(cost / (1 − m/100)), else price × (1 − p/100).
  // A product allocation above the line's headroom (subtotal − floor × quantity) is cut,
  // in rank order, and emitted as that exact amount; the order discount leaves out
  // lines at their floor or is lowered to what is safe on both allocation bases,
  // keeping 1 minor unit per line for rounding. Off by default.
  {
    name: "lines-margin-product-cap",
    description:
      "Margin protection: cost 700 Kč + minimum margin 20 % → floor 875 Kč. 30 % would take the 1 000 Kč item to 700 Kč, so line 1 gets exactly 125 Kč (an exact amount, never a percent). Line 2 has no cost price: the 50 % ceiling leaves its 30 % alone.",
    target: "lines",
    rules: [pct("summer", 30, { name: "Letní sleva" })],
    margin: marginOn({ minMarginPercent: 20, maxDiscountPercent: 50 }),
    role: AUTO,
    lines: [
      { n: 1, price: "1000.0", won: won("summer"), variantMeta: costOf(700) },
      { n: 2, price: "200.0", qty: 2, won: won("summer") },
    ],
    expected: out(products(pc("Letní sleva", [1], perItem("125.00")), pc("Letní sleva", [2], percent(30)))),
  },
  {
    name: "lines-margin-no-cost-max-percent",
    description:
      "No usable cost price → the maximum discount % (20 %) is the ceiling: no variant metafield, a cost in another currency than the shop's, a cost that is not a number, a lower-case currency, a zero cost. A fixed amount per item is capped on the whole line (3 × 500 Kč: 300 Kč per item → 100 Kč per item). A usable cost (5 Kč) leaves the 30 % alone.",
    target: "lines",
    rules: [pct("summer", 30, { name: "Letní sleva" }), fixed("flat", { CZK: 30000 }, { name: "300 Kč z kusu" })],
    margin: marginOn({ maxDiscountPercent: 20 }),
    role: AUTO,
    lines: [
      { n: 1, price: "1000.0", won: won("summer") },
      { n: 2, price: "500.0", qty: 3, won: won("flat") },
      { n: 3, price: "100.0", won: won("summer"), variantMeta: costOf(10, "EUR") },
      { n: 4, price: "100.0", won: won("summer"), variantMeta: { cost: "5", cur: "CZK" } },
      { n: 5, price: "100.0", won: won("summer"), variantMeta: costOf(5, "czk") },
      { n: 6, price: "100.0", won: won("summer"), variantMeta: costOf(0) },
      { n: 7, price: "100.0", won: won("summer"), variantMeta: costOf(5) },
    ],
    expected: out(
      products(
        pc("Letní sleva", [1], perItem("200.00")),
        pc("300 Kč z kusu", [2], perItem("100.00")),
        pc("Letní sleva", [3, 4, 5, 6], perItem("20.00")),
        pc("Letní sleva", [7], percent(30)),
      ),
    ),
  },
  {
    name: "lines-margin-stack-cut-auto-node",
    description:
      "Pro stack A 20 % + code B 10 % on a 1 000 Kč item without a cost price, 15 % ceiling: the 150 Kč headroom is taken in rank order — A keeps 150 Kč, B nothing — so the owner moves from the code rule to A and the automatic node emits it.",
    target: "lines",
    rules: [pct("a", 20, { name: "Sleva A", combinesWith: { ruleIds: ["b"] } }), withCodes(["KOD"], pct("b", 10, { name: "Kód B" }))],
    margin: marginOn({ maxDiscountPercent: 15 }),
    role: AUTO,
    entered: ["KOD"],
    lines: [{ n: 1, price: "1000.0", won: won("a", "b") }],
    expected: out(products(pc("Sleva A", [1], perItem("150.00")))),
  },
  {
    name: "lines-margin-stack-cut-code-node",
    description:
      "The same Pro stack with a 25 % ceiling: A keeps 200 Kč, B gets the remaining 50 Kč. The stack still contains the code, so the code node emits it, as one exact 250 Kč.",
    target: "lines",
    rules: [pct("a", 20, { name: "Sleva A", combinesWith: { ruleIds: ["b"] } }), withCodes(["KOD"], pct("b", 10, { name: "Kód B" }))],
    margin: marginOn({ maxDiscountPercent: 25 }),
    role: codeNode("b"),
    triggering: "KOD",
    entered: ["KOD"],
    lines: [{ n: 1, price: "1000.0", won: won("a", "b") }],
    expected: out(products(pc("Sleva A + Kód B", [1], perItem("250.00")))),
  },
  {
    name: "lines-margin-capped-exact-not-percent",
    description:
      "A capped value is emitted as its exact amount even when it equals a percent of the line: Pro stack A 10 % + B 10 % on 10,05 Kč (1,01 + 1,01), 20 % ceiling → headroom 2,01 = round(10,05 × 20 %). As 20 %, Shopify would round it itself; the exact 2,01 never crosses the floor.",
    target: "lines",
    rules: [pct("a", 10, { name: "A", combinesWith: { ruleIds: ["b"] } }), pct("b", 10, { name: "B" })],
    margin: marginOn({ maxDiscountPercent: 20 }),
    role: AUTO,
    lines: [{ n: 1, price: "10.05", won: won("a", "b") }],
    expected: out(products(pc("A + B", [1], perItem("2.01")))),
  },
  {
    name: "lines-margin-collections-strictest",
    description:
      "Collections with their own margin setting (Pro): collection 1 (minimum margin 30 %), collection 2 (maximum discount 10 %), global minimum 10 % and maximum 50 %; the strictest value of each field applies, an empty field is the global value. Line 1 (no cost, both collections): 10 % ceiling → 100 Kč. Line 2 (cost 700 Kč, collection 1): 30 % margin → floor 1 000 Kč, no product discount. Line 3 (cost 700 Kč, a collection without a setting): the global 10 % → floor 777,78 Kč → 222,22 Kč.",
    target: "lines",
    rules: [pct("summer", 30, { name: "Letní sleva" })],
    margin: marginOn({ minMarginPercent: 10, maxDiscountPercent: 50 }, [
      { collectionId: "gid://shopify/Collection/1", minMarginPercent: 30 },
      { collectionId: "gid://shopify/Collection/2", maxDiscountPercent: 10 },
    ]),
    role: AUTO,
    lines: [
      { n: 1, price: "1000.0", won: { ruleIds: ["summer"], marginRefs: ["1", "2"] } },
      { n: 2, price: "1000.0", won: { ruleIds: ["summer"], marginRefs: ["1"] }, variantMeta: costOf(700) },
      { n: 3, price: "1000.0", won: { ruleIds: ["summer"], marginRefs: ["99"] }, variantMeta: costOf(700) },
    ],
    expected: out(products(pc("Letní sleva", [1], perItem("100.00")), pc("Letní sleva", [3], perItem("222.22")))),
  },
  {
    name: "lines-margin-refs-over-limit",
    description:
      "A product whose metafield lists more than 4 marginRefs (legacy data, or hand-made; the sync writes at most 4) is not resolved ref by ref: it takes the store's strictest margin setting, every collection folded into the global values — never looser than any collection it could be in. Global minimum margin 10 % and maximum discount 50 %; collection 1 minimum 20 %, collection 2 maximum 30 %, collection 3 minimum 5 % and maximum 80 % (looser). 90 % off 1 000 Kč: line 1 (collection 3) and line 4 (collection 3 listed 4 times) may give 800 Kč; line 2 (collection 3 listed 5 times) only the strictest 30 % → 300 Kč; line 3 (cost 400 Kč, 5 entries, junk included) the strictest 20 % margin → floor 500 Kč → 500 Kč.",
    target: "lines",
    rules: [pct("ninety", 90, { name: "Sleva 90 %" })],
    margin: marginOn({ minMarginPercent: 10, maxDiscountPercent: 50 }, [
      { collectionId: "gid://shopify/Collection/1", minMarginPercent: 20 },
      { collectionId: "gid://shopify/Collection/2", maxDiscountPercent: 30 },
      { collectionId: "gid://shopify/Collection/3", minMarginPercent: 5, maxDiscountPercent: 80 },
    ]),
    role: AUTO,
    lines: [
      { n: 1, price: "1000.0", won: { ruleIds: ["ninety"], marginRefs: ["3"] } },
      { n: 2, price: "1000.0", won: { ruleIds: ["ninety"], marginRefs: ["3", "3", "3", "3", "3"] } },
      { n: 3, price: "1000.0", won: { ruleIds: ["ninety"], marginRefs: ["3", "x", 7, null, "3"] }, variantMeta: costOf(400) },
      { n: 4, price: "1000.0", won: { ruleIds: ["ninety"], marginRefs: ["3", "3", "3", "3"] } },
    ],
    expected: out(products(pc("Sleva 90 %", [1, 4], perItem("800.00")), pc("Sleva 90 %", [2], perItem("300.00")), pc("Sleva 90 %", [3], perItem("500.00")))),
  },
  {
    name: "lines-margin-foreign-currency-rate",
    description:
      "Cart in EUR, shop in CZK: the cost (500 Kč) is converted with presentmentCurrencyRate (0.04 → 20 €), + 10 % minimum margin → floor 22,23 €, so 60 % of 40 € is cut to 17,77 €. Line 2 has no cost price: the 30 % ceiling leaves 12 € of its 60 %.",
    target: "lines",
    rules: [pct("sixty", 60, { name: "Sleva 60 %" })],
    margin: marginOn({ minMarginPercent: 10, maxDiscountPercent: 30 }),
    role: AUTO,
    currency: "EUR",
    rate: "0.04",
    lines: [
      { n: 1, price: "40.0", won: won("sixty"), variantMeta: costOf(500) },
      { n: 2, price: "40.0", won: won("sixty") },
    ],
    expected: out(products(pc("Sleva 60 %", [1], perItem("17.77")), pc("Sleva 60 %", [2], perItem("12.00")))),
  },
  {
    name: "lines-margin-rate-invalid",
    description:
      "Cart in EUR, but presentmentCurrencyRate is not a usable rate (0): the cost price cannot be converted, so it is unknown and the 30 % ceiling applies (12 € of 60 %).",
    target: "lines",
    rules: [pct("sixty", 60, { name: "Sleva 60 %" })],
    margin: marginOn({ minMarginPercent: 10, maxDiscountPercent: 30 }),
    role: AUTO,
    currency: "EUR",
    rate: "0.0",
    lines: [{ n: 1, price: "40.0", won: won("sixty"), variantMeta: costOf(500) }],
    expected: out(products(pc("Sleva 60 %", [1], perItem("12.00")))),
  },
  {
    name: "lines-margin-rate-long",
    description:
      "Cart in EUR, presentmentCurrencyRate with more than 15 significant digits (0.0400000000000000012345): it is cut to its first 15 (0.04, an error far below a haléř) — the cost still converts (floor 22,23 €, 60 % cut to 17,77 €) instead of counting as unknown.",
    target: "lines",
    rules: [pct("sixty", 60, { name: "Sleva 60 %" })],
    margin: marginOn({ minMarginPercent: 10, maxDiscountPercent: 30 }),
    role: AUTO,
    currency: "EUR",
    rate: "0.0400000000000000012345",
    lines: [{ n: 1, price: "40.0", won: won("sixty"), variantMeta: costOf(500) }],
    expected: out(products(pc("Sleva 60 %", [1], perItem("17.77")))),
  },
  {
    name: "lines-margin-rate-missing",
    description:
      "Cart in EUR without presentmentCurrencyRate in the input: the cost cannot be converted, so it is unknown and the 30 % ceiling applies (12 € of 60 %). (A null rate is refused by the input schema, Decimal!; the reader reads it as no rate too — src/json.rs.)",
    target: "lines",
    rules: [pct("sixty", 60, { name: "Sleva 60 %" })],
    margin: marginOn({ minMarginPercent: 10, maxDiscountPercent: 30 }),
    role: AUTO,
    currency: "EUR",
    rate: undefined,
    lines: [{ n: 1, price: "40.0", won: won("sixty"), variantMeta: costOf(500) }],
    expected: out(products(pc("Sleva 60 %", [1], perItem("12.00")))),
  },
  {
    name: "lines-margin-currency-jpy",
    description: "Cart in JPY (exponent 0), shop in CZK: cost 100 Kč × rate 6.5 = a 650 ¥ floor, so 50 % of 1 000 ¥ is cut to 350 ¥.",
    target: "lines",
    rules: [pct("half", 50, { name: "Polovina" })],
    margin: marginOn({ maxDiscountPercent: 90 }),
    role: AUTO,
    currency: "JPY",
    rate: "6.5",
    lines: [{ n: 1, price: "1000", won: won("half"), variantMeta: costOf(100) }],
    expected: out(products(pc("Polovina", [1], perItem("350")))),
  },
  {
    name: "lines-margin-off",
    description:
      "Margin protection switched off (the default): its settings, the cost prices, the collection refs and the rate change nothing — the 30 % applies although the cost equals the price.",
    target: "lines",
    rules: [pct("summer", 30, { name: "Letní sleva" })],
    margin: {
      enabled: false,
      global: { minMarginPercent: 90, maxDiscountPercent: 1 },
      perCollection: [{ collectionId: "gid://shopify/Collection/1", maxDiscountPercent: 0 }],
    },
    role: AUTO,
    rate: "0.04",
    lines: [{ n: 1, price: "1000.0", won: { ruleIds: ["summer"], marginRefs: ["1"] }, variantMeta: costOf(1000) }],
    expected: out(products(pc("Letní sleva", [1], percent(30)))),
  },
  {
    name: "lines-margin-campaign",
    description: "A live campaign overrides the rule first (10 % → 70 %), then margin protection caps it: 40 % ceiling → 400 Kč of the 700 Kč.",
    target: "lines",
    rules: [pct("summer", 10, { name: "Letní sleva" })],
    configExtra: {
      campaigns: [
        {
          id: "bf",
          name: "Black Friday",
          window: { start: "2026-09-30T00:00:00", end: "2026-10-05T23:59:59" },
          overrides: [{ ruleId: "summer", patch: { value: { kind: "percentage", percent: 70 } } }],
          killed: false,
        },
      ],
    },
    margin: marginOn({ maxDiscountPercent: 40 }),
    role: AUTO,
    campaignActive: true,
    lines: [{ n: 1, price: "1000.0", won: won("summer") }],
    expected: out(products(pc("Letní sleva", [1], perItem("400.00")))),
  },
  {
    name: "lines-margin-order-left-out",
    description:
      "Order 10 % with margin protection: line 2's cost equals its price (at its floor), so the order discount leaves it out (excludedCartLineIds) and stays 10 % of the other lines — 150 Kč, emitted as that exact amount (with margin protection on, every order discount is: a percent of a base the checkout computes could exceed what the lines can give).",
    target: "lines",
    rules: [orderPct("obj", 10, { name: "Objednávka 10 %" })],
    margin: marginOn({ maxDiscountPercent: 50 }),
    role: AUTO,
    lines: [
      { n: 1, price: "1000.0" },
      { n: 2, price: "1000.0", variantMeta: costOf(1000) },
      { n: 3, price: "500.0" },
    ],
    expected: out(order("Objednávka 10 %", [2], amountOff("150.00"))),
  },
  {
    name: "lines-margin-order-lowered",
    description: "Order 30 % on one 1 000 Kč line without a cost price, 20 % ceiling: lowered to 199,99 Kč (1 haléř kept for rounding), a fixed amount.",
    target: "lines",
    rules: [orderPct("obj", 30, { name: "Objednávka 30 %" })],
    margin: marginOn({ maxDiscountPercent: 20 }),
    role: AUTO,
    lines: [{ n: 1, price: "1000.0" }],
    expected: out(order("Objednávka 30 %", [], amountOff("199.99"))),
  },
  {
    name: "lines-margin-order-both-bases",
    description:
      "Order 20 % after a 50 % product discount, 60 % ceiling: line 1 is 500 Kč after its product discount, floor 400 Kč. Shopify does not say whether it spreads an order discount over the lines before or after product discounts, so the order discount is lowered to what is safe on both (149,98 Kč, 1 haléř per line kept for rounding), an exact amount.",
    target: "lines",
    rules: [pct("half", 50, { name: "Polovina" }), orderPct("obj", 20, { name: "Objednávka 20 %" })],
    margin: marginOn({ maxDiscountPercent: 60 }),
    role: AUTO,
    lines: [
      { n: 1, price: "1000.0", won: won("half") },
      { n: 2, price: "500.0" },
    ],
    expected: out(products(pc("Polovina", [1], percent(50))), order("Objednávka 20 %", [], amountOff("149.98"))),
  },
  {
    name: "lines-margin-order-two-orderings",
    description:
      "The order stage searches the lines in two orderings (headroom per price before, and after, the product discount) and keeps the better one. Line 1: 1 000 Kč with 90 % off (100 Kč left), cost 49,99 Kč → 50 Kč it can give; line 2: 100 Kč, cost 94,99 Kč → 5 Kč. Per price before the discount both have 5 %, so they enter together and line 2 limits the order to 10 Kč; per price after it, line 1 (50 %) alone carries the whole 50 % of 100 Kč. So the order discount is 50 Kč on line 1 (an exact amount), line 2 left out.",
    target: "lines",
    rules: [pct("ninety", 90, { name: "Sleva 90 %" }), orderPct("obj", 50, { name: "Objednávka 50 %" })],
    margin: marginOn({ maxDiscountPercent: 100 }),
    role: AUTO,
    lines: [
      { n: 1, price: "1000.0", won: won("ninety"), variantMeta: costOf(49.99) },
      { n: 2, price: "100.0", variantMeta: costOf(94.99) },
    ],
    expected: out(products(pc("Sleva 90 %", [1], percent(90))), order("Objednávka 50 %", [2], amountOff("50.00"))),
  },
  {
    name: "lines-margin-order-stack-cut",
    description:
      "Pro order stack A 20 % + code B 5 %, 10 % ceiling: lowered to 99,99 Kč, taken in rank order — A alone — so A owns it and the automatic node emits it (B's code gets nothing).",
    target: "lines",
    rules: [
      orderPct("a", 20, { name: "Objednávka A", combinesWith: { ruleIds: ["b"] } }),
      withCodes(["KOD"], orderPct("b", 5, { name: "Kód B" })),
    ],
    margin: marginOn({ maxDiscountPercent: 10 }),
    role: AUTO,
    entered: ["KOD"],
    lines: [{ n: 1, price: "1000.0" }],
    expected: out(order("Objednávka A", [], amountOff("99.99"))),
  },
  {
    name: "lines-margin-order-floored",
    description: "Code order 10 % on a cart whose only line is at its floor (cost = price): no order discount at all, so the code node emits nothing.",
    target: "lines",
    rules: [withCodes(["LETO"], orderPct("leto", 10, { name: "Léto" }))],
    margin: marginOn({ maxDiscountPercent: 50 }),
    role: codeNode("leto"),
    triggering: "LETO",
    entered: ["LETO"],
    lines: [{ n: 1, price: "1000.0", variantMeta: costOf(1000) }],
    expected: NONE,
  },
  {
    name: "lines-margin-order-tied-bound",
    description:
      "17 lines of k × 100 Kč (k = 1–17) whose cost 90k Kč − 1 haléř, with a 0 % minimum margin, leaves each exactly 10 % (h = 10k Kč), so all 17 rates tie; order 30 %. The order search evaluates a set's limit line by line only while at most 16 distinct lines tie for the minimum rate; with more it takes a bound never above the exact value (fail closed): floor((15 300 Kč × 0,1) × (1 − 2⁻⁴⁴)) = 1 529,99 Kč, one haléř below the exact 1 530 Kč. 16 such lines get the exact 1 360 Kč (unit test the_order_search_takes_a_bound_…).",
    target: "lines",
    rules: [orderPct("obj", 30, { name: "Objednávka 30 %" })],
    margin: marginOn({ minMarginPercent: 0, maxDiscountPercent: 100 }),
    role: AUTO,
    lines: Array.from({ length: 17 }, (_, i) => ({ n: i + 1, price: `${100 * (i + 1)}.0`, variantMeta: costOf(Math.round((90 * (i + 1) - 0.01) * 100) / 100) })),
    expected: out(order("Objednávka 30 %", [], amountOff("1529.99"))),
  },
  {
    name: "lines-margin-exclusive",
    description:
      "Product and order discounts exclusive (productWithOrder off), 10 % ceiling: the order-only scenario is protected too — line 2 is at its floor and left out, line 1 can give 99,99 Kč — and that still beats the 50 Kč product scenario, so only the order discount is emitted.",
    target: "lines",
    rules: [pct("a", 5, { name: "Sleva 5 %" }), orderPct("obj", 30, { name: "Objednávka 30 %" })],
    configExtra: { engine: { combination: { productWithOrder: false } } },
    margin: marginOn({ maxDiscountPercent: 10 }),
    role: AUTO,
    lines: [
      { n: 1, price: "1000.0", won: won("a") },
      { n: 2, price: "1000.0", variantMeta: costOf(1000) },
    ],
    expected: out(order("Objednávka 30 %", [2], amountOff("99.99"))),
  },
  {
    name: "lines-margin-product-capped-to-zero",
    description: "The only product discount is capped to 0 (the cost equals the price): the lines target emits nothing.",
    target: "lines",
    rules: [pct("summer", 30, { name: "Letní sleva" }), freeShip("ship", { name: "Doprava zdarma" })],
    configExtra: { engine: { combination: { productWithShipping: false } } },
    margin: marginOn({ maxDiscountPercent: 50 }),
    role: AUTO,
    lines: [{ n: 1, price: "1000.0", won: won("summer"), variantMeta: costOf(1000) }],
    expected: NONE,
  },
  {
    name: "delivery-margin-product-capped-to-zero",
    description:
      "The delivery target of the same cart: product discounts and shipping are exclusive (productWithShipping off), but the product discount is capped to 0, so free shipping applies. The delivery target plans the same cart as the lines target (cost prices, rate, collection refs); without the cost price the 30 % would apply and block the shipping discount.",
    target: "delivery",
    rules: [pct("summer", 30, { name: "Letní sleva" }), freeShip("ship", { name: "Doprava zdarma" })],
    configExtra: { engine: { combination: { productWithShipping: false } } },
    margin: marginOn({ maxDiscountPercent: 50 }),
    role: AUTO,
    lines: [{ n: 1, price: "1000.0", won: won("summer"), variantMeta: costOf(1000) }],
    expected: out(delivery("Doprava zdarma", percent(100))),
  },

  // --- rewards (MVP 4, contracts R1–R3, R6; plan-rewards.ts) -------------------------------------
  {
    name: "lines-rewards-gift-earned",
    description:
      "A gift from 1 500 Kč (variant 2001 or the fallback 2002). The base is the non-gift lines BEFORE discounts: 1 000 + 600 = 1 600 Kč even though a 20 % rule lowers line 1 — the tier is reached. The gift line (1 item, 300 Kč) gets 100 % with \"Dárek zdarma\"; the rule keeps its own candidate on line 1 only (never on the gift).",
    target: "lines",
    rules: [pct("summer", 20, { name: "Léto" })],
    rewards: { gifts: [{ id: "gift-1", threshold: { CZK: 1500_00 }, choices: [variantId(2001)], fallbackVariantId: variantId(2002) }] },
    role: AUTO,
    lines: [
      { n: 1, price: "1000.0", won: won("summer") },
      { n: 2, price: "600.0", won: won() },
      { n: 3, price: "300.0", gift: "gift-1", variant: 2001, won: won("summer") },
    ],
    expected: out(products(pc("Léto", [1], percent(20)), pc("Dárek zdarma", [3], percent(100)))),
  },
  {
    name: "lines-rewards-gift-below-threshold",
    description: "The same gift, the base 1 499,99 Kč: one haléř short — the gift line is paid (no candidate at all).",
    target: "lines",
    rules: [],
    rewards: { gifts: [{ id: "gift-1", threshold: { CZK: 1500_00 }, choices: [variantId(2001)] }] },
    role: AUTO,
    lines: [
      { n: 1, price: "1499.99", won: won() },
      { n: 2, price: "300.0", gift: "gift-1", variant: 2001, won: null },
    ],
    expected: NONE,
  },
  {
    name: "lines-rewards-gift-extra-items-and-lines",
    description:
      "Reached; the first gift line has 3 items at 120 Kč: one item free = 120 Kč off that line (40 Kč per item, the same total). A second gift line of the same tier (the fallback) is paid; a gift line naming an unknown tier and one with a variant the tier does not offer are paid.",
    target: "lines",
    rules: [],
    rewards: { gifts: [{ id: "gift-1", threshold: { CZK: 1000_00 }, choices: [variantId(2001)], fallbackVariantId: variantId(2002) }] },
    role: AUTO,
    lines: [
      { n: 1, price: "2000.0", won: won() },
      { n: 2, price: "120.0", qty: 3, gift: "gift-1", variant: 2001, won: null },
      { n: 3, price: "90.0", gift: "gift-1", variant: 2002, won: null },
      { n: 4, price: "50.0", gift: "nope", variant: 2001, won: null },
      { n: 5, price: "50.0", gift: "gift-1", variant: 2009, won: null },
    ],
    expected: out(products(pc("Dárek zdarma", [2], perItem("40.00")))),
  },
  {
    name: "lines-rewards-gift-ladder-and-currency",
    description:
      "A Pro ladder: 1 000 Kč (gift 2001) and 3 000 Kč (gift 2003, CZK only). The EUR cart of 200 € reaches the first tier (its EUR threshold 40 €); the second tier has no EUR threshold — not offered in this market, its gift line is paid.",
    target: "lines",
    currency: "EUR",
    rules: [],
    rewards: {
      gifts: [
        { id: "gift-1", threshold: { CZK: 1000_00, EUR: 40_00 }, choices: [variantId(2001)] },
        { id: "gift-2", threshold: { CZK: 3000_00 }, choices: [variantId(2003)] },
      ],
    },
    role: AUTO,
    lines: [
      { n: 1, price: "200.0", won: won() },
      { n: 2, price: "10.0", gift: "gift-1", variant: 2001, won: null },
      { n: 3, price: "15.0", gift: "gift-2", variant: 2003, won: null },
    ],
    expected: out(products(pc("Dárek zdarma", [2], percent(100)))),
  },
  {
    name: "lines-rewards-gift-free-plan",
    description:
      "A Free shop: of a two-tier ladder with a choice of two, only the first tier and its first gift ship (BILL-1). Both tiers are reached; the second choice of tier 1 and the gift of tier 2 are paid.",
    target: "lines",
    plan: "free",
    rules: [],
    rewards: {
      gifts: [
        { id: "gift-1", threshold: { CZK: 500_00 }, choices: [variantId(2001), variantId(2004)] },
        { id: "gift-2", threshold: { CZK: 800_00 }, choices: [variantId(2003)] },
      ],
    },
    role: AUTO,
    lines: [
      { n: 1, price: "1000.0", won: won() },
      { n: 2, price: "20.0", gift: "gift-1", variant: 2004, won: null },
      { n: 3, price: "30.0", gift: "gift-2", variant: 2003, won: null },
      { n: 4, price: "40.0", gift: "gift-1", variant: 2001, won: null },
    ],
    expected: out(products(pc("Dárek zdarma", [4], percent(100)))),
  },
  {
    name: "lines-rewards-gift-code-node",
    description: "A code node never emits the gift (the automatic node owns it): the 10 % order code only.",
    target: "lines",
    rules: [withCodes(["DESET"], orderPct("ten", 10, { name: "Deset" }))],
    rewards: { gifts: [{ id: "gift-1", threshold: { CZK: 1000_00 }, choices: [variantId(2001)] }] },
    role: codeNode("ten"),
    triggering: "DESET",
    entered: ["DESET"],
    lines: [
      { n: 1, price: "1000.0", won: won() },
      { n: 2, price: "300.0", gift: "gift-1", variant: 2001, won: null },
    ],
    expected: out(order("Deset", [2], percent(10))),
  },
  {
    name: "delivery-rewards-free-shipping",
    description:
      "Free shipping from 1 000 Kč per currency (R2): 600 + 400 Kč of non-gift lines reach it (the gift line does not count) — the automatic node gives 100 % off delivery, \"Doprava zdarma\".",
    target: "delivery",
    rules: [],
    rewards: { freeShipping: { threshold: { CZK: 1000_00 } }, gifts: [] },
    role: AUTO,
    lines: [
      { n: 1, price: "600.0", won: won() },
      { n: 2, price: "400.0", won: won() },
      { n: 3, price: "500.0", gift: "gift-1", won: null },
    ],
    expected: out(delivery("Doprava zdarma", percent(100))),
  },
  {
    name: "delivery-rewards-below-and-other-currency",
    description: "999,99 Kč is one haléř short; nothing is emitted. (A cart in another currency without a threshold is the same: not offered.)",
    target: "delivery",
    rules: [],
    rewards: { freeShipping: { threshold: { CZK: 1000_00 } }, gifts: [] },
    role: AUTO,
    lines: [{ n: 1, price: "999.99", won: won() }],
    expected: NONE,
  },
  {
    name: "delivery-rewards-vs-shipping-rule",
    description:
      "A 50 % shipping rule and the reached free-shipping reward: 100 % ranks above 50 % — the reward is the one candidate (the rule is outranked).",
    target: "delivery",
    rules: [{ id: "ship50", name: "Půl dopravy", method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "shipping" } }],
    rewards: { freeShipping: { threshold: { CZK: 500_00 } }, gifts: [] },
    role: AUTO,
    lines: [{ n: 1, price: "800.0", won: won() }],
    expected: out(delivery("Doprava zdarma", percent(100))),
  },
  {
    name: "delivery-rewards-switch-blocks",
    description:
      "The Free switch \"product + shipping\" off and a product discount applies (10 % on line 1): every shipping discount is dropped, the reward too.",
    target: "delivery",
    rules: [pct("p10", 10, { name: "Deset" })],
    configExtra: { engine: { combination: { productWithShipping: false } } },
    rewards: { freeShipping: { threshold: { CZK: 500_00 } }, gifts: [] },
    role: AUTO,
    lines: [{ n: 1, price: "800.0", won: won("p10") }],
    expected: NONE,
  },

  // --- quantity tiers (MVP 3, plan-tiers.ts port spec; contracts K1/K2) -----------------------
  {
    name: "lines-tiers-line-count",
    description:
      "One global tier set counted per line: 3 items −10 %, 5 items −15 %. 2 items reach nothing; 3 and 4 items the 3-item break; 5 and 6 items the 5-item break — a line without the product metafield too (no tierRef: the global set). Lines of one break share one candidate, its message the break (\"Od 3 ks −10 %\").",
    target: "lines",
    rules: [],
    tiers: tiers(tierSet("mnozstvi", "line", [{ minQty: 3, percent: 10 }, { minQty: 5, percent: 15 }])),
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", qty: 2, won: won() },
      { n: 2, price: "100.0", qty: 3, won: won() },
      { n: 3, price: "50.0", qty: 4, won: won() },
      { n: 4, price: "100.0", qty: 5, won: won() },
      { n: 5, price: "100.0", qty: 6, won: null },
    ],
    expected: out(products(pc(fromPct(3, 10), [2, 3], percent(10)), pc(fromPct(5, 15), [4, 5], percent(15)))),
  },
  {
    name: "lines-tiers-product-count",
    description:
      "A global set counted per product (3 items −10 %): two variants of product 1 (2 + 1 items) count 3 together; product 2 alone has 2 (nothing); product 3 has 3.",
    target: "lines",
    rules: [],
    tiers: tiers(tierSet("mnozstvi", "product", [{ minQty: 3, percent: 10 }])),
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", qty: 2, product: 1, variant: 11, won: won() },
      { n: 2, price: "80.0", qty: 1, product: 1, variant: 12, won: won() },
      { n: 3, price: "100.0", qty: 2, product: 2, won: won() },
      { n: 4, price: "100.0", qty: 3, product: 3, won: won() },
    ],
    expected: out(products(pc(fromPct(3, 10), [1, 2, 4], percent(10)))),
  },
  {
    name: "lines-tiers-cart-count",
    description:
      "A Pro set counted across the cart (4 items −20 %, 6 items −30 %): lines 1–3 of three products count 4. The gift line (5 items) and the outlet line (3 items) are no part of it: counted, they would make 12 and reach −30 %; neither gets a tier.",
    target: "lines",
    rules: [],
    tiers: tiers(tierSet("kosik", "cart", [{ minQty: 4, percent: 20 }, { minQty: 6, percent: 30 }])),
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", qty: 1, won: won() },
      { n: 2, price: "100.0", qty: 1, won: won() },
      { n: 3, price: "100.0", qty: 2, won: won() },
      { n: 4, price: "100.0", qty: 5, won: won(), gift: "tier-1" },
      { n: 5, price: "100.0", qty: 3, won: { ruleIds: [], outlet: true } },
    ],
    expected: out(products(pc(fromPct(4, 20), [1, 2, 3], percent(20)))),
  },
  {
    name: "lines-tiers-outlet-with-anything",
    description:
      "The cart-counted set with outlet lines combinable (engine.combination.outletWithAnything): the outlet line counts (4 + 3 = 7 items) and gets the tier: −30 % on lines 1–3 and 5; the gift line still not.",
    target: "lines",
    rules: [],
    tiers: tiers(tierSet("kosik", "cart", [{ minQty: 4, percent: 20 }, { minQty: 6, percent: 30 }])),
    configExtra: { engine: { combination: { outletWithAnything: true } } },
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", qty: 1, won: won() },
      { n: 2, price: "100.0", qty: 1, won: won() },
      { n: 3, price: "100.0", qty: 2, won: won() },
      { n: 4, price: "100.0", qty: 5, won: won(), gift: "tier-1" },
      { n: 5, price: "100.0", qty: 3, won: { ruleIds: [], outlet: true } },
    ],
    expected: out(products(pc(fromPct(6, 30), [1, 2, 3, 5], percent(30)))),
  },
  {
    name: "lines-tiers-scoped-ref",
    description:
      "K1: a global set (2 items −5 %) and a Pro set for product 2 (2 items −20 %). Line 1 (no tierRef) and line 5 (no product metafield) take the global set; line 2 (tierRef of the scoped set) the scoped one; line 3 names a set the shop config does not carry and line 4 has a junk tierRef (a number): no tier at all, never the global set (fail closed).",
    target: "lines",
    rules: [],
    tiers: tiers(
      tierSet("zaklad", "line", [{ minQty: 2, percent: 5 }]),
      tierSet("akce", "line", [{ minQty: 2, percent: 20 }], { productIds: [productId(2)] }),
    ),
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", qty: 2, won: won() },
      { n: 2, price: "100.0", qty: 2, won: { ruleIds: [], tierRef: "akce" } },
      { n: 3, price: "100.0", qty: 2, won: { ruleIds: [], tierRef: "smazana" } },
      { n: 4, price: "100.0", qty: 2, won: { ruleIds: [], tierRef: 7 } },
      { n: 5, price: "100.0", qty: 2, won: null },
    ],
    expected: out(products(pc(fromPct(2, 5), [1, 5], percent(5)), pc(fromPct(2, 20), [2], percent(20)))),
  },
  {
    name: "lines-tiers-amount-czk",
    description:
      "Amount breaks per item (MKT-1 per currency): 2 items −50 Kč, 5 items −80 Kč a piece. 2 items of 100 Kč: 50 Kč each. 5 items of 60 Kč: 80 Kč is more than the item, so the item price — emitted as 100 % (the message names the configured 80 Kč). 1 item: nothing.",
    target: "lines",
    rules: [],
    tiers: tiers(tierSet("castka", "line", [{ minQty: 2, amountOff: { CZK: 5000, EUR: 200 } }, { minQty: 5, amountOff: { CZK: 8000, EUR: 300 } }])),
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", qty: 2, won: won() },
      { n: 2, price: "60.0", qty: 5, won: won() },
      { n: 3, price: "100.0", qty: 1, won: won() },
    ],
    expected: out(products(pc(fromAmount(2, `50${NBSP}Kč`), [1], perItem("50.00")), pc(fromAmount(5, `80${NBSP}Kč`), [2], percent(100)))),
  },
  {
    name: "lines-tiers-amount-eur-break-not-offered",
    description:
      "An EUR cart; the 5-item break has an amount in CZK only, so it is not offered in EUR: 5 items reach the highest break offered, 2 items −2 € a piece.",
    target: "lines",
    rules: [],
    tiers: tiers(tierSet("castka", "line", [{ minQty: 2, amountOff: { CZK: 5000, EUR: 200 } }, { minQty: 5, amountOff: { CZK: 8000 } }])),
    role: AUTO,
    currency: "EUR",
    lines: [
      { n: 1, price: "10.0", qty: 5, won: won() },
      { n: 2, price: "10.0", qty: 1, won: won() },
    ],
    expected: out(products(pc(fromAmount(2, `2${NBSP}€`), [1], perItem("2.00")))),
  },
  // --- amounts per market (7 Oct 2026): "EUR@sk" is Slovakia's own amount, "EUR" every other euro market's ---
  {
    name: "lines-market-amount-own",
    description:
      "Amounts per market: the order discount is 16 € in Slovakia and 20 € in Germany (keys EUR@sk / EUR@de), the config says so with `am` and ships both markets' countries. A Slovak EUR cart gets 16 €.",
    target: "lines",
    rules: [{ id: "obj", name: "Sleva na objednávku", enabled: true, method: "automatic", value: { kind: "fixed", amount: { CZK: 40000, "EUR@sk": 1600, "EUR@de": 2000 } }, target: { kind: "order" } }],
    configExtra: { markets: MARKET_AMOUNT_MARKETS },
    role: AUTO,
    currency: "EUR",
    country: "SK",
    lines: [{ n: 1, price: "100.0", qty: 2, won: won() }],
    expected: out(order("Sleva na objednávku", [], amountOff("16.00"))),
  },
  {
    name: "lines-market-amount-other-market",
    description: "The same config, a German EUR cart: Germany's own 20 €.",
    target: "lines",
    rules: [{ id: "obj", name: "Sleva na objednávku", enabled: true, method: "automatic", value: { kind: "fixed", amount: { CZK: 40000, "EUR@sk": 1600, "EUR@de": 2000 } }, target: { kind: "order" } }],
    configExtra: { markets: MARKET_AMOUNT_MARKETS },
    role: AUTO,
    currency: "EUR",
    country: "AT",
    lines: [{ n: 1, price: "100.0", qty: 2, won: won() }],
    expected: out(order("Sleva na objednávku", [], amountOff("20.00"))),
  },
  {
    name: "lines-market-amount-unknown-country",
    description: "The same config, an EUR cart from a country in no market (FR): no market's own amount applies and there is no amount for the currency alone, so nothing is given — never another market's amount.",
    target: "lines",
    rules: [{ id: "obj", name: "Sleva na objednávku", enabled: true, method: "automatic", value: { kind: "fixed", amount: { CZK: 40000, "EUR@sk": 1600, "EUR@de": 2000 } }, target: { kind: "order" } }],
    configExtra: { markets: MARKET_AMOUNT_MARKETS },
    role: AUTO,
    currency: "EUR",
    country: "FR",
    lines: [{ n: 1, price: "100.0", qty: 2, won: won() }],
    expected: NONE,
  },
  {
    name: "lines-market-amount-falls-back-to-currency",
    description:
      "Germany has its own amount and minimum spend (20 € from 200 €), every other euro market the currency's (10 € from 50 €). A Slovak cart of 60 € gets the currency's 10 €: its market has no key of its own.",
    target: "lines",
    rules: [
      { id: "obj", name: "Sleva na objednávku", enabled: true, method: "automatic", value: { kind: "fixed", amount: { EUR: 1000, "EUR@de": 2000 } }, target: { kind: "order" }, minimum: { subtotal: { EUR: 5000, "EUR@de": 20000 } } },
    ],
    configExtra: { markets: MARKET_AMOUNT_MARKETS },
    role: AUTO,
    currency: "EUR",
    country: "SK",
    lines: [{ n: 1, price: "30.0", qty: 2, won: won() }],
    expected: out(order("Sleva na objednávku", [], amountOff("10.00"))),
  },
  {
    name: "lines-market-amount-minimum-of-own-market",
    description: "The same config, a German cart of 60 €: Germany needs 200 €, so nothing — the currency's 50 € minimum is not Germany's.",
    target: "lines",
    rules: [
      { id: "obj", name: "Sleva na objednávku", enabled: true, method: "automatic", value: { kind: "fixed", amount: { EUR: 1000, "EUR@de": 2000 } }, target: { kind: "order" }, minimum: { subtotal: { EUR: 5000, "EUR@de": 20000 } } },
    ],
    configExtra: { markets: MARKET_AMOUNT_MARKETS },
    role: AUTO,
    currency: "EUR",
    country: "DE",
    lines: [{ n: 1, price: "30.0", qty: 2, won: won() }],
    expected: NONE,
  },
  {
    name: "lines-market-amount-tiers",
    description:
      "Quantity tiers per market: from 2 items −2 € in every euro market, from 5 items −3 € in Slovakia and −4 € in Germany. The set's columns are EUR, EUR@de, EUR@sk; a German cart reads Germany's column in every break: 2 items −2 €, 5 items −4 €.",
    target: "lines",
    rules: [],
    tiers: tiers(tierSet("castka", "line", [{ minQty: 2, amountOff: { CZK: 5000, EUR: 200 } }, { minQty: 5, amountOff: { CZK: 8000, "EUR@sk": 300, "EUR@de": 400 } }])),
    configExtra: { markets: MARKET_AMOUNT_MARKETS },
    role: AUTO,
    currency: "EUR",
    country: "DE",
    lines: [
      { n: 1, price: "10.0", qty: 5, won: won() },
      { n: 2, price: "10.0", qty: 2, won: won() },
    ],
    expected: out(products(pc(fromAmount(5, `4${NBSP}€`), [1], perItem("4.00")), pc(fromAmount(2, `2${NBSP}€`), [2], perItem("2.00")))),
  },
  {
    name: "lines-market-amount-tiers-unknown-country",
    description: "The same set, an EUR cart from a country in no market: the set's euro columns are Slovakia's and Germany's, none is this cart's — no tier.",
    target: "lines",
    rules: [],
    tiers: tiers(tierSet("castka", "line", [{ minQty: 2, amountOff: { CZK: 5000, EUR: 200 } }, { minQty: 5, amountOff: { CZK: 8000, "EUR@sk": 300, "EUR@de": 400 } }])),
    configExtra: { markets: MARKET_AMOUNT_MARKETS },
    role: AUTO,
    currency: "EUR",
    country: "FR",
    lines: [{ n: 1, price: "10.0", qty: 5, won: won() }],
    expected: NONE,
  },
  {
    name: "lines-tiers-currency-missing",
    description: "A USD cart: no break of the amount set has a USD amount, so no tier is offered (MKT-1).",
    target: "lines",
    rules: [],
    tiers: tiers(tierSet("castka", "line", [{ minQty: 2, amountOff: { CZK: 5000, EUR: 200 } }, { minQty: 5, amountOff: { CZK: 8000 } }])),
    role: AUTO,
    currency: "USD",
    lines: [{ n: 1, price: "10.0", qty: 5, won: won() }],
    expected: NONE,
  },
  {
    name: "lines-tiers-vs-rules",
    description:
      "A1: the tier (2 items −12 %) competes with the line's product rules, the better one wins, never a sum. Line 1: 12 % beats Letní sleva 10 %. Line 2: VIP 15 % beats the tier. Line 3 (1 item): no tier, Letní sleva. Lines 4 and 5: a rule of 12 % ties the tier, the id decides (dvanact < tier:mnozstvi < zz12).",
    target: "lines",
    rules: [SUMMER, pct("vip", 15, { name: "VIP" }), pct("dvanact", 12, { name: "Dvanáct" }), pct("zz12", 12, { name: "Také dvanáct" })],
    tiers: tiers(tierSet("mnozstvi", "line", [{ minQty: 2, percent: 12 }])),
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", qty: 2, won: won("summer") },
      { n: 2, price: "100.0", qty: 2, won: won("vip") },
      { n: 3, price: "100.0", qty: 1, won: won("summer") },
      { n: 4, price: "100.0", qty: 2, won: won("dvanact") },
      { n: 5, price: "100.0", qty: 2, won: won("zz12") },
    ],
    expected: out(
      products(
        pc(fromPct(2, 12), [1, 5], percent(12)),
        pc("VIP", [2], percent(15)),
        pc("Letní sleva", [3], percent(10)),
        pc("Dvanáct", [4], percent(12)),
      ),
    ),
  },
  {
    name: "lines-tiers-vs-pro-stack",
    description:
      "A tier never stacks; a Pro stack (A 15 % + B 10 %) beats it only with a larger total. Line 1 (1 item): the stack's 25 % beats the tier's 20 %. Line 2 (3 items): the tier's 30 % beats the stack.",
    target: "lines",
    rules: [pct("a", 15, { combinesWith: { ruleIds: ["b"] } }), pct("b", 10)],
    tiers: tiers(tierSet("mnozstvi", "line", [{ minQty: 1, percent: 20 }, { minQty: 3, percent: 30 }])),
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", qty: 1, won: won("a", "b") },
      { n: 2, price: "100.0", qty: 3, won: won("a", "b") },
    ],
    expected: out(products(pc("Sleva a + Sleva b", [1], percent(25)), pc(fromPct(3, 30), [2], percent(30)))),
  },
  {
    name: "lines-tiers-margin-capped",
    description:
      "Margin protection caps a tier like any product discount (minimum margin 20 %, maximum discount 50 %): line 1 (cost 700 Kč, price 1 000 Kč, floor 875 Kč) gets its 125 Kč headroom of the 30 % tier, emitted as that exact amount and named by its break without the value (port spec step 7: never more than the line gets); line 2 (no cost) keeps the 30 % and its message.",
    target: "lines",
    rules: [],
    tiers: tiers(tierSet("mnozstvi", "line", [{ minQty: 1, percent: 30 }])),
    margin: marginOn({ minMarginPercent: 20, maxDiscountPercent: 50 }),
    role: AUTO,
    lines: [
      { n: 1, price: "1000.0", qty: 1, won: won(), variantMeta: costOf(700) },
      { n: 2, price: "200.0", qty: 2, won: won() },
    ],
    expected: out(products(pc("Množstevní sleva od 1 ks", [1], perItem("125.00")), pc(fromPct(1, 30), [2], percent(30)))),
  },
  {
    name: "lines-tiers-exclusive-order",
    description:
      "Free switch product discounts vs the order discount off: the tier (2 items of one product, −10 %: 20 Kč) loses to the order discount (20 % of 200 Kč = 40 Kč); only the order candidate is emitted.",
    target: "lines",
    rules: [orderPct("obj", 20, { name: "Objednávka" })],
    tiers: tiers(tierSet("mnozstvi", "product", [{ minQty: 2, percent: 10 }])),
    configExtra: { engine: { combination: { productWithOrder: false } } },
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", qty: 1, product: 1, variant: 11, won: won() },
      { n: 2, price: "100.0", qty: 1, product: 1, variant: 12, won: won() },
    ],
    expected: out(order("Objednávka", [], percent(20))),
  },
  {
    name: "lines-tiers-code-node",
    description:
      "The code node of Vítejte (WELCOME15 entered): on line 1 its 15 % beats the tier's 10 % and it emits that; the tier on line 2 is automatic — only the automatic node emits it.",
    target: "lines",
    rules: [WELCOME],
    tiers: tiers(tierSet("mnozstvi", "line", [{ minQty: 3, percent: 10 }])),
    role: codeNode("welcome"),
    triggering: "WELCOME15",
    entered: ["WELCOME15"],
    lines: [
      { n: 1, price: "100.0", qty: 3, won: won("welcome") },
      { n: 2, price: "100.0", qty: 3, won: won() },
    ],
    expected: out(products(pc("Vítejte", [1], percent(15)))),
  },
  {
    name: "lines-tiers-code-auto-node",
    description: "The same cart, the automatic node: it emits the tier on line 2 and nothing on line 1 (the code rule's).",
    target: "lines",
    rules: [WELCOME],
    tiers: tiers(tierSet("mnozstvi", "line", [{ minQty: 3, percent: 10 }])),
    role: AUTO,
    entered: ["WELCOME15"],
    lines: [
      { n: 1, price: "100.0", qty: 3, won: won("welcome") },
      { n: 2, price: "100.0", qty: 3, won: won() },
    ],
    expected: out(products(pc(fromPct(3, 10), [2], percent(10)))),
  },
  {
    name: "lines-tiers-free-gated",
    description:
      "A Free shop (the config gated for Free, BILL-1): the global set counted across the cart counts per product instead, and the Pro set for product 2 is kept inert (no break), so its product gets no tier — never the global set. Product 1 (lines 1 and 4, 2 + 1 items) reaches 3 items −10 %; product 3 (line 2, 1 item) does not; line 3 (tierRef of the inert set) gets nothing.",
    target: "lines",
    plan: "free",
    rules: [],
    tiers: tiers(
      tierSet("zaklad", "cart", [{ minQty: 3, percent: 10 }]),
      tierSet("akce", "line", [{ minQty: 1, percent: 50 }], { productIds: [productId(2)] }),
    ),
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", qty: 2, product: 1, variant: 11, won: won() },
      { n: 2, price: "100.0", qty: 1, product: 3, won: won() },
      { n: 3, price: "100.0", qty: 1, product: 2, won: { ruleIds: [], tierRef: "akce" } },
      { n: 4, price: "100.0", qty: 1, product: 1, variant: 12, won: won() },
    ],
    expected: out(products(pc(fromPct(3, 10), [1, 4], percent(10)))),
  },
  {
    name: "lines-tiers-english",
    description: "An English checkout (language EN): the breaks in English — \"From 3 items −10%\", \"From 2 items −CZK 50 per item\".",
    target: "lines",
    rules: [],
    tiers: tiers(
      tierSet("mnozstvi", "line", [{ minQty: 3, percent: 10 }]),
      tierSet("castka", "line", [{ minQty: 2, amountOff: { CZK: 5000 } }], { productIds: [productId(2)] }),
    ),
    role: AUTO,
    language: "EN",
    lines: [
      { n: 1, price: "100.0", qty: 3, won: won() },
      { n: 2, price: "100.0", qty: 2, won: { ruleIds: [], tierRef: "castka" } },
    ],
    expected: out(products(pc(`From 3 items ${MINUS}10%`, [1], percent(10)), pc(`From 2 items ${MINUS}CZK 50 per item`, [2], perItem("50.00")))),
  },
  {
    name: "lines-tiers-rounding-tie",
    description:
      "A tier percent whose amount is half a haléř (10 % of 10,05 Kč): emitted as its exact amount (1,01 Kč), like a percentage rule's rounding tie.",
    target: "lines",
    rules: [],
    tiers: tiers(tierSet("mnozstvi", "line", [{ minQty: 1, percent: 10 }])),
    role: AUTO,
    lines: [{ n: 1, price: "10.05", qty: 1, won: won() }],
    expected: out(products(pc(fromPct(1, 10), [1], perItem("1.01")))),
  },
  {
    name: "delivery-tiers-block-shipping",
    description:
      "Free switch product discounts with shipping off: a tier is a product discount, so it blocks the free shipping (no delivery candidate).",
    target: "delivery",
    rules: [freeShip("ship", { name: "Doprava zdarma" })],
    tiers: tiers(tierSet("mnozstvi", "line", [{ minQty: 2, percent: 10 }])),
    configExtra: { engine: { combination: { productWithShipping: false } } },
    role: AUTO,
    lines: [{ n: 1, price: "100.0", qty: 2, won: won() }],
    expected: NONE,
  },

  marginTightTies(),

  // --- per-item minimum quantity (Pro, plan 2026-10-06 bod 8; plan.ts "Per-item minimum") ---------
  {
    name: "lines-item-minimum-products",
    description:
      "10 % on products A (from 3 pieces), B (from 4) and C (no own minimum): the cart has 3 × A in two variants, 1 × B, 2 × C — A's lines and C's get it, B's does not. The minimum travels in the product metafield's ref `rule#key:min`.",
    target: "lines",
    rules: [pct("vyber", 10, { name: "Vybrané produkty" })],
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", qty: 2, product: 101, won: won("vyber#101:3") },
      { n: 2, price: "120.0", product: 101, won: won("vyber#101:3") },
      { n: 3, price: "100.0", product: 102, won: won("vyber#102:4") },
      { n: 4, price: "50.0", qty: 2, product: 103, won: won("vyber") },
      { n: 5, price: "70.0", qty: 4, won: null },
    ],
    expected: out(products(pc("Vybrané produkty", [1, 2, 4], percent(10)))),
  },
  {
    name: "lines-item-minimum-common-minimum",
    description:
      "The rule's common minimum (the cart from 12 pieces; it has 10) decides only for the product without its own minimum: A (from 3, the cart has 3) keeps the discount, C loses it — and a better automatic discount still wins a line on its own.",
    target: "lines",
    rules: [pct("vyber", 10, { name: "Vybrané produkty", minimum: { quantity: 12 } }), pct("maly", 4, { name: "Malá sleva" })],
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", qty: 3, product: 101, won: won("vyber#101:3", "maly") },
      { n: 2, price: "100.0", product: 102, won: won("vyber#102:4", "maly") },
      { n: 3, price: "50.0", qty: 2, product: 103, won: won("vyber") },
      { n: 4, price: "70.0", qty: 4, won: null },
    ],
    expected: out(products(pc("Vybrané produkty", [1], percent(10)), pc("Malá sleva", [2], percent(4)))),
  },
  {
    name: "lines-item-minimum-collections-any",
    description:
      "20 % on collections 1 (from 5 pieces) and 2 (from 2): collection 2 has 2 pieces, collection 1 only 4. The product in BOTH qualifies through collection 2; the one only in collection 1 does not; a gift line counts toward nothing.",
    target: "lines",
    rules: [pct("kolekce", 20, { name: "Kolekce", target: { kind: "collections", ids: [] } })],
    role: AUTO,
    lines: [
      { n: 1, price: "100.0", won: won("kolekce#1:5", "kolekce#2:2") },
      { n: 2, price: "100.0", won: won("kolekce#2:2") },
      { n: 3, price: "100.0", qty: 3, won: won("kolekce#1:5") },
      { n: 4, price: "100.0", qty: 9, gift: "tier-1", won: won("kolekce#1:5") },
    ],
    expected: out(products(pc("Kolekce", [1, 2], percent(20)))),
  },
  {
    name: "lines-item-minimum-free-gated",
    description:
      "Per-item minimums are Pro: a Free shop's config ships the rule switched OFF (plan-gate.ts), never the discount without its minimums — nothing is emitted even though the cart has more than the minimum.",
    target: "lines",
    plan: "free",
    rules: [pct("vyber", 10, { name: "Vybrané produkty", target: { kind: "products", productIds: [productId(1)], variantIds: [], itemMinimums: [{ id: productId(1), quantity: 2 }] } })],
    role: AUTO,
    lines: [{ n: 1, price: "100.0", qty: 5, won: won("vyber") }],
    expected: NONE,
  },

  // --- generated code batches (plan 2026-10-06 dávka 4; code-batch.ts) ------------------------------
  {
    name: "lines-code-batch-own-trigger",
    description:
      "A code node triggered by a code of its rule's GENERATED batch (entered in lower case): the batch ships as one tuple, the function recognises the code by the prefix and its keyed check. 15 % on the targeted line.",
    target: "lines",
    rules: [BATCH_RULE],
    role: codeNode("davka"),
    triggering: BATCH_CODES[0].toLowerCase(),
    entered: [BATCH_CODES[0].toLowerCase()],
    lines: [
      { n: 1, price: "100.0", won: won("davka") },
      { n: 2, price: "50.0", won: null },
    ],
    expected: out(products(pc("Black Friday", [1], percent(15)))),
  },
  {
    name: "lines-code-batch-made-up-code-auto-node",
    description:
      "\"PREFIX-anything\" is not a code of the batch (its check is wrong): the batch's rule is NOT entered, so the automatic 10 % keeps both lines. Entered next to a hand-typed code of another discount, which wins its line.",
    target: "lines",
    rules: [BATCH_RULE, pct("auto", 10, { name: "Automat" }), WELCOME],
    role: AUTO,
    entered: ["BF-ANYTHING12", `${BATCH_CODES[0].slice(0, -1)}${BATCH_CODES[0].endsWith("2") ? "3" : "2"}`, "welcome15"],
    lines: [
      { n: 1, price: "100.0", won: won("davka", "auto") },
      { n: 2, price: "50.0", won: won("auto") },
      { n: 3, price: "80.0", won: won("welcome", "auto") },
    ],
    expected: out(products(pc("Automat", [1, 2], percent(10)))),
  },
  {
    name: "lines-code-batch-wins-auto-node",
    description:
      "A real code of the batch (the 57th of 100) is entered: its 15 % beats the automatic 10 % on line 1, so the automatic node emits only line 2 (the code's own node emits line 1).",
    target: "lines",
    rules: [BATCH_RULE, pct("auto", 10, { name: "Automat" })],
    role: AUTO,
    entered: [BATCH_CODES[56]],
    lines: [
      { n: 1, price: "100.0", won: won("davka", "auto") },
      { n: 2, price: "50.0", won: won("auto") },
    ],
    expected: out(products(pc("Automat", [2], percent(10)))),
  },

  // --- output size (Shopify: 20 kB for ≤ 200 lines) ----------------------------------------
  proStackPercentOutput(),
  proStackDegradedOutput(),
  truncatedOutput(),
  tiesRelaxedOutput(),
  scaledBudgetOutput(),

  // --- instruction budget ------------------------------------------------------------------
  budget("lines"),
  budget("delivery"),
  itemMinimumBudget(),
  marginBudget("lines"),
  marginBudget("delivery"),
  marginSlowBudget(),
  marginCappedBudget(200),
  marginCappedBudget(500),
  filledToInputLimit((siblings) => marginProBudget({ lines: 200, siblings, tierSets: LOSING_SETS })),
  filledToInputLimit((siblings) => marginProBudget({ lines: 500, siblings, tierSets: LOSING_SETS })),
  filledToInputLimit((siblings) => marginProBudget({ lines: 200, siblings, marginRefs: 4, name: "bridge", tierSets: LOSING_SETS })),
  filledToInputLimit((siblings) => marginProBudget({ lines: 200, siblings, marginRefs: 4, name: "bridge-codes", codes: 250, tierSets: LOSING_SETS })),
  filledToInputLimit((siblings) => marginProBudget({ lines: 200, siblings, marginRefs: 4, name: "bridge-won-codes", wonCodes: true, tierSets: LOSING_SETS })),
  // 196 lines: with every variant's `wonOutlet` (MVP 5) 200 lines of 64-character ids do not fit the input limit.
  filledToInputLimit((siblings) => marginProBudget({ lines: 196, siblings, ruleIdLength: 64, collections: 29, name: "long-ids" })),
  filledToInputLimit((siblings) => proMeshBudget({ lines: 198, siblings, tierSets: LOSING_SETS })), // 198: see long-ids (MVP 5 `wonOutlet`)
  filledToInputLimit((siblings) => tiersProBudget({ lines: 200, siblings })),
  filledToInputLimit((siblings) => tiersProBudget({ lines: 500, siblings })),
  filledToInputLimit((siblings) => nearMinBudget({ lines: 200, siblings })),
  filledToInputLimit((siblings) => nearMinBudget({ lines: 500, siblings })),
  filledToInputLimit((siblings) => marketsCodesBudget({ lines: 200, siblings, markets: true, codes: 0 })),
  filledToInputLimit((siblings) => marketsCodesBudget({ lines: 200, siblings, markets: false, codes: 40 })),
  ];
}

/**
 * @param {string} name @param {string} description
 * @param {{ active: boolean, expected: { operations: unknown[] }, varsPatch?: Scenario["varsPatch"] }} opts
 * @returns {Scenario}
 */
function campaign(name, description, opts) {
  return {
    name,
    description,
    target: "lines",
    rules: [SUMMER],
    configExtra: {
      campaigns: [
        {
          id: "bf",
          name: "Black Friday",
          window: { start: "2026-09-30T00:00:00", end: "2026-10-05T23:59:59" },
          overrides: [{ ruleId: "summer", patch: { value: { kind: "percentage", percent: 30 } } }],
          killed: false,
        },
      ],
    },
    role: AUTO,
    campaignActive: opts.active,
    ...(opts.varsPatch ? { varsPatch: opts.varsPatch } : {}),
    lines: [{ n: 1, price: "100.0", won: won("summer") }],
    expected: opts.expected,
  };
}

/**
 * MVP 6.1: a campaign overriding the global tier set's breaks (more generous: campaign-tiers.ts).
 * @param {string} name @param {string} description
 * @param {{ active: boolean, expected: { operations: unknown[] }, varsPatch?: Scenario["varsPatch"] }} opts
 * @returns {Scenario}
 */
function campaignTiers(name, description, opts) {
  return {
    name,
    description,
    target: "lines",
    rules: [],
    tiers: tiers(
      tierSet("mnozstvi", "line", [{ minQty: 2, percent: 10 }]),
      tierSet("vyber", "line", [{ minQty: 2, percent: 5 }], { productIds: [productId(3)] }),
    ),
    configExtra: {
      campaigns: [
        {
          id: "bf",
          name: "Black Friday",
          window: { start: "2026-09-30T00:00:00", end: "2026-10-05T23:59:59" },
          overrides: [{ ruleId: "mnozstvi", patch: { breaks: [{ minQty: 2, percent: 20 }, { minQty: 4, percent: 30 }] } }],
          killed: false,
        },
      ],
    },
    role: AUTO,
    campaignActive: opts.active,
    ...(opts.varsPatch ? { varsPatch: opts.varsPatch } : {}),
    lines: [
      { n: 1, price: "100.0", qty: 2, won: won() },
      { n: 2, price: "100.0", qty: 4, won: won() },
      { n: 3, price: "100.0", qty: 2, won: { ruleIds: [], tierRef: "vyber" } },
    ],
    expected: opts.expected,
  };
}

// --- The 200-line cart (instruction budget) ------------------------------------------------
//
// 200 lines, 37 rules (8 automatic product rules, 2 entered code rules, 20 code
// rules with codes nobody entered, 5 disabled, an order and a shipping rule),
// 3–6 refs per line, a Pro combinesWith pair, 4 outlet lines. The expected
// output is computed below by a deliberately simple model of the A1 rules (best
// single amount per line, the p7+p8 stack when both target the line) — not by
// the engine.

const BUDGET_LINES = 200;
const P_PERCENT = [3, 5, 7, 9, 11, 13, 15, 17]; // p1..p8
const CODE_RULES = [
  { id: "c1", percent: 12, code: "C1CODE", every: 7 },
  { id: "c2", percent: 25, code: "C2CODE", every: 10 },
];

function budgetRules() {
  const rules = P_PERCENT.map((percent, i) =>
    pct(`p${i + 1}`, percent, i === 6 ? { combinesWith: { ruleIds: ["p8"] } } : {}),
  );
  for (const c of CODE_RULES) rules.push(withCodes([c.code], pct(c.id, c.percent)));
  for (let k = 1; k <= 20; k += 1) {
    rules.push(withCodes([`F${k}A`, `F${k}B`, `F${k}C`], pct(`f${k}`, 30)));
  }
  for (let k = 1; k <= 5; k += 1) rules.push(pct(`d${k}`, 40, { enabled: false }));
  rules.push(orderPct("o1", 5, { minimum: { subtotal: { CZK: 100000 } } }));
  rules.push(freeShip("s1"));
  return rules;
}

/** @param {number} i */
function budgetRefs(i) {
  const refs = new Set([`p${(i % 8) + 1}`, `p${((i * 3) % 8) + 1}`, `p${((i * 5 + 2) % 8) + 1}`]);
  for (const c of CODE_RULES) if (i % c.every === 0) refs.add(c.id);
  refs.add(`f${(i % 20) + 1}`);
  if (i % 9 === 0) refs.add(`d${(i % 5) + 1}`);
  return [...refs];
}

const budgetPrice = (/** @type {number} */ i) => 100 + (i % 37) * 10; // Kč
const budgetQty = (/** @type {number} */ i) => 1 + (i % 3);
const budgetOutlet = (/** @type {number} */ i) => i % 50 === 0;

/** Minor units → "123.45" (CZK). */
const kc = (/** @type {number} */ minor) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;

/** The automatic node's product candidates for the budget cart, by the simple model. */
function budgetExpectedProducts() {
  /** @type {Map<string, { message: string, targets: { cartLine: { id: string } }[], value: unknown }>} */
  const groups = new Map();
  /** @type {{ message: string, targets: { cartLine: { id: string } }[], value: unknown }[]} */
  const candidates = [];
  for (let i = 1; i <= BUDGET_LINES; i += 1) {
    if (budgetOutlet(i)) continue;
    const refs = new Set(budgetRefs(i));
    const subtotal = budgetPrice(i) * 100 * budgetQty(i);
    const amount = (/** @type {number} */ p) => Math.round((subtotal * p) / 100);
    /** @type {{ id: string, percent: number, amount: number, code: boolean }[]} */
    const singles = [];
    P_PERCENT.forEach((p, k) => {
      if (refs.has(`p${k + 1}`)) singles.push({ id: `p${k + 1}`, percent: p, amount: amount(p), code: false });
    });
    for (const c of CODE_RULES) if (refs.has(c.id)) singles.push({ id: c.id, percent: c.percent, amount: amount(c.percent), code: true });
    singles.sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1));
    const best = singles[0];
    const target = { cartLine: { id: lineId(i) } };
    if (refs.has("p7") && refs.has("p8") && amount(15) + amount(17) > best.amount) {
      // A Pro stack of whole percents whose sum rounds to the same amount is
      // emitted as that percent (32 %): exact, and every such line shares it.
      const pro = groups.get("pro");
      if (pro) pro.targets.push(target);
      else {
        const candidate = { message: "Sleva p8 + Sleva p7", targets: [target], value: percent(32) };
        groups.set("pro", candidate);
        candidates.push(candidate);
      }
      continue;
    }
    if (best.code) continue; // a code wins this line: its own node emits it
    const key = best.id;
    const existing = groups.get(key);
    if (existing) {
      existing.targets.push(target);
      continue;
    }
    const candidate = { message: `Sleva ${best.id}`, targets: [target], value: percent(best.percent) };
    groups.set(key, candidate);
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * @param {"lines" | "delivery"} target
 * @returns {Scenario}
 */
function budget(target) {
  const lines = [];
  for (let i = 1; i <= BUDGET_LINES; i += 1) {
    lines.push({
      n: i,
      price: `${budgetPrice(i)}.0`,
      qty: budgetQty(i),
      won: budgetOutlet(i) ? { ruleIds: budgetRefs(i), outlet: true } : { ruleIds: budgetRefs(i) },
    });
  }
  const outlet = [];
  for (let i = 1; i <= BUDGET_LINES; i += 1) if (budgetOutlet(i)) outlet.push(i);
  return {
    name: `${target}-200-lines-budget`,
    description:
      "Instruction budget: 200 lines × 3–6 refs, 37 rules, entered codes, a Pro stack, outlet lines, with the ids the checkout sends (app rule ids, Shopify's cart line ids) — the automatic node must stay within the budget (README \"Instruction budget\").",
    realisticIds: true,
    target,
    rules: budgetRules(),
    role: AUTO,
    entered: CODE_RULES.map((c) => c.code),
    lines,
    expected:
      target === "lines"
        ? out(products(...budgetExpectedProducts()), order("Sleva o1", outlet, percent(5)))
        : out(delivery("Doprava s1", percent(100))),
  };
}

// Per-item minimums and generated batches on the budget cart: every one of the
// 200 lines lists TWO item refs (13-digit keys, as product and collection ids
// are) and a plain one; 25 item groups of the 30 % rule and 40 of the 20 % one,
// some reached and some not; 5 code discounts with 5 generated batches each,
// and 25 entered codes of a batch's exact shape (24 made up — each costs the
// full keyed check — and one real).
const IM_GROUPS_A = 25;
const IM_GROUPS_B = 40;
const imQty = (/** @type {number} */ i) => 1 + (i % 3);
const imPrice = (/** @type {number} */ i) => 100 + (i % 37) * 10; // Kč
const imMinA = (/** @type {number} */ g) => 5 + g;
const imMinB = (/** @type {number} */ g) => 4 + (g % 9) * 2;
const imRefs = (/** @type {number} */ i) => [`im30#${8841234500000 + (i % IM_GROUPS_A)}:${imMinA(i % IM_GROUPS_A)}`, `im20#${5512345600000 + (i % IM_GROUPS_B)}:${imMinB(i % IM_GROUPS_B)}`, "plain5"];

/** @returns {Scenario} */
function itemMinimumBudget() {
  const countA = new Array(IM_GROUPS_A).fill(0);
  const countB = new Array(IM_GROUPS_B).fill(0);
  for (let i = 1; i <= BUDGET_LINES; i += 1) {
    countA[i % IM_GROUPS_A] += imQty(i);
    countB[i % IM_GROUPS_B] += imQty(i);
  }
  const lines = [];
  /** @type {Record<string, number[]>} */
  const winners = { im30: [], im20: [], plain5: [] };
  for (let i = 1; i <= BUDGET_LINES; i += 1) {
    lines.push({ n: i, price: `${imPrice(i)}.0`, qty: imQty(i), won: { ruleIds: imRefs(i) } });
    const a = countA[i % IM_GROUPS_A] >= imMinA(i % IM_GROUPS_A);
    const b = countB[i % IM_GROUPS_B] >= imMinB(i % IM_GROUPS_B);
    winners[a ? "im30" : b ? "im20" : "plain5"].push(i);
  }
  for (const [id, list] of Object.entries(winners)) if (list.length < 20) throw new Error(`itemMinimumBudget: only ${list.length} lines for ${id}`);
  const rules = [pct("im30", 30), pct("im20", 20), pct("plain5", 5)];
  /** @type {string[]} */
  const entered = [];
  for (let r = 0; r < 5; r += 1) {
    const codeBatches = Array.from({ length: 5 }, (_, b) => ({
      id: `b${b}`,
      prefix: `K${r}${b}-`,
      count: 1000,
      seed: (r * 5 + b + 1).toString(16).padStart(32, "0"),
      length: 14,
      alphabet: "digits",
    }));
    rules.push(pct(`kody${r}`, 50, { method: "code", codeBatches }));
    if (r === 4) {
      // 24 made-up codes of the last batch's exact shape (the function runs its whole check on each), and a real one.
      for (let k = 0; k < 24; k += 1) entered.push(`K44-${String(22222222222222 + k * 1010101).slice(0, 14)}`);
      entered.push(generateBatchCodes({ ...codeBatches[4], count: 1 })[0]);
    }
  }
  // First appearance orders the candidates.
  const order = Object.entries(winners).sort((x, y) => x[1][0] - y[1][0]);
  const percents = { im30: 30, im20: 20, plain5: 5 };
  return {
    name: "lines-item-minimum-200-lines-budget",
    description:
      "Instruction budget: 200 lines × 2 item refs with 13-digit keys (65 item groups, some reached) + a plain ref, 5 code discounts × 5 generated batches of 1 000 codes, 25 entered codes of a batch's shape (24 made up, 1 real) — within the ordinary budget.",
    realisticIds: true,
    target: "lines",
    rules,
    role: AUTO,
    entered,
    lines,
    expected: out(products(...order.map(([id, list]) => pc(`Sleva ${id}`, list, percent(percents[/** @type {keyof typeof percents} */ (id)]))))),
  };
}

/**
 * Margin protection over the output budget: 200 lines at 1,4 % whose every
 * amount is a rounding tie in decimal (2,50 Kč + 5 Kč × i: x,5 haléřů), so the
 * exact output is over the budget and the ties go back to their percent — but
 * not on the lines sitting exactly at their floor (every 4th: cost = price −
 * discount). Shopify could round such a tie up and take the line 1 haléř under
 * its floor, so those keep their exact amounts; the rest share one 1,4 %.
 * @returns {Scenario}
 */
function marginTightTies() {
  const name = "Jedna celá čtyři";
  const lines = [];
  const exactRows = [];
  const relaxedRows = [];
  for (let i = 1; i <= 200; i += 1) {
    const s = 250 + 500 * (i - 1);
    if (!tie(s, 1.4)) throw new Error(`marginTightTies: ${s} must be a tie at 1,4 %`);
    const discount = Math.round((s * 1.4) / 100);
    const tight = i % 4 === 1;
    const cost = (s - discount) / 100; // Kč: the floor is exactly the price after the discount
    if (tight && ceilTol(cost * 100) !== s - discount) throw new Error(`marginTightTies: line ${i} must sit at its floor`);
    lines.push({ n: i, price: kc(s), won: won("a"), ...(tight ? { variantMeta: costOf(cost) } : {}) });
    const target = { cartLine: { id: lineId(i) } };
    const exact = { key: `e${discount}`, message: name, value: perItem(kc(discount)), target, amount: discount };
    exactRows.push(exact);
    relaxedRows.push(tight ? exact : { key: "p1.4", message: name, value: percent(1.4), target, amount: discount });
  }
  if (bytes(productsOf(groupRows(exactRows))) <= OUTPUT_BUDGET) throw new Error("marginTightTies: the exact output must be over the budget");
  const expected = productsOf(groupRows(relaxedRows));
  if (bytes(expected) > OUTPUT_BUDGET) throw new Error("marginTightTies: the relaxed output must fit the budget");
  return {
    name: "lines-margin-tight-ties-exact",
    description:
      "Margin protection over the output budget: 200 rounding ties at 1,4 %; the ties go back to their percent, except on the lines exactly at their floor (every 4th), which keep their exact amounts — a tie Shopify rounded up would take them 1 haléř under the floor.",
    target: "lines",
    rules: [pct("a", 1.4, { name })],
    margin: marginOn({ maxDiscountPercent: 50 }),
    role: AUTO,
    lines,
    expected,
  };
}

// --- The 200-line cart with margin protection (instruction budget, MVP 2) -------------------
//
// The budget cart's 37 rules and refs with margin protection on (minimum margin
// 20 %), distinct prices and a cost price on every line:
// 10 Kč on most, 80 % of (price − 3 Kč) on every 10th ("tight"). The expected
// output by a simple model of the margin rules:
//   - a tight line's floor is price − 3 Kč, so its headroom is 3 Kč per item,
//     less than any winner here (≥ 3 % of ≥ 101 Kč): its stack is cut to that,
//     top rule first — the top rule alone, 3 Kč per item, owned by it;
//   - every other line keeps its winner (its floor is 12,50 Kč);
//   - the 5 % order discount leaves out the tight lines (at their floor, nothing
//     left to give) and stays 5 % of the other lines, which the model checks
//     can carry it on both allocation bases; with margin protection on it is
//     emitted as its exact amount.

const MARGIN_BUDGET_MIN = 20;
const marginBudgetPrice = (/** @type {number} */ i) => 100 + i; // Kč, every line different
const marginBudgetTight = (/** @type {number} */ i) => i % 10 === 5;
/** Cost price, Kč: 80 % of (price − 3 Kč) on a tight line (floor = price − 3 Kč at 20 % margin), else 10 Kč. */
const marginBudgetCost = (/** @type {number} */ i) => (marginBudgetTight(i) ? ((marginBudgetPrice(i) - 3) * 8) / 10 : 10);
/** ceilTol (margin.ts): ceil with a 1e-6 tolerance for float noise. */
const ceilTol = (/** @type {number} */ x) => Math.ceil(x - 1e-6);

function marginBudgetExpected() {
  /** @type {Map<string, { message: string, targets: { cartLine: { id: string } }[], value: unknown }>} */
  const groups = new Map();
  /** @type {{ message: string, targets: { cartLine: { id: string } }[], value: unknown }[]} */
  const candidates = [];
  const add = (/** @type {string} */ key, /** @type {string} */ message, /** @type {unknown} */ value, /** @type {number} */ i) => {
    const target = { cartLine: { id: lineId(i) } };
    const existing = groups.get(key);
    if (existing) {
      existing.targets.push(target);
      return;
    }
    const candidate = { message, targets: [target], value };
    groups.set(key, candidate);
    candidates.push(candidate);
  };
  /** @type {number[]} */
  const excluded = [];
  /** @type {{ a: number, s: number, h: number }[]} */
  const open = [];
  for (let i = 1; i <= BUDGET_LINES; i += 1) {
    if (budgetOutlet(i)) {
      excluded.push(i);
      continue;
    }
    const refs = new Set(budgetRefs(i));
    const q = budgetQty(i);
    const unit = marginBudgetPrice(i) * 100;
    const s = unit * q;
    const amount = (/** @type {number} */ p) => Math.round((s * p) / 100);
    /** @type {{ id: string, percent: number, amount: number, code: boolean }[]} */
    const singles = [];
    P_PERCENT.forEach((p, k) => {
      if (refs.has(`p${k + 1}`)) singles.push({ id: `p${k + 1}`, percent: p, amount: amount(p), code: false });
    });
    for (const c of CODE_RULES) if (refs.has(c.id)) singles.push({ id: c.id, percent: c.percent, amount: amount(c.percent), code: true });
    singles.sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1));
    const best = singles[0];
    const stacked = refs.has("p7") && refs.has("p8") && amount(15) + amount(17) > best.amount;
    const total = stacked ? amount(15) + amount(17) : best.amount;
    const floorUnit = ceilTol((marginBudgetCost(i) * 100) / (1 - MARGIN_BUDGET_MIN / 100));
    const headroom = s - floorUnit * q;
    if (marginBudgetTight(i)) {
      if (headroom !== 300 * q || total <= headroom) throw new Error(`marginBudget: line ${i} must be cut to 3 Kč per item`);
      excluded.push(i); // at its floor: nothing left for the order discount
      const top = stacked ? { id: "p8", code: false } : best; // the stack's top rule (17 % > 15 %)
      if (!top.code) add(`e300 ${top.id}`, `Sleva ${top.id}`, perItem("3.00"), i);
      continue;
    }
    if (total > headroom) throw new Error(`marginBudget: line ${i} must keep its winner`);
    const a = s - total;
    open.push({ a, s, h: a - floorUnit * q - 1 });
    if (stacked) add("pro", "Sleva p8 + Sleva p7", percent(32), i);
    else if (!best.code) add(best.id, `Sleva ${best.id}`, percent(best.percent), i);
  }
  const base = open.reduce((sum, l) => sum + l.a, 0);
  const baseBefore = open.reduce((sum, l) => sum + l.s, 0);
  const wanted = Math.round((base * 5) / 100);
  for (const l of open) {
    if (Math.floor((l.h * base) / l.a) < wanted || Math.floor((l.h * baseBefore) / l.s) < wanted) {
      throw new Error("marginBudget: every open line must carry the 5 % order discount on both bases");
    }
  }
  return { candidates, excluded, orderValue: amountOff(kc(wanted)) };
}

/**
 * @param {"lines" | "delivery"} target
 * @returns {Scenario}
 */
function marginBudget(target) {
  const lines = [];
  for (let i = 1; i <= BUDGET_LINES; i += 1) {
    lines.push({
      n: i,
      price: `${marginBudgetPrice(i)}.0`,
      qty: budgetQty(i),
      won: budgetOutlet(i) ? { ruleIds: budgetRefs(i), outlet: true } : { ruleIds: budgetRefs(i) },
      variantMeta: costOf(marginBudgetCost(i)),
    });
  }
  const { candidates, excluded, orderValue } = marginBudgetExpected();
  return {
    name: `${target}-margin-200-lines-budget`,
    realisticIds: true,
    description:
      "Instruction budget with margin protection on: the 200-line budget cart (37 rules, codes, a Pro stack, outlet lines) with a cost price on every line and the order discount. Every line that can give something carries its share of the order discount, so the order stage takes its shortcut (no search); lines-margin-slow-200-lines-budget and lines-margin-capped-*-lines-budget are the harder shapes. With the ids the checkout sends, the automatic node must stay within the budget (README \"Instruction budget\").",
    target,
    rules: budgetRules(),
    margin: marginOn({ minMarginPercent: MARGIN_BUDGET_MIN, maxDiscountPercent: 40 }),
    role: AUTO,
    entered: CODE_RULES.map((c) => c.code),
    lines,
    expected: target === "lines" ? out(products(...candidates), order("Sleva o1", excluded, orderValue)) : out(delivery("Doprava s1", percent(100))),
  };
}

/**
 * The margin budget cart where the order stage must SEARCH (both orderings): 10
 * open lines are "weak" — their cost puts the floor 3 Kč × q under what is left
 * after the product discount, so each can give only a haléř or two of the order
 * discount, far less than its share. Model: the weak lines have the smallest
 * keys in both orderings (h/s and h/a), every set with one of them is limited
 * to a few haléřů, and the other open lines carry the whole 5 %: that set wins
 * both orderings, and the weak lines are left out next to the tight ones.
 * @returns {Scenario}
 */
function marginSlowBudget() {
  const weak = (/** @type {number} */ i) => i % 20 === 7;
  const base = marginBudget("lines");
  const { candidates } = marginBudgetExpected();
  /** @type {number[]} */
  const excluded = [];
  /** @type {{ a: number, s: number, h: number }[]} */
  const open = [];
  const weakLines = [];
  base.lines.forEach((line, k) => {
    const i = k + 1;
    if (budgetOutlet(i) || marginBudgetTight(i)) {
      excluded.push(i);
      return;
    }
    const q = budgetQty(i);
    const s = marginBudgetPrice(i) * 100 * q;
    const refs = new Set(budgetRefs(i));
    const amount = (/** @type {number} */ p) => Math.round((s * p) / 100);
    const singles = P_PERCENT.map((p, n) => (refs.has(`p${n + 1}`) ? amount(p) : 0));
    for (const c of CODE_RULES) if (refs.has(c.id)) singles.push(amount(c.percent));
    const best = Math.max(...singles);
    const total = refs.has("p7") && refs.has("p8") && amount(15) + amount(17) > best ? amount(15) + amount(17) : best;
    const a = s - total;
    if (weak(i)) {
      // Floor per item so that floor × q = a − 3 − ((a − 3) mod q): h = 2 … q + 1.
      const floorUnit = Math.floor((a - 3) / q);
      line.variantMeta = costOf((floorUnit * 8) / 1000);
      const f = ceilTol(((floorUnit * 8) / 1000) * 100 / (1 - MARGIN_BUDGET_MIN / 100));
      const h = a - f * q - 1;
      if (h < 1 || h > 4) throw new Error(`marginSlowBudget: weak line ${i} must have 1–4 haléřů to give, has ${h}`);
      weakLines.push({ a, s, h });
      excluded.push(i);
      return;
    }
    const f = ceilTol((marginBudgetCost(i) * 100) / (1 - MARGIN_BUDGET_MIN / 100));
    open.push({ a, s, h: a - f * q - 1 });
  });
  excluded.sort((x, y) => x - y);
  const S = open.reduce((sum, l) => sum + l.a, 0);
  const S0 = open.reduce((sum, l) => sum + l.s, 0);
  const wanted = Math.round((S * 5) / 100);
  for (const l of open) {
    if (Math.floor((l.h * S) / l.a) < wanted || Math.floor((l.h * S0) / l.s) < wanted) throw new Error("marginSlowBudget: the open lines must carry the order");
  }
  const smallestOpen = Math.min(...open.map((l) => Math.min(l.h / l.s, l.h / l.a)));
  const allA = S + weakLines.reduce((sum, l) => sum + l.a, 0);
  for (const w of weakLines) {
    if (Math.max(w.h / w.s, w.h / w.a) >= smallestOpen) throw new Error("marginSlowBudget: a weak line must sort after every open line");
    if (Math.floor((w.h * allA) / w.a) >= wanted) throw new Error("marginSlowBudget: a set with a weak line must allow less");
  }
  return {
    ...base,
    name: "lines-margin-slow-200-lines-budget",
    description:
      "Instruction budget, margin protection with the order stage's full search: the margin budget cart with 10 weak lines (their floor 3 Kč × q under what is left after the product discount) that cannot carry their share of the 5 % order discount. Both orderings are sorted and searched; the weak lines are left out of the order discount (with the lines at their floor) and the rest carries it whole.",
    expected: out(products(...candidates), order("Sleva o1", excluded, amountOff(kc(wanted)))),
  };
}

/**
 * Instruction and output budget with most lines capped: the budget cart's 37
 * rules on `count` lines (one item each, distinct prices), 3 of 4 lines with a
 * cost price just under their price (1–2,49 Kč of headroom, less than any
 * winner here: every such line is cut to an exact amount of its own), the rest
 * with a 10 Kč cost; an order discount of 5 %. The exact output (a candidate per
 * capped line and the order candidate listing every capped line) is over the
 * budget, so — by the output rules — the Pro stacks of the open lines go to
 * their top rule, then the candidates that save the least are dropped.
 * @param {number} count
 * @returns {Scenario}
 */
function marginCappedBudget(count) {
  const price = (/** @type {number} */ i) => 100 + i; // Kč
  const capped = (/** @type {number} */ i) => i % 4 !== 0;
  const headroomKc = (/** @type {number} */ i) => 1 + (i % 150) / 100;
  const cost = (/** @type {number} */ i) => (capped(i) ? Math.round((price(i) - headroomKc(i)) * 80) / 100 : 10);
  const lines = [];
  /** @type {{ key: string | null, message: string, value: unknown, target: unknown, amount: number }[]} */
  const exactRows = [];
  const degradedRows = [];
  /** @type {number[]} */
  const excluded = [];
  const open = [];
  for (let i = 1; i <= count; i += 1) {
    lines.push({ n: i, price: `${price(i)}.0`, won: budgetOutlet(i) ? { ruleIds: budgetRefs(i), outlet: true } : { ruleIds: budgetRefs(i) }, variantMeta: costOf(cost(i)) });
    if (budgetOutlet(i)) {
      excluded.push(i);
      continue;
    }
    const s = price(i) * 100;
    const refs = new Set(budgetRefs(i));
    const amount = (/** @type {number} */ p) => Math.round((s * p) / 100);
    /** @type {{ id: string, percent: number, amount: number, code: boolean }[]} */
    const singles = [];
    P_PERCENT.forEach((p, k) => {
      if (refs.has(`p${k + 1}`)) singles.push({ id: `p${k + 1}`, percent: p, amount: amount(p), code: false });
    });
    for (const c of CODE_RULES) if (refs.has(c.id)) singles.push({ id: c.id, percent: c.percent, amount: amount(c.percent), code: true });
    singles.sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1));
    const best = singles[0];
    const stacked = refs.has("p7") && refs.has("p8") && amount(15) + amount(17) > best.amount;
    const total = stacked ? amount(15) + amount(17) : best.amount;
    const floorUnit = ceilTol((cost(i) * 100) / (1 - MARGIN_BUDGET_MIN / 100));
    const headroom = s - floorUnit;
    const target = { cartLine: { id: lineId(i) } };
    if (capped(i)) {
      if (headroom <= 0 || total <= headroom) throw new Error(`marginCappedBudget: line ${i} must be cut`);
      excluded.push(i); // at its floor: nothing left for the order discount
      const top = stacked ? { id: "p8", code: false } : best; // the stack's top rule keeps the headroom
      if (top.code) continue; // a code rule's node emits it
      const row = { key: `e${headroom}`, message: `Sleva ${top.id}`, value: perItem(kc(headroom)), target, amount: headroom };
      exactRows.push(row);
      degradedRows.push(row); // a capped value is never relaxed
      continue;
    }
    if (total > headroom) throw new Error(`marginCappedBudget: line ${i} must keep its winner`);
    open.push({ a: s - total, s, h: s - total - floorUnit - 1 });
    if (stacked) {
      exactRows.push({ key: "p32", message: "Sleva p8 + Sleva p7", value: percent(32), target, amount: total });
      degradedRows.push({ key: "p17", message: "Sleva p8", value: percent(17), target, amount: amount(17) });
    } else if (!best.code) {
      const row = { key: `p${best.percent}`, message: `Sleva ${best.id}`, value: percent(best.percent), target, amount: best.amount };
      exactRows.push(row);
      degradedRows.push(row);
    }
  }
  const S = open.reduce((sum, l) => sum + l.a, 0);
  const S0 = open.reduce((sum, l) => sum + l.s, 0);
  const wanted = Math.round((S * 5) / 100);
  for (const l of open) {
    if (Math.floor((l.h * S) / l.a) < wanted || Math.floor((l.h * S0) / l.s) < wanted) throw new Error("marginCappedBudget: the open lines must carry the order");
  }
  const orderOp = order("Sleva o1", excluded, amountOff(kc(wanted)));
  const budget = Math.floor((OUTPUT_BUDGET * Math.max(200, count)) / 200);
  const size = (/** @type {{ message: string, targets: unknown[], value: unknown }[]} */ list) =>
    bytes(out(products(...list.map(({ message, targets, value }) => ({ message, targets, value }))), orderOp));
  if (size(groupRows(exactRows)) <= budget) throw new Error("marginCappedBudget: the exact output must be over the budget");
  let kept = groupRows(degradedRows);
  while (size(kept) > budget) {
    let drop = 0;
    for (let k = 1; k < kept.length; k += 1) if (kept[k].amount <= kept[drop].amount) drop = k;
    kept = kept.filter((_, k) => k !== drop);
  }
  return {
    name: `lines-margin-capped-${count}-lines-budget`,
    realisticIds: true,
    description: `Instruction and output budget, ${count} lines with margin protection and the ids the checkout sends: 3 of 4 lines cut to their floor (each an exact amount of its own), a 5 % order discount that leaves them out. The exact output is over the budget: the open lines' Pro stacks go to their top rule, then the candidates that save the least are dropped.${count > 200 ? " Above 200 lines Shopify's limits (and the budgets) scale with the line count." : ""}`,
    target: "lines",
    rules: budgetRules(),
    margin: marginOn({ minMarginPercent: MARGIN_BUDGET_MIN, maxDiscountPercent: 40 }),
    role: AUTO,
    entered: CODE_RULES.map((c) => c.code),
    lines,
    expected: out(products(...kept.map(({ message, targets, value }) => ({ message, targets, value }))), orderOp),
  };
}

// --- Quantity tiers on every line of the Pro budget carts (MVP 3) ----------------------------
//
// A realistic Pro tier setup next to the rules, as large as the tier cap lets
// it be (CONFIG_LIMITS.tierPayloadBytes, 550 B): admin-style 22-character set
// ids `t_` + 20 hex digits, 3 breaks a set, a global set counted per product
// and scoped sets counted across the cart, per line and per product, percent
// sets and amount sets (CZK and EUR per item). Every line is in a set: 3 of 4
// lines name a scoped set by `tierRef`, the 4th takes the global set. Every
// value is below the line's Pro stack (8 % at most; 8 Kč a piece at most,
// under 8,5 % of the cheapest item), so the stack still wins every line and the
// expected output is the cart's own: the tier work — the payload read, the
// `tierRef` and product id read, counting, the reached break, its message, the
// extra candidate — is all paid for.

/** An admin-style tier set id (`t_` + 20 hex digits). */
const tierSetId = (/** @type {string} */ name) => `t_${appRuleId(`tier-${name}`).slice(2)}`;
const LOSING_PERCENTS = [3, 5, 8];
const LOSING_CZK = [300, 500, 800];
const LOSING_EUR = [10, 20, 30];
const TIER_QTYS = [2, 3, 5];
/** The highest per-item tier value of LOSING_TIERS: 8 % or 8 Kč. */
const LOSING_MAX = { percent: 8, czk: 800 };
/** As many sets as the tier cap (550 B) takes: a global set and 6 scoped ones. */
const LOSING_SETS = 7;

/**
 * `count` sets (1 global + scoped ones), for the products `productIds` of the
 * cart (a scoped set lists one product so it is reachable; lines name it by
 * `tierRef`, the sync's K1 precomputation).
 * @param {number} count
 */
function losingTiers(count) {
  const sets = [
    tierSet(tierSetId("global"), "product", TIER_QTYS.map((minQty, k) => ({ minQty, percent: [2, 4, 6][k] }))),
  ];
  for (let k = 1; k < count; k += 1) {
    const amount = k % 2 === 1;
    sets.push(
      tierSet(
        tierSetId(`set${k}`),
        /** @type {const} */ (["cart", "line", "product"])[k % 3],
        TIER_QTYS.map((minQty, j) => (amount ? { minQty, amountOff: { CZK: LOSING_CZK[j], EUR: LOSING_EUR[j] } } : { minQty, percent: LOSING_PERCENTS[j] })),
        { productIds: [`gid://shopify/Product/${8841234500000 + k}`] },
      ),
    );
  }
  return tiers(...sets);
}

/** The `tierRef` of line i under `losingTiers(count)`: none on every 4th line (the global set). */
const losingTierRef = (/** @type {number} */ i, /** @type {number} */ count) => (i % 4 === 0 || count < 2 ? undefined : tierSetId(`set${1 + (i % (count - 1))}`));

// --- The Pro worst case with margin protection (instruction budget, MVP 2 drift audit P1/P2) ---
//
// Everything a Pro cart can put on every line at once, within the shop config's
// 9 000 B (37 rules and 50 collections — CONFIG_LIMITS.marginOverrides since
// MVP 3, 100 before — with `maxCodeLength`)
// and the function input Shopify accepts — 128 kB of MessagePack up to 200
// lines, scaled above (tests/input-size.js) — filled to that limit:
//   - 37 rules: "VIP" 2,5 % stacks (Pro combinesWith) with S1–S8; S1–S33
//     (whole percents); an entered code rule no line has; a 10 % order discount;
//     free shipping;
//   - every line: 4 rule refs (VIP, one of S1–S8, two of S9–S33), a cost price,
//     2 marginRefs of the 50 collections with a margin setting (the decisive
//     ones, core targeting.ts) — 4 in the bridge cart, as many as the sync's
//     transition bridge writes (the old and the new decisive ones) — and
//     variant-level refs of other variants of its product, as many as fill the
//     input to Shopify's limit (the function reads its own variant's key, and
//     the input provider walks every value: the filler costs what real data of
//     that size costs);
//   - ids as the checkout sends them (`realisticIds`); in the long-ids cart
//     rule ids at the sanitizer's maximum of 64 characters (the config then
//     keeps 29 collections within its 9 000 B).
// The expected output by a simple model of the rules:
//   - a line's winner is its Pro stack S_x + VIP (6–13 % + 2,5 %, more than any
//     single rule): exact, it is not a whole percent, so it is its amount per
//     item — one candidate per line, over the output budget. By the output rules
//     every Pro stack then goes to its top rule, S_x's own percent, and those
//     group: the output fits;
//   - no line is capped (the strictest collection minimum, 33,3 %, puts the floor
//     at 45 % of the price; the stack leaves at least 84,5 %), and every line can
//     carry its share of the 10 % order discount on both allocation bases, so the
//     order discount is its full amount, emitted exactly (margin protection on).

const PRO_SPOKES = 8;
const PRO_RULES = 33;
const PRO_MARGIN_MIN = 20;
/** Percent of S1–S33: 6–13 % for the VIP partners S1–S8, else 3–6 %. */
const proPercent = (/** @type {number} */ k) => (k <= PRO_SPOKES ? 6 + (k % 8) : 3 + (k % 4));
/** The 13-digit numeric id of collection k (Shopify's are 13 digits today). */
const proCollection = (/** @type {number} */ k) => String(4829301938475 + k * 104729);
/** A collection's margin setting: [minimum margin, maximum discount], undefined = the global value. */
const proSetting = (/** @type {number} */ k) => /** @type {[number | undefined, number | undefined]} */ ([[10.5, 30.5], [25, undefined], [undefined, 45.5], [33.3, 60]][k % 4]);

function proRules(codes = ["PROCODE"]) {
  const spokes = Array.from({ length: PRO_SPOKES }, (_, k) => `s${k + 1}`);
  const rules = [pct("vip", 2.5, { name: "VIP", combinesWith: { ruleIds: spokes } })];
  for (let k = 1; k <= PRO_RULES; k += 1) rules.push(pct(`s${k}`, proPercent(k), { name: `S${k}` }));
  // Short names: the config also carries `maxCodeLength` (audit round 6) within its 9 000 B.
  rules.push(withCodes(codes, pct("c1", 1, { name: "K" })));
  rules.push(orderPct("o10", 10, { name: "Obj" }));
  rules.push(freeShip("ship", { name: "D" }));
  if (rules.length !== 37) throw new Error("marginProBudget: 37 rules");
  return rules;
}

/**
 * The scenario `make(siblings)` with as many variant-level refs of other variants
 * (`siblings(i)` on line i) as keep its function input within Shopify's limit
 * (MessagePack, tests/input-size.js): the same number on every line, one more
 * on the first lines as far as it still fits.
 * @param {(siblings: (i: number) => number) => Scenario} make
 * @returns {Scenario}
 */
function filledToInputLimit(make) {
  const size = (/** @type {Scenario} */ s) => messagePackBytes(buildInput(s));
  const limit = inputLimit(make(() => 0).lines.length);
  let each = 0;
  while (size(make(() => each + 1)) <= limit) each += 1;
  let [fits, over] = [0, make(() => 0).lines.length + 1];
  while (over - fits > 1) {
    const mid = Math.floor((fits + over) / 2);
    if (size(make((i) => each + (i <= mid ? 1 : 0))) <= limit) fits = mid;
    else over = mid;
  }
  const scenario = make((i) => each + (i <= fits ? 1 : 0));
  if (size(scenario) > limit) throw new Error(`${scenario.name}: input over Shopify's limit (${size(scenario)} > ${limit} B)`);
  return scenario;
}

/**
 * 25 Won codes of 64 characters (CONFIG_LIMITS.codeLength), every one a Czech
 * letter with a diacritic (2 UTF-8 bytes, a case pair): the longest codes the
 * function upper-cases and hashes (audit round 6), each told apart by its
 * first two letters.
 * @type {string[]}
 */
const CZECH = "ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ";
const LONG_WON_CODES = Array.from({ length: 25 }, (_, k) => `${CZECH[Math.floor(k / 15)]}${CZECH[k % 15]}${CZECH.repeat(5)}`.slice(0, 64));

/**
 * `codes`: that many entered codes in all — PROCODE first, then foreign codes
 * (partners' codes, some typed again in lower case or padded, non-ASCII ones):
 * only the first 25 entries count (plan.ts MAX_ENTERED_CODES), and none of the
 * others is a Won code, so the expected output is the same.
 * `wonCodes`: the code rule's codes are LONG_WON_CODES, and all 25 are entered,
 * typed in lower case: each is normalized, hashed and matched; the rule has no
 * line, so the expected output is the same.
 * @param {{ lines: number, siblings: (i: number) => number, ruleIdLength?: number, collections?: number, marginRefs?: number, name?: string, codes?: number, wonCodes?: boolean }} shape
 * @returns {Scenario}
 */
function marginProBudget({ lines: count, siblings, ruleIdLength = 22, collections = 50, marginRefs = 2, name, codes = 1, wonCodes = false, tierSets = 0 }) {
  const rest = PRO_RULES - PRO_SPOKES;
  const lines = [];
  /** @type {{ key: string | null, message: string, value: unknown, target: unknown, amount: number }[]} */
  const exactRows = [];
  const degradedRows = [];
  /** @type {{ a: number, s: number, h: number }[]} */
  const open = [];
  for (let i = 1; i <= count; i += 1) {
    const x = 1 + (i % PRO_SPOKES);
    const y = PRO_SPOKES + 1 + (i % rest);
    let z = PRO_SPOKES + 1 + ((i * 7 + 1) % rest);
    if (z === y) z = PRO_SPOKES + 1 + ((y - PRO_SPOKES) % rest);
    const refs = ["vip", `s${x}`, `s${y}`, `s${z}`];
    const price = 100 + 2 * i; // Kč, even: every percent here is a whole number of haléřů
    const q = 1 + (i % 3);
    const cost = Math.round(price * 30) / 100; // 30 % of the price, Kč
    // Its collections with a margin setting, spread over all of them.
    const ks = Array.from({ length: marginRefs }, (_, j) => (i * 3 + Math.floor((j * collections) / marginRefs)) % collections);
    /** @type {Record<string, unknown>} */
    const won = { ruleIds: refs, marginRefs: ks.map(proCollection).sort() };
    if (siblings(i) > 0) {
      won.variantRuleIds = Object.fromEntries(
        Array.from({ length: siblings(i) }, (_, j) => [String(48468678900000 + 100000 + i * 100 + j), [`s${PRO_SPOKES + 1 + ((i + j) % rest)}`]]),
      );
    }
    const tierRef = tierSets > 0 ? losingTierRef(i, tierSets) : undefined;
    if (tierRef) won.tierRef = tierRef;
    lines.push({ n: i, price: `${price}.0`, qty: q, won, variantMeta: costOf(cost) });

    const s = price * 100 * q;
    const amount = (/** @type {number} */ p) => Math.round((s * p) / 100);
    // The best single rule and the Pro stack S_x + VIP.
    const single = Math.max(...refs.slice(1).map((r) => amount(proPercent(Number(r.slice(1))))));
    const total = amount(proPercent(x)) + amount(2.5);
    if (total <= single) throw new Error(`marginProBudget: line ${i} must take its Pro stack`);
    if (tierSets > 0 && Math.max(amount(LOSING_MAX.percent), LOSING_MAX.czk * q) >= total) throw new Error(`marginProBudget: line ${i}'s tier must lose to its stack`);
    // The strictest minimum margin of its collections (an empty one is the global 20 %).
    const minMargin = Math.max(...ks.map((k) => proSetting(k)[0] ?? PRO_MARGIN_MIN));
    const floorUnit = ceilTol((cost * 100) / (1 - minMargin / 100));
    const headroom = s - floorUnit * q;
    if (total > headroom) throw new Error(`marginProBudget: line ${i} must keep its stack`);
    const a = s - total;
    open.push({ a, s, h: a - floorUnit * q - 1 });
    const target = { cartLine: { id: lineId(i) } };
    if (total % q !== 0) throw new Error(`marginProBudget: line ${i} stack must split per item`);
    exactRows.push({ key: `e${total / q}`, message: `S${x} + VIP`, value: perItem(kc(total / q)), target, amount: total });
    degradedRows.push({ key: `p${proPercent(x)}`, message: `S${x}`, value: percent(proPercent(x)), target, amount: amount(proPercent(x)) });
  }
  const S = open.reduce((sum, l) => sum + l.a, 0);
  const S0 = open.reduce((sum, l) => sum + l.s, 0);
  const wanted = Math.round((S * 10) / 100);
  for (const l of open) {
    if (Math.floor((l.h * S) / l.a) < wanted || Math.floor((l.h * S0) / l.s) < wanted) throw new Error("marginProBudget: every line must carry the order");
  }
  const orderOp = order("Obj", [], amountOff(kc(wanted)));
  const budget = Math.floor((OUTPUT_BUDGET * Math.max(200, count)) / 200);
  const size = (/** @type {{ message: string, targets: unknown[], value: unknown }[]} */ list) =>
    bytes(out(products(...list.map(({ message, targets, value }) => ({ message, targets, value }))), orderOp));
  if (size(groupRows(exactRows)) <= budget) throw new Error("marginProBudget: the exact output must be over the budget");
  const kept = groupRows(degradedRows);
  if (size(kept) > budget) throw new Error("marginProBudget: the stacks at their top rule must fit the budget");
  const perCollection = Array.from({ length: collections }, (_, k) => {
    const [m, p] = proSetting(k);
    return {
      collectionId: `gid://shopify/Collection/${proCollection(k)}`,
      ...(m === undefined ? {} : { minMarginPercent: m }),
      ...(p === undefined ? {} : { maxDiscountPercent: p }),
    };
  });
  const long = ruleIdLength !== 22;
  const filler = Array.from({ length: count }, (_, k) => siblings(k + 1));
  const [fewest, most] = [Math.min(...filler), Math.max(...filler)];
  return {
    name: name ? `lines-margin-pro-${name}-${count}-lines-budget` : `lines-margin-pro-${count}-lines-budget`,
    realisticIds: true,
    ...(long ? { ruleIdLength } : {}),
    description:
      `Instruction budget, the Pro worst case with margin protection (drift audit P1/P2): ${count} lines, each with 4 rule refs, the Pro stack VIP + S_x, a cost price, ${marginRefs} marginRefs of ${collections} collections with a margin setting` +
      (marginRefs > 2 ? ` (as many as the sync's transition bridge writes: the old and the new decisive ones)` : "") +
      ` and ${fewest === most ? fewest : `${fewest}–${most}`} variant-level refs of other variants of its product: the input filled to Shopify's limit of ${128 * Math.max(1, count / 200)} kB of MessagePack` +
      `; 37 rules, a 10 % order discount. The exact output is over the budget: every stack goes to its top rule. ` +
      (long ? `Rule ids at the sanitizer's maximum of ${ruleIdLength} characters (the config keeps ${collections} collections within its 9 000 B). ` : "") +
      (codes > 1 ? `${codes} entered codes (Shopify's maximum a cart; PROCODE first, then partners' codes, repeats, non-ASCII): only the first 25 entries count. ` : "") +
      (wonCodes ? `The code rule's 25 codes of 64 Czech letters with diacritics (the longest a Won code can be), all entered in lower case: each normalized, hashed and matched (the config keeps ${collections} collections within its 9 000 B). ` : "") +
      (tierSets > 0 ? `Quantity tiers on every line (MVP 3): ${tierSets} sets of 5 breaks (a global one counted per product; scoped ones per line, per product and across the cart, percents and CZK/EUR amounts), 3 of 4 lines naming a scoped set by tierRef; every tier below the line's Pro stack. ` : "") +
      `With the ids the checkout sends: within 90 % of Shopify's (line-scaled) limit.`,
    target: "lines",
    rules: proRules(wonCodes ? LONG_WON_CODES : undefined),
    margin: marginOn({ minMarginPercent: PRO_MARGIN_MIN, maxDiscountPercent: 40 }, perCollection),
    ...(tierSets > 0 ? { tiers: losingTiers(tierSets) } : {}),
    role: AUTO,
    entered: wonCodes
      ? LONG_WON_CODES.map((code) => code.toLowerCase())
      : ["PROCODE", ...Array.from({ length: codes - 1 }, (_, k) => (k % 10 === 9 ? ` partner${k - 1} ` : k % 7 === 3 ? `SLEVA-ČLEN-${k}` : `PARTNER${k}`))],
    lines,
    expected: out(products(...kept.map(({ message, targets, value }) => ({ message, targets, value }))), orderOp),
  };
}

// --- The quantity-tier worst case (instruction budget, MVP 3) ------------------------------
//
// Tiers winning on every line of a Pro cart at Shopify's input limit, as many
// as the tier cap takes (CONFIG_LIMITS.tierPayloadBytes, 550 B): a global set
// counted per product and scoped sets counted per line, per product and across
// the cart, 5 breaks each, the amount sets in CZK and EUR; every line in a set
// (5 of 6 products name a scoped set by tierRef), every product two lines (two
// variants counted together in a set counted per product); 4 product rules a
// line that the tier beats (3 % at most against 4 % and 6 Kč a piece at least),
// a code rule whose 25 codes are all entered, a 5 % order discount, margin
// protection with a cost price on every line; variant-level refs of other
// variants fill the input.
// The expected output by a simple model: each line's count (its line / its
// product's two lines / every line of its set), the highest break ≤ count, its
// value (whole Kč prices: every percent is a whole number of haléřů) and
// message, grouped by (message, value) in line order; no line is capped (cost
// 30 % of the price, minimum margin 20 %: the floor is 37,5 %; a tier gives at
// most 13 %), every line carries its share of the order discount on both bases,
// so the order discount is its full amount, emitted exactly.

const TIER_BREAK_QTYS = [1, 2, 3, 5, 10];
const TIER_PERCENTS = [4, 6, 8, 10, 13];
/** Per item, haléře (CZK), whole Kč; the EUR amounts (cents) fill the payload as a real second market would. */
const TIER_AMOUNTS_CZK = [600, 800, 1000, 1400, 2000];
const TIER_AMOUNTS_EUR = [25, 30, 40, 55, 80];
/** As many scoped sets as the tier cap (550 B) takes next to the global one. */
const TIER_SCOPED = 4;
const TIER_MARGIN_MIN = 20;

/** Scoped set k (1…TIER_SCOPED): its count mode and kind. */
const tierShape = (/** @type {number} */ k) => ({ count: /** @type {const} */ (["line", "product", "cart"])[k % 3], amount: k % 2 === 1 });

function tierWorstSets(/** @type {number} */ products) {
  const sets = [tierSet(tierSetId("w-global"), "product", TIER_BREAK_QTYS.map((minQty, j) => ({ minQty, percent: TIER_PERCENTS[j] })))];
  for (let k = 1; k <= TIER_SCOPED; k += 1) {
    const { count, amount } = tierShape(k);
    const breaks = TIER_BREAK_QTYS.map((minQty, j) =>
      amount
        ? { minQty, amountOff: { CZK: TIER_AMOUNTS_CZK[j], EUR: TIER_AMOUNTS_EUR[j] } }
        : { minQty, percent: TIER_PERCENTS[j] },
    );
    const listed = Array.from({ length: products }, (_, p) => p + 1).filter((p) => tierOfProduct(p) === k).slice(0, 3);
    sets.push(tierSet(tierSetId(`w-set${k}`), count, breaks, { productIds: listed.map((p) => `gid://shopify/Product/${8841234500000 + p}`) }));
  }
  return tiers(...sets);
}

/** The scoped set of product p (1-based), 0 = the global set (every 6th product). */
const tierOfProduct = (/** @type {number} */ p) => (p % 6 === 0 ? 0 : 1 + (p % TIER_SCOPED));

/**
 * @param {{ lines: number, siblings: (i: number) => number }} shape
 * @returns {Scenario}
 */
function tiersProBudget({ lines: count, siblings }) {
  const productTotal = Math.ceil(count / 2);
  const ruleIds = Array.from({ length: 10 }, (_, k) => `q${k + 1}`);
  const rules = ruleIds.map((id, k) => pct(id, 1 + (k % 3), { name: `Q${k + 1}` }));
  rules.push(withCodes(LONG_WON_CODES.map((c) => c.slice(0, 12)), pct("c1", 1, { name: "K" })));
  rules.push(orderPct("o5", 5, { name: "Objednávka 5 %" }));
  const lineOf = Array.from({ length: count }, (_, k) => {
    const i = k + 1;
    const p = Math.ceil(i / 2);
    const price = 100 + (i % 100); // whole Kč
    return { i, p, price, q: 1 + (i % 4), set: tierOfProduct(p) };
  });
  // Counts: per line, per product (its two lines), across the cart (every line of the set).
  const setCount = new Map();
  const productCount = new Map();
  for (const l of lineOf) {
    setCount.set(l.set, (setCount.get(l.set) ?? 0) + l.q);
    productCount.set(l.p, (productCount.get(l.p) ?? 0) + l.q);
  }
  const lines = [];
  /** @type {{ key: string | null, message: string, value: unknown, target: unknown, amount: number }[]} */
  const rows = [];
  /** @type {{ a: number, s: number, h: number }[]} */
  const open = [];
  for (const l of lineOf) {
    const { i, p, price, q, set } = l;
    const shape = set === 0 ? { count: "product", amount: false } : tierShape(set);
    const n = shape.count === "line" ? q : shape.count === "product" ? productCount.get(p) : setCount.get(set);
    const j = TIER_BREAK_QTYS.filter((m) => m <= n).length - 1;
    if (j < 0) throw new Error(`tiersProBudget: line ${i} must reach a break`);
    const s = price * 100 * q;
    const tier = shape.amount ? TIER_AMOUNTS_CZK[j] * q : price * q * TIER_PERCENTS[j];
    const rule = Math.max(...ruleIds.slice(0, 4).map((_, k) => Math.round((s * (1 + (((i + k) % 10) % 3))) / 100)));
    if (tier <= rule) throw new Error(`tiersProBudget: line ${i}'s tier must beat its rules`);
    const cost = Math.round(price * 30) / 100;
    const floorUnit = ceilTol((cost * 100) / (1 - TIER_MARGIN_MIN / 100));
    if (tier > s - floorUnit * q) throw new Error(`tiersProBudget: line ${i} must keep its tier`);
    const a = s - tier;
    open.push({ a, s, h: a - floorUnit * q - 1 });
    /** @type {Record<string, unknown>} */
    const won = { ruleIds: [0, 1, 2, 3].map((k) => ruleIds[(i + k) % 10]) };
    const fill = siblings(2 * p - 1);
    if (fill > 0) {
      won.variantRuleIds = Object.fromEntries(Array.from({ length: fill }, (_, k) => [String(48468678900000 + 500000 + p * 100 + k), [ruleIds[(p + k) % 10]]]));
    }
    if (set !== 0) won.tierRef = tierSetId(`w-set${set}`);
    lines.push({ n: i, product: p, price: `${price}.0`, qty: q, won, variantMeta: costOf(cost) });
    const target = { cartLine: { id: lineId(i) } };
    const minQty = TIER_BREAK_QTYS[j];
    rows.push(
      shape.amount
        ? { key: `e${TIER_AMOUNTS_CZK[j]}`, message: fromAmount(minQty, `${TIER_AMOUNTS_CZK[j] / 100}${NBSP}Kč`), value: perItem(kc(TIER_AMOUNTS_CZK[j])), target, amount: tier }
        : { key: `p${TIER_PERCENTS[j]}`, message: fromPct(minQty, TIER_PERCENTS[j]), value: percent(TIER_PERCENTS[j]), target, amount: tier },
    );
  }
  const S = open.reduce((sum, l) => sum + l.a, 0);
  const S0 = open.reduce((sum, l) => sum + l.s, 0);
  const wanted = Math.round((S * 5) / 100);
  for (const l of open) {
    if (Math.floor((l.h * S) / l.a) < wanted || Math.floor((l.h * S0) / l.s) < wanted) throw new Error("tiersProBudget: every line must carry the order");
  }
  const orderOp = order("Objednávka 5 %", [], amountOff(kc(wanted)));
  const kept = groupRows(rows);
  const budget = Math.floor((OUTPUT_BUDGET * Math.max(200, count)) / 200);
  if (bytes(out(products(...kept.map(({ message, targets, value }) => ({ message, targets, value }))), orderOp)) > budget) {
    throw new Error("tiersProBudget: the output must fit the budget");
  }
  const filler = Array.from({ length: count }, (_, k) => siblings(2 * Math.ceil((k + 1) / 2) - 1));
  const [fewest, most] = [Math.min(...filler), Math.max(...filler)];
  return {
    name: `lines-tiers-pro-${count}-lines-budget`,
    realisticIds: true,
    description:
      `Instruction budget, the quantity-tier worst case (MVP 3): ${count} lines of ${productTotal} products (two variants each), every line in a tier set and the tier winning it: ` +
      `a global set counted per product and ${TIER_SCOPED} scoped sets counted per line, per product and across the cart, 5 breaks each, amount sets in CZK and EUR (the tier cap, 550 B); ` +
      `4 product rules a line that the tier beats, a code rule whose 25 codes are all entered, a 5 % order discount, margin protection with a cost price on every line, ` +
      `${fewest === most ? fewest : `${fewest}–${most}`} variant-level refs of other variants a product: the input filled to Shopify's limit of ${128 * Math.max(1, count / 200)} kB of MessagePack. ` +
      `With the ids the checkout sends: within 90 % of Shopify's (line-scaled) limit.`,
    target: "lines",
    rules,
    tiers: tierWorstSets(productTotal),
    margin: marginOn({ minMarginPercent: TIER_MARGIN_MIN, maxDiscountPercent: 60 }),
    role: AUTO,
    entered: LONG_WON_CODES.map((c) => c.slice(0, 12).toLowerCase()),
    lines,
    expected: out(products(...kept.map(({ message, targets, value }) => ({ message, targets, value }))), orderOp),
  };
}

// --- The Pro mesh cart (instruction budget, MVP 2 audit round 3) --------------------------
//
// The stack search's worst case before the stack cap (plan.ts
// MAX_STACK_CANDIDATES): 18 product rules that all combine with each other (a
// full Pro mesh), every line its own product listing a DIFFERENT 12 of them, so
// no line repeats another's candidates. Margin protection on (a cost price on
// every line), a 5 % order discount, and the input filled to Shopify's limit
// with variant-level refs of other variants. Without the cap this took the
// function to 102–119 % of Shopify's limit.
// The expected output by a simple model of the rules:
//   - rule k gives 1,25 + 0,5 k % (all distinct, none whole): a line's 12
//     candidates rank by percent, and its stack is its 6 best (the cap) — the
//     other 6 combine with them too but are never part of it;
//   - prices are multiples of 4 Kč, so every amount is a whole number of haléřů
//     (no rounding tie); the stack is not a whole percent, so it is its amount
//     per item (or once on the line) with its own message — one candidate per
//     line, far over the output budget. By the output rules every stack then
//     goes to its top rule's percent, and those group: the output fits;
//   - no line is capped (cost 30 % of the price, minimum margin 20 %: the floor
//     is 37,5 % of the price; a stack gives at most 51 %), and every line can
//     carry its share of the 5 % order discount on both allocation bases, so the
//     order discount is its full amount, emitted exactly (margin protection on).

const MESH_RULES = 18;
const MESH_REFS = 12;
/** The stack cap ([spec], plan.ts MAX_STACK_CANDIDATES): a stack is searched among a line's 6 best-ranked candidates. */
const MAX_STACK = 6;
/** Percent of mesh rule k (0-based): 1,25–9,75 %, distinct, never whole. */
const meshPercent = (/** @type {number} */ k) => 1.25 + 0.5 * k;
const meshName = (/** @type {number} */ k) => `Pro kombinace ${String(k + 1).padStart(2, "0")} – členská`;

/**
 * @param {{ lines: number, siblings: (i: number) => number }} shape
 * @returns {Scenario}
 */
function proMeshBudget({ lines: count, siblings, tierSets = 0 }) {
  const ids = Array.from({ length: MESH_RULES }, (_, k) => `m${k + 1}`);
  const rules = ids.map((id, k) => pct(id, meshPercent(k), { name: meshName(k), combinesWith: { ruleIds: ids.slice(k + 1) } }));
  rules.push(orderPct("o5", 5, { name: "Objednávka 5 %" }));
  // A fixed LCG: every line a different 12-of-18 subset.
  let seed = 20260930;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  const lines = [];
  const exactRows = [];
  const degradedRows = [];
  /** @type {{ a: number, s: number, h: number }[]} */
  const open = [];
  const subsets = new Set();
  for (let i = 1; i <= count; i += 1) {
    /** @type {number[]} */
    let mine = [];
    // A subset an earlier line has is drawn again.
    while (mine.length === 0 || subsets.has([...mine].sort((a, b) => a - b).join(","))) {
      const pool = ids.map((_, k) => k);
      mine = [];
      for (let j = 0; j < MESH_REFS; j += 1) mine.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
    }
    subsets.add([...mine].sort((a, b) => a - b).join(","));
    const price = 100 + 4 * i; // Kč, a multiple of 4: every percent here is a whole number of haléřů
    const q = 1 + (i % 3);
    const cost = Math.round(price * 30) / 100; // 30 % of the price, Kč
    /** @type {Record<string, unknown>} */
    const won = { ruleIds: mine.map((k) => ids[k]) };
    if (siblings(i) > 0) {
      won.variantRuleIds = Object.fromEntries(Array.from({ length: siblings(i) }, (_, j) => [String(48468678900000 + 100000 + i * 100 + j), [ids[(i + j) % MESH_RULES]]]));
    }
    const tierRef = tierSets > 0 ? losingTierRef(i, tierSets) : undefined;
    if (tierRef) won.tierRef = tierRef;
    lines.push({ n: i, price: `${price}.0`, qty: q, won, variantMeta: costOf(cost) });

    const s = price * 100 * q;
    const amount = (/** @type {number} */ k) => (s * meshPercent(k)) / 100;
    const best = [...mine].sort((a, b) => b - a).slice(0, MAX_STACK);
    const total = best.reduce((sum, k) => sum + amount(k), 0);
    if (!best.every((k) => Number.isInteger(amount(k)))) throw new Error(`proMeshBudget: line ${i} amounts must be whole haléře`);
    const floorUnit = ceilTol((cost * 100) / (1 - PRO_MARGIN_MIN / 100));
    if (total > s - floorUnit * q) throw new Error(`proMeshBudget: line ${i} must keep its stack`);
    if (tierSets > 0 && Math.max((s * LOSING_MAX.percent) / 100, LOSING_MAX.czk * q) >= total) throw new Error(`proMeshBudget: line ${i}'s tier must lose to its stack`);
    const a = s - total;
    open.push({ a, s, h: a - floorUnit * q - 1 });
    const target = { cartLine: { id: lineId(i) } };
    const message = best.map(meshName).join(" + ");
    exactRows.push(total % q === 0 ? { key: `e${total / q}`, message, value: perItem(kc(total / q)), target, amount: total } : { key: null, message, value: lineTotal(kc(total)), target, amount: total });
    degradedRows.push({ key: `p${meshPercent(best[0])}`, message: meshName(best[0]), value: percent(meshPercent(best[0])), target, amount: amount(best[0]) });
  }
  if (subsets.size !== count) throw new Error("proMeshBudget: every line a different subset");
  const S = open.reduce((sum, l) => sum + l.a, 0);
  const S0 = open.reduce((sum, l) => sum + l.s, 0);
  const wanted = Math.round((S * 5) / 100);
  for (const l of open) {
    if (Math.floor((l.h * S) / l.a) < wanted || Math.floor((l.h * S0) / l.s) < wanted) throw new Error("proMeshBudget: every line must carry the order");
  }
  const orderOp = order("Objednávka 5 %", [], amountOff(kc(wanted)));
  const budget = Math.floor((OUTPUT_BUDGET * Math.max(200, count)) / 200);
  const size = (/** @type {{ message: string, targets: unknown[], value: unknown }[]} */ list) =>
    bytes(out(products(...list.map(({ message, targets, value }) => ({ message, targets, value }))), orderOp));
  if (size(groupRows(exactRows)) <= budget) throw new Error("proMeshBudget: the exact output must be over the budget");
  const kept = groupRows(degradedRows);
  if (size(kept) > budget) throw new Error("proMeshBudget: the stacks at their top rule must fit the budget");
  const filler = Array.from({ length: count }, (_, k) => siblings(k + 1));
  const [fewest, most] = [Math.min(...filler), Math.max(...filler)];
  return {
    name: `lines-margin-pro-mesh-${count}-lines-budget`,
    realisticIds: true,
    description:
      `Instruction budget, the Pro stack search's worst case (audit round 3): ${MESH_RULES} product rules that all combine with each other, every one of the ${count} lines listing a DIFFERENT ${MESH_REFS} of them; ` +
      `the stack is searched among a line's ${MAX_STACK} best-ranked candidates only (plan.ts MAX_STACK_CANDIDATES), so each line stacks its ${MAX_STACK} best. A cost price on every line, a 5 % order discount, ` +
      `${fewest === most ? fewest : `${fewest}–${most}`} variant-level refs of other variants a line: the input filled to Shopify's limit of ${128 * Math.max(1, count / 200)} kB of MessagePack. ` +
      `The exact output is over the budget: every stack goes to its top rule. ` +
      (tierSets > 0 ? `Quantity tiers on every line (MVP 3): ${tierSets} sets of 5 breaks, 3 of 4 lines naming a scoped set by tierRef; every tier below the line's stack. ` : "") +
      `With the ids the checkout sends: within 90 % of Shopify's (line-scaled) limit.`,
    target: "lines",
    rules,
    margin: marginOn({ minMarginPercent: PRO_MARGIN_MIN, maxDiscountPercent: 60 }),
    ...(tierSets > 0 ? { tiers: losingTiers(tierSets) } : {}),
    role: AUTO,
    lines,
    expected: out(products(...kept.map(({ message, targets, value }) => ({ message, targets, value }))), orderOp),
  };
}

// --- The margin order search's near-minimum worst case (instruction budget, audit round 4) --
//
// Every line's rate h/s (what it can give per price) a hair below the next
// one's: margin protection with a 20 % ceiling and no cost prices, so
// h = s − ceil(0,8 s) − 1 and h/s = 0,2 − 1/s; prices P0 + 0,05 k Kč (P0 =
// 25 000 Kč, 40 000 Kč at 500 lines) put every rate within 10⁻¹¹ of the others,
// all distinct. The order discount (30 %) is more than any line can give, so
// the order stage searches every prefix. Before the bound on its exact work
// (plan-margin.ts ORDER_SEARCH_EXACT_LINES) each candidate set evaluated every
// line within 10⁻⁹ of its minimum, here all of them: 93,9 % of Shopify's limit
// at 200 lines, 131,7 % at 500 (this cart; the re-review's 95,5 % and 133 %). Each line lists a DIFFERENT 10 of 14 code rules
// nobody entered (read, resolved, gated out), and the input is filled to
// Shopify's limit with variant-level refs of other variants.
// The expected output by the model: no product discount; every candidate set
// is exact (no two rates within 2⁻⁴⁸ of each other, checked); by h/s
// descending the sets are the prefixes, and the order discount is the best
// prefix's D = min(30 % of S, min over its lines of floor((h × S) / s)) — the
// whole cart, checked — an exact amount with no line left out.

const NEAR_CODES = 14;
const NEAR_REFS = 10;
const NEAR_MAX_PERCENT = 20;

/**
 * @param {{ lines: number, siblings: (i: number) => number }} shape
 * @returns {Scenario}
 */
function nearMinBudget({ lines: count, siblings }) {
  const codes = Array.from({ length: NEAR_CODES }, (_, k) => withCodes([`BLIZKO${k + 1}`], pct(`k${k + 1}`, 5 + (k % 7), { name: `Kódová sleva ${k + 1}` })));
  const rules = [orderPct("o30", 30, { name: "Objednávka 30 %" }), ...codes];
  const p0 = count > 200 ? 4_000_000 : 2_500_000; // haléře
  let seed = 20261002;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) / 16777216;
  };
  const lines = [];
  /** @type {{ s: number, h: number }[]} */
  const open = [];
  const subsets = new Set();
  for (let i = 1; i <= count; i += 1) {
    /** @type {number[]} */
    let mine = [];
    while (mine.length === 0 || subsets.has([...mine].sort((a, b) => a - b).join(","))) {
      const pool = codes.map((_, k) => k);
      mine = [];
      for (let j = 0; j < NEAR_REFS; j += 1) mine.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
    }
    subsets.add([...mine].sort((a, b) => a - b).join(","));
    const s = p0 + 5 * i;
    /** @type {Record<string, unknown>} */
    const won = { ruleIds: mine.map((k) => codes[k].id) };
    if (siblings(i) > 0) {
      won.variantRuleIds = Object.fromEntries(Array.from({ length: siblings(i) }, (_, j) => [String(48468678900000 + 200000 + i * 100 + j), [codes[(i + j) % NEAR_CODES].id]]));
    }
    lines.push({ n: i, price: kc(s), won });
    open.push({ s, h: s - ceilTol(s * (1 - NEAR_MAX_PERCENT / 100)) - 1 });
  }
  if (subsets.size !== count) throw new Error("nearMinBudget: every line a different subset");
  // The search's candidate sets: prefixes by h/s descending (ties: cart order); a = s (no product discount).
  const byRate = open.map((l, i) => ({ ...l, i, r: l.h / l.s })).sort((x, y) => (x.r !== y.r ? y.r - x.r : x.i - y.i));
  for (let k = 1; k < byRate.length; k += 1) {
    if (!(byRate[k - 1].r > byRate[k].r * (1 + 2 ** -48))) throw new Error("nearMinBudget: rates must be distinct, none within 2⁻⁴⁸ of another");
  }
  let S = 0;
  const prefixes = byRate.map((l, k) => {
    S += l.s;
    const total = S;
    const least = Math.min(...byRate.slice(0, k + 1).map((m) => Math.floor((m.h * total) / m.s)));
    const wanted = Math.min(Math.round((total * 30) / 100), total);
    return { D: Math.min(wanted, least), wanted };
  });
  const whole = prefixes[prefixes.length - 1];
  if (!(whole.D < whole.wanted)) throw new Error("nearMinBudget: the order discount must be lowered");
  if (prefixes.some((p) => p.D > whole.D)) throw new Error("nearMinBudget: the whole cart must be the best set");
  const filler = Array.from({ length: count }, (_, k) => siblings(k + 1));
  const [fewest, most] = [Math.min(...filler), Math.max(...filler)];
  return {
    name: `lines-margin-near-min-${count}-lines-budget`,
    realisticIds: true,
    description:
      `Instruction budget, the margin order search's worst case (audit round 4): ${count} lines whose rates (what a line can give per price, 20 % ceiling, no cost prices) all lie within 10⁻¹¹ of each other, a 30 % order discount no line can carry, so the order stage searches every prefix. ` +
      `Each line lists a different ${NEAR_REFS} of ${NEAR_CODES} code rules nobody entered and ${fewest === most ? fewest : `${fewest}–${most}`} variant-level refs of other variants: the input filled to Shopify's limit of ${128 * Math.max(1, count / 200)} kB of MessagePack. ` +
      `The order discount is lowered to what the whole cart can carry (${kc(whole.D)} Kč), an exact amount. Before the bound on the search's exact work (16 lines tied for a minimum): ${count > 200 ? "131,7" : "93,9"} % of Shopify's limit. With the ids the checkout sends: within 90 % of Shopify's (line-scaled) limit.`,
    target: "lines",
    rules,
    margin: marginOn({ maxDiscountPercent: NEAR_MAX_PERCENT }),
    role: AUTO,
    lines,
    expected: out(order("Objednávka 30 %", [], amountOff(kc(whole.D)))),
  };
}

// --- Many markets and many entered codes (instruction budget, audit round 5) ---------------
//
// Pro market targeting at its limits: 50 markets of 5 countries each, every rule
// targeting all 50, the cart's country (CZ) the last country of the last market
// — before round 5 each rule scanned every market's countries (a 200-line cart
// of this shape took 104 % of the limit). Entered codes: 40 of them (foreign
// codes, one a code rule's in lower case and padded, repeats, non-ASCII) with a
// code rule configured, so every code is read, normalized and hashed — before
// round 5 deduplicating them was quadratic (100.5 %). Each line lists a
// DIFFERENT 4–8 of 10 product rules; the input is filled to Shopify's limit with
// variant-level refs of other variants.
// The expected output by the model: every rule applies (the cart is in the last
// market); a line's discount is its best rule (distinct whole percents, prices
// in whole Kč: no rounding tie), grouped by rule; the 5 % order discount of the
// automatic node on the rest. The code rule targets no line: its code, entered,
// changes nothing the automatic node emits.

const MC_RULES = 10;
const mcPercent = (/** @type {number} */ k) => 3 + 2 * k; // 3–21 %

/**
 * @param {{ lines: number, siblings: (i: number) => number, markets: boolean, codes: number }} shape
 * @returns {Scenario}
 */
function marketsCodesBudget({ lines: count, siblings, markets, codes }) {
  const handles = Array.from({ length: 50 }, (_, m) => `t${String(m + 1).padStart(2, "0")}`);
  // 250 distinct two-letter codes other than CZ, 5 a market; CZ closes the last one.
  const letters = "ABDEFGHIJKLMNOPRSTUVWXY";
  const pool = [];
  for (const a of letters) for (const b of letters) if (pool.length < 249) pool.push(a + b);
  const marketsConfig = handles.map((handle, m) => ({ handle, currency: "CZK", enabled: true, countries: m === 49 ? [...pool.slice(245, 249), "CZ"] : pool.slice(m * 5, m * 5 + 5) }));
  const targeting = markets ? { targeting: { markets: handles } } : {};
  const ids = Array.from({ length: MC_RULES }, (_, k) => `s${k + 1}`);
  const rules = [
    ...ids.map((id, k) => pct(id, mcPercent(k), { name: `Sleva ${mcPercent(k)} %`, ...targeting })),
    orderPct("o5", 5, { name: "Objednávka 5 %", ...targeting }),
    withCodes(["VIP-KLUB"], pct("vip", 30, { name: "VIP klub", ...targeting })),
  ];
  let seed = 20261005;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 8) / 16777216;
  };
  const lines = [];
  /** @type {Map<number, number[]>} rule index → lines it wins */
  const wins = new Map();
  const subsets = new Set();
  for (let i = 1; i <= count; i += 1) {
    /** @type {number[]} */
    let mine = [];
    while (mine.length === 0 || subsets.has([...mine].sort((a, b) => a - b).join(","))) {
      const take = 4 + Math.floor(next() * 5);
      const left = ids.map((_, k) => k);
      mine = [];
      for (let j = 0; j < take; j += 1) mine.push(left.splice(Math.floor(next() * left.length), 1)[0]);
    }
    subsets.add([...mine].sort((a, b) => a - b).join(","));
    /** @type {Record<string, unknown>} */
    const won = { ruleIds: mine.map((k) => ids[k]) };
    if (siblings(i) > 0) {
      won.variantRuleIds = Object.fromEntries(Array.from({ length: siblings(i) }, (_, j) => [String(48468678900000 + 300000 + i * 100 + j), [ids[(i + j) % MC_RULES]]]));
    }
    lines.push({ n: i, price: `${100 + ((i * 7) % 900)}.0`, qty: 1 + (i % 3), won });
    const best = Math.max(...mine);
    wins.set(best, [...(wins.get(best) ?? []), i]);
  }
  const entered = [];
  for (let k = 0; k < codes; k += 1) entered.push(k === 7 ? "  vip-klub " : k % 9 === 4 ? `SLEVA${k % 5}` : k % 3 === 0 ? `Kód-${k}-Žlutý` : `PARTNER${k}X`);
  // The candidates in the order the output groups them: by the first line each rule wins.
  const groups = [...wins].sort((a, b) => a[1][0] - b[1][0]);
  const filler = Array.from({ length: count }, (_, k) => siblings(k + 1));
  const [fewest, most] = [Math.min(...filler), Math.max(...filler)];
  const name = markets ? "markets" : "codes";
  return {
    name: `lines-${name}-${count}-lines-budget`,
    realisticIds: true,
    description:
      (markets
        ? "Instruction budget, Pro market targeting at its limits (audit round 5): 50 markets of 5 countries, every rule targeting all 50, the cart's country the last country of the last market. "
        : `Instruction budget, ${codes} entered codes (audit round 5): foreign ones, a code rule's own in lower case and padded, repeats and non-ASCII, with a code rule configured so every code is read and hashed. `) +
      `${count} lines, each listing a different 4–8 of ${MC_RULES} product rules, and ${fewest === most ? fewest : `${fewest}–${most}`} variant-level refs of other variants: the input filled to Shopify's limit of 128 kB of MessagePack. ` +
      "Every line gets its best rule, and the 5 % order discount applies. With the ids the checkout sends: within 90 % of Shopify's limit.",
    target: "lines",
    rules,
    ...(markets ? { configExtra: { markets: marketsConfig } } : {}),
    role: AUTO,
    entered,
    lines,
    expected: out(products(...groups.map(([k, ns]) => pc(`Sleva ${mcPercent(k)} %`, ns, percent(mcPercent(k))))), order("Objednávka 5 %", [], percent(5))),
  };
}

/**
 * 40 lines are variants of one product whose metafield lists 45 outlet variants
 * (odd variants): the function reads that list in full once, not on every line.
 * 160 more lines of plain products. The input is ~115 kB (Shopify's input limit
 * is 128 kB).
 * @returns {Scenario}
 */
function outletListShared() {
  const outletVariants = Array.from({ length: 45 }, (_, k) => variantId(100 + 2 * k + 1));
  const lines = [];
  const targets = [];
  for (let i = 1; i <= 200; i += 1) {
    if (i <= 40) {
      lines.push({ n: i, price: "100.0", variant: 100 + i, won: { ruleIds: ["a"], outlet: outletVariants } });
      if (i % 2 === 0) targets.push(i);
    } else {
      lines.push({ n: i, price: "100.0", won: won("a") });
      targets.push(i);
    }
  }
  return {
    name: "lines-outlet-list-shared",
    description:
      "40 lines are variants of one product whose metafield lists 45 outlet variants: the odd ones are excluded, the rest and 160 plain lines get 10 %.",
    target: "lines",
    rules: [pct("a", 10)],
    role: AUTO,
    lines,
    expected: out(products(pc("Sleva a", targets, percent(10)))),
  };
}

// --- Output size (tests/reference-adapter.js "Output size") --------------------------------
//
// Shopify refuses an output over 20 kB (1 kB = 1000 B) for carts up to 200
// lines and then the node gives NO discount at all. The mapping keeps every
// value exact and as groupable as possible; over the budget (19 000 B) it
// degrades Pro stacks to their top rule, and as a last resort drops the product
// candidates that save the least. The expected outputs below come from this
// simple model of those rules, not from the adapter.

const OUTPUT_BUDGET = 19000;
const bytes = (/** @type {unknown} */ value) => new TextEncoder().encode(JSON.stringify(value)).length;
const minor = (/** @type {string} */ price) => Math.round(Number(price) * 100);
/** A percent of S (minor units) that is half a minor unit: emitted as its exact amount. The tolerance is the float error only. */
const tie = (/** @type {number} */ s, /** @type {number} */ p) => {
  const x = (s * p) / 100;
  return Math.abs(x - Math.floor(x) - 0.5) <= 1e-9 + x * 4e-15;
};

/** Groups `{ key, message, value, target }` rows into candidates, first appearance first. */
function groupRows(/** @type {{ key: string | null, message: string, value: unknown, target: unknown, amount: number }[]} */ rows) {
  /** @type {Map<string, { message: string, targets: unknown[], value: unknown, amount: number }>} */
  const groups = new Map();
  const out = [];
  for (const row of rows) {
    const k = row.key === null ? null : JSON.stringify([row.message, row.key]);
    const existing = k === null ? undefined : groups.get(k);
    if (existing) {
      existing.targets.push(row.target);
      existing.amount += row.amount;
      continue;
    }
    const candidate = { message: row.message, targets: [row.target], value: row.value, amount: row.amount };
    if (k !== null) groups.set(k, candidate);
    out.push(candidate);
  }
  return out;
}

const productsOf = (/** @type {{ message: string, targets: unknown[], value: unknown }[]} */ list) =>
  out(products(...list.map(({ message, targets, value }) => ({ message, targets, value }))));

/**
 * 200 distinct products, each with the Pro stack Black Friday 17 % + VIP 15 %:
 * every line whose stack sums to the rounded 32 % shares one 32 % candidate;
 * the few where the two roundings differ keep their exact amount.
 * @returns {Scenario}
 */
function proStackPercentOutput() {
  const lines = [];
  const rows = [];
  for (let i = 1; i <= 200; i += 1) {
    const price = (49 + i * 1.37).toFixed(2);
    const qty = 1 + (i % 3);
    lines.push({ n: i, price, qty, won: won("vip", "bf") });
    const s = minor(price) * qty;
    const total = Math.min(s, Math.round((s * 17) / 100) + Math.round((s * 15) / 100));
    const target = { cartLine: { id: lineId(i) } };
    const message = "Black Friday + VIP";
    if (total === s) rows.push({ key: "p100", message, value: percent(100), target, amount: total });
    else if (Math.round((s * 32) / 100) === total && !tie(s, 32)) rows.push({ key: "p32", message, value: percent(32), target, amount: total });
    else if (total % qty === 0) rows.push({ key: `e${total / qty}`, message, value: perItem(kc(total / qty)), target, amount: total });
    else rows.push({ key: null, message, value: lineTotal(kc(total)), target, amount: total });
  }
  const expected = productsOf(groupRows(rows));
  return {
    name: "lines-pro-stack-output-percent",
    description:
      "Output size: 200 lines, each with the Pro stack 17 % + 15 %. A stack of whole percents is emitted as the summed percent when that rounds to the same amount (exact), so the lines share one candidate and the output stays far under 20 kB.",
    target: "lines",
    rules: [pct("bf", 17, { name: "Black Friday" }), pct("vip", 15, { name: "VIP", combinesWith: { ruleIds: ["bf"] } })],
    role: AUTO,
    lines,
    expected,
  };
}

/**
 * 200 distinct products, each with the Pro stack "9,99 Kč z kusu" + "Deset procent":
 * every stack amount differs, so the exact output (~38 kB) is over the budget;
 * each stack is then emitted as its top rule's own value (fixed per item or
 * 10 %), and those group.
 * @returns {Scenario}
 */
function proStackDegradedOutput() {
  const lines = [];
  const exactRows = [];
  const degradedRows = [];
  for (let i = 1; i <= 200; i += 1) {
    const price = (50 + i * 1.01).toFixed(2);
    lines.push({ n: i, price, won: won("fix", "ten") });
    const s = minor(price);
    const fix = Math.min(999, s);
    const ten = Math.round((s * 10) / 100);
    const target = { cartLine: { id: lineId(i) } };
    // Rank: amount desc, then id asc ("fix" < "ten").
    const fixFirst = fix >= ten;
    const message = fixFirst ? "9,99 Kč z kusu + Deset procent" : "Deset procent + 9,99 Kč z kusu";
    const total = Math.min(s, fix + ten);
    exactRows.push({ key: `e${total}`, message, value: perItem(kc(total)), target, amount: total });
    degradedRows.push(
      fixFirst
        ? { key: `e${fix}`, message: "9,99 Kč z kusu", value: perItem(kc(fix)), target, amount: fix }
        : tie(s, 10)
          ? // 10 % of a price ending in 5 haléřů is a rounding tie: the exact amount per item.
            { key: `e${ten}`, message: "Deset procent", value: perItem(kc(ten)), target, amount: ten }
          : { key: "p10", message: "Deset procent", value: percent(10), target, amount: ten },
    );
  }
  const exact = productsOf(groupRows(exactRows));
  if (bytes(exact) <= OUTPUT_BUDGET) throw new Error("proStackDegradedOutput: the exact output must be over the budget");
  return {
    name: "lines-pro-stack-output-degraded",
    description:
      "Output size: 200 lines, each with a different Pro stack amount (fixed per item + 10 %): the exact output would be ~38 kB, over Shopify's 20 kB (the node would give nothing), so every stack is emitted as its top rule's own value.",
    target: "lines",
    rules: [
      fixed("fix", { CZK: 999 }, { name: "9,99 Kč z kusu", combinesWith: { ruleIds: ["ten"] } }),
      pct("ten", 10, { name: "Deset procent" }),
    ],
    role: AUTO,
    lines,
    expected: productsOf(groupRows(degradedRows)),
  };
}

/**
 * 24 fixed rules with 200-character names, each on a mix of cheap (free) and
 * dearer items: 48 candidates with long messages are over the budget with no
 * stack to degrade, so the candidates that save the least are dropped until the
 * output fits.
 * @returns {Scenario}
 */
function truncatedOutput() {
  const RULES = 24;
  const ids = Array.from({ length: RULES }, (_, k) => `t${k + 1}`);
  const nameOf = (/** @type {string} */ id) => `${id} ${"Velmi dlouhý název slevy ".repeat(10)}`.slice(0, 200);
  const rules = ids.map((id) => fixed(id, { CZK: 3000 }, { name: nameOf(id) }));
  const lines = [];
  const rows = [];
  for (let i = 1; i <= 200; i += 1) {
    const id = ids[i % RULES];
    const cheap = Math.floor(i / RULES) % 2 === 0;
    const price = cheap ? `${10 + (i % 17)}.50` : `${100 + (i % 23)}.00`;
    lines.push({ n: i, price, won: won(id) });
    const s = minor(price);
    const target = { cartLine: { id: lineId(i) } };
    rows.push(
      cheap
        ? { key: "p100", message: nameOf(id), value: percent(100), target, amount: s }
        : { key: "e3000", message: nameOf(id), value: perItem("30.00"), target, amount: 3000 },
    );
  }
  let kept = groupRows(rows);
  if (bytes(productsOf(kept)) <= OUTPUT_BUDGET) throw new Error("truncatedOutput: must start over the budget");
  while (bytes(productsOf(kept)) > OUTPUT_BUDGET) {
    // Drop the candidate that saves the least (ties: the later one).
    let drop = 0;
    for (let k = 1; k < kept.length; k += 1) if (kept[k].amount <= kept[drop].amount) drop = k;
    kept = kept.filter((_, k) => k !== drop);
  }
  return {
    name: "lines-output-truncated",
    description:
      "Output size, last resort: 48 candidates with 200-character messages and no stack to degrade are over the 19 000 B budget, so the candidates that save the least are dropped until the output fits.",
    target: "lines",
    rules,
    role: AUTO,
    lines,
    expected: productsOf(kept),
  };
}

/**
 * 200 lines of distinct prices ending in 5 haléřů at 10 % under a 200-character
 * name: every line is a rounding tie, and one exact amount per line is far over
 * the budget. Before dropping anything, the ties go back to their percent (at
 * worst 1 haléř per line if Shopify rounds a tie down), which is one candidate.
 * @returns {Scenario}
 */
function tiesRelaxedOutput() {
  const name = `Deset ${"Velmi dlouhý název slevy ".repeat(10)}`.slice(0, 200);
  const lines = [];
  const exactRows = [];
  for (let i = 1; i <= 200; i += 1) {
    const price = kc(1005 + (i - 1) * 10);
    lines.push({ n: i, price, won: won("ten") });
    const s = minor(price);
    if (!tie(s, 10)) throw new Error(`tiesRelaxedOutput: ${price} must be a tie`);
    const amount = Math.round(s / 10);
    exactRows.push({ key: `e${amount}`, message: name, value: perItem(kc(amount)), target: { cartLine: { id: lineId(i) } }, amount });
  }
  if (bytes(productsOf(groupRows(exactRows))) <= OUTPUT_BUDGET) throw new Error("tiesRelaxedOutput: the exact output must be over the budget");
  return {
    name: "lines-output-ties-relaxed",
    description:
      "Output size: 200 rounding ties with a 200-character name are over the budget as exact amounts; they go back to their percent (one candidate) before any candidate is dropped.",
    target: "lines",
    rules: [pct("ten", 10, { name })],
    role: AUTO,
    lines,
    expected: out(products(pc(name, lines.map((l) => l.n), percent(10)))),
  };
}

/**
 * Over 200 lines Shopify scales the output limit with the line count, and so
 * does the budget (240 lines → 22 800 B). 240 lines: the first N each carry a
 * different Pro stack amount (one candidate each), the rest share one 10 %
 * candidate; N is the largest for which the exact output fits the SCALED budget
 * but not the 200-line one, so the output stays exact (not degraded).
 * @returns {Scenario}
 */
function scaledBudgetOutput() {
  const LINES = 240;
  const scaled = Math.floor((OUTPUT_BUDGET * LINES) / 200);
  const build = (/** @type {number} */ stacked) => {
    const lines = [];
    const rows = [];
    for (let i = 1; i <= LINES; i += 1) {
      const target = { cartLine: { id: lineId(i) } };
      if (i <= stacked) {
        const price = `${60 + i}.00`;
        lines.push({ n: i, price, won: won("fix", "ten") });
        const s = minor(price);
        const ten = Math.round(s / 10);
        const total = Math.min(s, 999 + ten);
        // Rank: amount desc, then id asc ("fix" < "ten").
        const message = 999 >= ten ? "9,99 Kč z kusu + Deset procent" : "Deset procent + 9,99 Kč z kusu";
        rows.push({ key: `e${total}`, message, value: perItem(kc(total)), target, amount: total });
      } else {
        lines.push({ n: i, price: "100.0", won: won("ten") });
        rows.push({ key: "p10", message: "Deset procent", value: percent(10), target, amount: 1000 });
      }
    }
    return { lines, expected: productsOf(groupRows(rows)) };
  };
  let stacked = 0;
  while (stacked < LINES && bytes(build(stacked + 1).expected) <= scaled) stacked += 1;
  const { lines, expected } = build(stacked);
  if (bytes(expected) <= OUTPUT_BUDGET) throw new Error("scaledBudgetOutput: must be over the 200-line budget");
  return {
    name: "lines-240-lines-scaled-budget",
    description:
      "Output size above 200 lines: Shopify's limit (and the function's budget) scale with the line count, so a 240-line output over 19 000 B but within the scaled 22 800 B stays exact.",
    target: "lines",
    rules: [
      fixed("fix", { CZK: 999 }, { name: "9,99 Kč z kusu", combinesWith: { ruleIds: ["ten"] } }),
      pct("ten", 10, { name: "Deset procent" }),
    ],
    role: AUTO,
    lines,
    expected,
  };
}

export default allScenarios();
