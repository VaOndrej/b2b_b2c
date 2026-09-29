// The function scenarios (spec §3 A1, "Emise per uzel"): one entry per fixture
// file in tests/fixtures/. Each states the merchant config, the node (role,
// classes, triggering code), the cart, and the EXPECTED output written by hand
// from the spec — never copied from a run. tests/fixture-builder.js turns a
// scenario into the function input; `npm run fixtures -w won-discounts-engine`
// writes the files; tests/fixtures.drift.test.js keeps them in sync.

import {
  DEFAULT_GROUP,
  fixed,
  freeShip,
  lineId,
  orderPct,
  pct,
  variantId,
  withCodes,
} from "./fixture-builder.js";

/** @typedef {import("./fixture-builder.js").Scenario} Scenario */

// --- Expected-output helpers ---------------------------------------------------------------

const NONE = { operations: [] };
const out = (/** @type {unknown[]} */ ...operations) => ({ operations });
const percent = (/** @type {number} */ value) => ({ percentage: { value } });
const perItem = (/** @type {string} */ amount) => ({ fixedAmount: { amount, appliesToEachItem: true } });
const lineTotal = (/** @type {string} */ amount) => ({ fixedAmount: { amount, appliesToEachItem: false } });

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

// --- Shared configs ------------------------------------------------------------------------

const SUMMER = pct("summer", 10, { name: "Letní sleva" });
const WELCOME = withCodes(["WELCOME15"], pct("welcome", 15, { name: "Vítejte" }));
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
  {
    name: "delivery-no-shipping-class",
    description: "A node without the SHIPPING class never emits a delivery candidate.",
    target: "delivery",
    rules: [SHIP],
    role: AUTO,
    classes: ["PRODUCT", "ORDER"],
    lines: [{ n: 1, price: "2000.0", won: null }],
    expected: NONE,
  },
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

  // --- output size (Shopify: 20 kB for ≤ 200 lines) ----------------------------------------
  proStackPercentOutput(),
  proStackDegradedOutput(),
  truncatedOutput(),
  tiesRelaxedOutput(),
  scaledBudgetOutput(),

  // --- instruction budget ------------------------------------------------------------------
  budget("lines"),
  budget("delivery"),
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
      "Instruction budget: 200 lines × 3–6 refs, 37 rules, entered codes, a Pro stack, outlet lines — the automatic node must stay under the Shopify instruction limit with ≥ 30 % headroom.",
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
