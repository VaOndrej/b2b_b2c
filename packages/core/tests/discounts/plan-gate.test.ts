// BILL-1 server gate (spec §7, audit MVP 1 P1-1): what a Free shop's function
// payload may carry. The stored config never changes (§14a); the gate returns a
// copy without every Pro capability and a list of what it took out, so the
// admin can say exactly what is not in force.

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig, type WonDiscountsConfig } from "../../src/discounts/config.ts";
import { buildShopFunctionConfig } from "../../src/discounts/function-payload.ts";
import { explainGate, gateConfigForPlan, PRO_CAPABILITIES, type StrippedCapability } from "../../src/discounts/plan-gate.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { cartOf, freeShip, line, orderPct, outcome, pct } from "./engine-fixtures.ts";

const NOW = "2026-10-01T12:00:00";
const TZ = "Europe/Prague";

/** A config that uses every Pro capability the config types have today. */
function proConfig(): WonDiscountsConfig {
  const { config, issues } = sanitizeConfig({
    markets: [
      { handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] },
      { handle: "sk", currency: "EUR", enabled: true, countries: ["SK"] },
    ],
    modules: {
      codes: {
        rules: [
          pct("stack-a", 10, { name: "Letní", combinesWith: { ruleIds: ["stack-b"] } }),
          pct("stack-b", 5, { name: "Věrnost" }),
          pct("sk-only", 20, { name: "Jen Slovensko", targeting: { markets: ["sk"] } }),
          pct("vip", 30, { name: "VIP", targeting: { segments: ["gid://shopify/Segment/1"] } }),
          // Already off: its Pro data is stripped, but "not in force" is nothing new to report.
          pct("off", 40, { name: "Vypnutá", enabled: false, targeting: { markets: ["sk"] }, combinesWith: { ruleIds: ["plain"] } }),
          orderPct("plain", 5, { name: "Objednávka" }),
          freeShip("ship", { name: "Doprava" }),
        ],
      },
      tiers: {
        sets: [
          { id: "scoped", scope: { collectionIds: ["gid://shopify/Collection/1"] }, countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] },
          { id: "global", scope: "global", countAcross: "cart", breaks: [{ minQty: 3, percent: 10 }] },
          { id: "global-2", scope: "global", countAcross: "line", breaks: [{ minQty: 5, percent: 15 }] },
        ],
      },
      rewards: {
        gifts: [
          { id: "g1", threshold: { CZK: 1000_00 }, choices: ["gid://shopify/ProductVariant/1", "gid://shopify/ProductVariant/2", "gid://shopify/ProductVariant/3"] },
          { id: "g2", threshold: { CZK: 2000_00 }, choices: ["gid://shopify/ProductVariant/4"] },
          { id: "g3", threshold: { CZK: 3000_00 }, choices: ["gid://shopify/ProductVariant/5"] },
        ],
        countOtherDiscounts: false,
      },
      margin: {
        global: { maxDiscountPercent: 50, minMarginPercent: 10 },
        perCollection: [
          { collectionId: "gid://shopify/Collection/9", maxDiscountPercent: 20 },
          { collectionId: "gid://shopify/Collection/8", minMarginPercent: 25 },
        ],
      },
    },
    campaigns: [
      {
        id: "bf",
        name: "Black Friday",
        window: { start: "2026-09-30T00:00:00", end: "2026-10-05T23:59:59" },
        overrides: [{ ruleId: "plain", patch: { value: { kind: "percentage", percent: 30 } } }],
        killed: false,
      },
      {
        id: "summer",
        name: "Léto",
        window: { start: "2026-07-01T00:00:00", end: "2026-07-31T23:59:59" },
        overrides: [{ ruleId: "plain", patch: { value: { kind: "percentage", percent: 20 } } }],
        killed: false,
      },
    ],
  });
  assert.deepEqual(issues, []);
  return config;
}

test("Pro: the config passes unchanged (a copy), nothing is stripped", () => {
  const config = proConfig();
  const gated = gateConfigForPlan(config, "pro");
  assert.deepEqual(gated.config, config);
  assert.notEqual(gated.config, config);
  assert.deepEqual(gated.stripped, []);
});

test("Free: every Pro capability is out of the gated config; the stored config is untouched", () => {
  const config = proConfig();
  const before = JSON.stringify(config);
  const { config: free, stripped } = gateConfigForPlan(config, "free", { now: NOW });
  assert.equal(JSON.stringify(config), before, "the input is never mutated (§14a)");

  const rule = (id: string) => free.modules.codes.rules.find((r) => r.id === id)!;
  // Per-rule combinations are gone; the category switches stay.
  assert.equal(rule("stack-a").combinesWith, undefined);
  assert.deepEqual(free.engine, config.engine);
  // Market / segment targeting would WIDEN the rule if simply removed: the rule is off instead.
  assert.equal(rule("sk-only").enabled, false);
  assert.equal(rule("sk-only").targeting, undefined);
  assert.equal(rule("vip").enabled, false);
  assert.equal(rule("vip").targeting, undefined);
  assert.equal(rule("plain").enabled, true);
  assert.equal(rule("off").targeting, undefined);
  assert.equal(rule("off").combinesWith, undefined);
  // Campaigns are Pro.
  assert.deepEqual(free.campaigns, []);
  // Exactly one global tier set, counting per product (never across the cart); a scoped set stays
  // INERT (contract K1: its products get no tier rather than the global one); a further global set goes.
  assert.deepEqual(free.modules.tiers.sets, [
    { id: "scoped", scope: { collectionIds: ["gid://shopify/Collection/1"] }, countAcross: "line", breaks: [] },
    { id: "global", scope: "global", countAcross: "product", breaks: [{ minQty: 3, percent: 10 }] },
  ]);
  // Milníky: the first two steps of the ladder, one gift each.
  assert.deepEqual(free.modules.rewards.gifts, [
    { id: "g1", threshold: { CZK: 1000_00 }, choices: ["gid://shopify/ProductVariant/1"] },
    { id: "g2", threshold: { CZK: 2000_00 }, choices: ["gid://shopify/ProductVariant/4"] },
  ]);
  // Per-collection margin folds into the global floor, the strictest value wins (never a larger discount).
  // (`enabled` is the stored switch — the gate folds values, it never turns protection on or off.)
  assert.deepEqual(free.modules.margin, { enabled: false, global: { maxDiscountPercent: 20, minMarginPercent: 25 }, perCollection: [], perProduct: [] });

  // Exactly what changed: no entry for the rule that was already off or the campaign that already
  // ended ("summer", July), the ids of what was removed, and the margin's old and new values.
  assert.deepEqual(
    stripped.map((s) => [s.capability, s.reason, s.ruleId ?? s.entityId ?? null, s.count ?? null, s.removedIds ?? null]),
    [
      ["rule_combinations", "removed", "stack-a", null, null],
      ["market_targeting", "rule_off", "sk-only", null, null],
      ["segment_targeting", "rule_off", "vip", null, null],
      ["campaigns", "removed", "bf", null, null],
      ["tier_set_scope", "removed", null, 1, ["scoped"]],
      ["tier_sets_extra", "removed", null, 1, ["global-2"]],
      ["tier_count_across_cart", "reduced", "global", null, null],
      ["milestone_steps", "reduced", null, 1, ["g3"]],
      ["gift_choices", "reduced", "g1", 2, ["gid://shopify/ProductVariant/2", "gid://shopify/ProductVariant/3"]],
      ["margin_per_collection", "folded", null, 2, ["gid://shopify/Collection/9", "gid://shopify/Collection/8"]],
    ],
  );
  assert.deepEqual(stripped.at(-1)?.values, {
    maxDiscountPercent: { from: 50, to: 20 },
    minMarginPercent: { from: 10, to: 25 },
  });
  // Without `now` the gate cannot tell an ended campaign: it lists every campaign that is not killed.
  assert.deepEqual(
    gateConfigForPlan(config, "free").stripped.filter((s) => s.capability === "campaigns").map((s) => s.entityId),
    ["bf", "summer"],
  );
  for (const s of stripped) assert.ok(PRO_CAPABILITIES.includes(s.capability));
});

test("Free payload: no Pro data reaches the function, and the checkout plans without it", () => {
  const { config: free } = gateConfigForPlan(proConfig(), "free", { now: NOW });
  const payload = buildShopFunctionConfig(free, { now: NOW, shopTimezone: TZ }).payload;
  const json = JSON.stringify(payload);
  assert.equal(payload.campaignId, null);
  assert.deepEqual(payload.campaigns, []);
  assert.deepEqual(payload.marketCountries, {}, "no market targeting → no market countries");
  assert.ok(!json.includes("combinesWith"), json);
  assert.ok(!json.includes("targeting"), json);

  // The stack 10 % + 5 % the audit saw at checkout (P1-1) is now the better single one.
  const plan = planCart(cartOf([line("L1", 100_00, 1, ["stack-a", "stack-b", "sk-only"])], { countryCode: "SK", currency: "CZK" }), payload);
  assert.equal(plan.lines[0].product?.amount, 10_00);
  assert.equal(outcome(plan, "sk-only").state, "disabled");
});

test("Free: a config without Pro data strips nothing", () => {
  const { config } = sanitizeConfig({
    modules: {
      codes: { rules: [pct("a", 10, { combinesWith: { ruleIds: [] } }), orderPct("o", 5)] },
      tiers: { sets: [{ id: "t", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }] },
      rewards: { gifts: [{ id: "g", threshold: { CZK: 500_00 }, choices: ["gid://shopify/ProductVariant/1"] }], countOtherDiscounts: false },
    },
  });
  const gated = gateConfigForPlan(config, "free");
  assert.deepEqual(gated.stripped, []);
  assert.equal(gated.config.modules.codes.rules[0].combinesWith, undefined, "an empty list is simply dropped");
});

test("explainGate: one human sentence per stripped capability, Czech and English, never an enum key", () => {
  const { stripped } = gateConfigForPlan(proConfig(), "free", { now: NOW });
  for (const locale of ["cs", "en"] as const) {
    const lines = explainGate(stripped, locale);
    assert.equal(lines.length, stripped.length);
    for (const [i, item] of lines.entries()) {
      assert.ok(item.text.length > 20, item.text);
      assert.ok(!/[a-z]+_[a-z]+/.test(item.text), `enum key in "${item.text}"`);
      assert.equal(item.ruleId, stripped[i].ruleId);
    }
  }
  const cs = explainGate(stripped, "cs").map((i) => i.text);
  assert.ok(cs.includes("Sleva „Jen Slovensko“ cílí na vybrané trhy. To je funkce Pro, ve Free se proto neuplatní vůbec."), cs.join("\n"));
  assert.ok(cs.includes("Kampaň „Black Friday“ ve Free neběží, kampaně jsou funkce Pro. Platí běžné nastavení slev."), cs.join("\n"));
  const en = explainGate(stripped, "en").map((i) => i.text);
  assert.ok(en.includes("“Jen Slovensko” targets selected markets. That is a Pro feature, so on Free it does not apply at all."), en.join("\n"));
  assert.deepEqual(explainGate([], "cs"), []);
  // The margin sentence names the numbers that changed.
  assert.ok(
    cs.includes(
      "Ochrana marže pro jednotlivé kolekce je funkce Pro. Ve Free platí jedno minimum pro celý obchod: použili jsme to nejpřísnější z vašeho nastavení, max. sleva 20\u00a0% (bylo 50\u00a0%), min. marže 25\u00a0% (bylo 10\u00a0%).",
    ),
    cs.join("\n"),
  );
});

test("explainGate: Czech plurals for 1, 2 and 5 (tier sets, gift thresholds, gift choices)", () => {
  const cs = (capability: StrippedCapability["capability"], count: number) =>
    explainGate([{ capability, reason: "removed", count }], "cs")[0].text;
  assert.equal(cs("tier_sets_extra", 1), "Ve Free platí jen jedna sada množstevních slev pro celý obchod, další sada se neuplatní.");
  assert.equal(cs("tier_sets_extra", 2), "Ve Free platí jen jedna sada množstevních slev pro celý obchod, další 2 sady se neuplatní.");
  assert.equal(cs("tier_sets_extra", 5), "Ve Free platí jen jedna sada množstevních slev pro celý obchod, dalších 5 sad se neuplatní.");
  assert.equal(cs("milestone_steps", 1), "Ve Free platí v každém trhu 2 stupně Milníků s nejnižší částkou. Jeden stupeň se proto někde nenabízí. V Pro jich platí 6.");
  assert.equal(cs("milestone_steps", 2), "Ve Free platí v každém trhu 2 stupně Milníků s nejnižší částkou. 2 stupně se proto někde nenabízejí. V Pro jich platí 6.");
  assert.equal(cs("milestone_steps", 5), "Ve Free platí v každém trhu 2 stupně Milníků s nejnižší částkou. 5 stupňů se proto někde nenabízí. V Pro jich platí 6.");
  assert.equal(cs("gift_choices", 1), "Ve Free se nabízí jen první dárek z výběru, další dárek ne (výběr dárků je funkce Pro).");
  assert.equal(cs("gift_choices", 2), "Ve Free se nabízí jen první dárek z výběru, další 2 dárky ne (výběr dárků je funkce Pro).");
  assert.equal(cs("gift_choices", 5), "Ve Free se nabízí jen první dárek z výběru, dalších 5 dárků ne (výběr dárků je funkce Pro).");
  assert.equal(
    cs("tier_set_scope", 1),
    "1 sada množstevních slev pro vybrané produkty nebo kolekce ve Free neplatí, je to funkce Pro. Produkty v ní ve Free nedostanou žádnou množstevní slevu.",
  );
  assert.equal(
    cs("tier_set_scope", 2),
    "2 sady množstevních slev pro vybrané produkty nebo kolekce ve Free neplatí, je to funkce Pro. Produkty v nich ve Free nedostanou žádnou množstevní slevu.",
  );
  assert.equal(
    cs("tier_set_scope", 5),
    "5 sad množstevních slev pro vybrané produkty nebo kolekce ve Free neplatí, je to funkce Pro. Produkty v nich ve Free nedostanou žádnou množstevní slevu.",
  );
  const en = (capability: StrippedCapability["capability"], count: number) =>
    explainGate([{ capability, reason: "removed", count }], "en")[0].text;
  assert.equal(en("milestone_steps", 2), "On Free each market runs the 2 Milestones steps with the lowest amount. 2 steps are therefore not offered somewhere. Pro runs 6.");
  assert.equal(en("gift_choices", 1), "On Free only the first gift of the choice is offered, not the other one (a gift choice is a Pro feature).");
});
