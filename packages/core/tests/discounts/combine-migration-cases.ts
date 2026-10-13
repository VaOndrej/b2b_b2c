// The cases of the "before and after" test of the combination change (docs/won-discounts/navrh-kombinace-2026-10-13.md,
// "Převod stávajících obchodů"): shops stored in the OLD shape (schema 1: four category switches in
// `engine.combination`, `combinesWith` on a rule) and carts for them. Not a test file itself.
//
// The cases are generated from a fixed seed, so they are the same on every run. What the engine BEFORE the change
// gave each cart is frozen in fixtures/combine-before.json (written once by the last commit that still had that
// engine, b21f1f4, with fixtures/gen-combine-before.ts). NEVER change this generator: the frozen results belong to
// exactly these cases, and the engine that produced them no longer exists.

import type { CartLineInput, CartPlanInput } from "../../src/discounts/cart.ts";

export interface CombineCase {
  /** The stored config, schema 1 (raw: it goes through the sanitizer like any stored value). */
  config: Record<string, unknown>;
  plan: "free" | "pro";
  cart: CartPlanInput;
}

/** What a plan gives the customer, as the frozen file holds it. */
export interface CombineResult {
  /** Product discount per cart line, minor units, cart order. */
  lines: number[];
  order: number;
  /** The shipping discount's rule id (`reward:shipping` for the milestone), or null. */
  shipping: string | null;
  /** Gift tiers whose gift is free. */
  gifts: string[];
  total: number;
}

export const COMBINE_CASES_SEED = 20261013;
export const COMBINE_CASES_COUNT = 600;

/** mulberry32: a small deterministic generator (the same sequence on every runtime). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const P = (n: number) => `gid://shopify/Product/${n}`;
const GIFT_VARIANT = 9001;

export function combineCases(): CombineCase[] {
  const next = rng(COMBINE_CASES_SEED);
  const chance = (p: number) => next() < p;
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const out: CombineCase[] = [];

  for (let n = 0; n < COMBINE_CASES_COUNT; n++) {
    // Half the shops never touched the switches (the defaults); the others have each one at random.
    const defaults = chance(0.5);
    const combination = {
      outletWithAnything: defaults ? false : chance(0.4),
      productWithProduct: "best",
      productWithOrder: defaults ? true : chance(0.6),
      productWithShipping: defaults ? true : chance(0.6),
      orderWithShipping: defaults ? true : chance(0.6),
    };

    const rules: Record<string, unknown>[] = [];
    const productRules: string[] = [];
    const codesOf = new Map<string, string>();
    const ruleCount = int(0, 6);
    for (let i = 0; i < ruleCount; i++) {
      const id = `r${i + 1}`;
      const kind = pick(["product", "product", "product", "order", "order", "shipping"] as const);
      const method = chance(0.4) ? "code" : "automatic";
      const value =
        kind === "shipping"
          ? { kind: "freeShipping" }
          : chance(0.7)
            ? { kind: "percentage", percent: pick([5, 10, 15, 20, 30]) }
            : { kind: "fixed", amount: { CZK: pick([50_00, 100_00, 250_00]) } };
      const target = kind === "product" ? { kind: "products", productIds: [], variantIds: [] } : kind === "order" ? { kind: "order" } : { kind: "shipping" };
      const rule: Record<string, unknown> = { id, enabled: !chance(0.1), name: `Rule ${id}`, method, value, target };
      if (method === "code") {
        const code = `CODE${i + 1}`;
        rule.codes = [code];
        codesOf.set(id, code);
      }
      if (chance(0.2)) rule.priority = int(1, 3);
      if (kind !== "product" && chance(0.25)) rule.minimum = { subtotal: { CZK: pick([500_00, 1500_00]) } };
      if (kind === "product") productRules.push(id);
      rules.push(rule);
    }
    // "Sčítá se s" on some rules: any other rule, of the same class or not (the old engine read it within a class only).
    if (rules.length > 1 && chance(0.45)) {
      const links = int(1, 3);
      for (let i = 0; i < links; i++) {
        const a = pick(rules);
        const b = pick(rules);
        if (a === b) continue;
        const list = ((a.combinesWith as { ruleIds: string[] } | undefined) ?? { ruleIds: [] }).ruleIds;
        if (!list.includes(b.id as string)) list.push(b.id as string);
        a.combinesWith = { ruleIds: list };
      }
    }
    // Milníky: order discounts for a cart value (ordinary rules with the id prefix "ms-").
    if (chance(0.25)) {
      const steps = int(1, 2);
      for (let i = 0; i < steps; i++) {
        rules.push({
          id: `ms-${i + 1}`,
          enabled: true,
          name: "",
          method: "automatic",
          value: { kind: "percentage", percent: pick([3, 5, 8]) },
          target: { kind: "order" },
          minimum: { subtotal: { CZK: pick([800_00, 2000_00]) }, scope: "cart" },
        });
      }
    }

    const modules: Record<string, unknown> = { codes: { rules } };
    if (chance(0.45)) {
      modules.tiers = {
        sets: [
          {
            id: "g",
            scope: "global",
            countAcross: pick(["line", "product"]),
            breaks: [
              { minQty: 2, percent: pick([5, 10]) },
              { minQty: 4, percent: pick([15, 25]) },
            ],
          },
        ],
      };
    }
    const giftTier = chance(0.3);
    if (chance(0.4) || giftTier) {
      modules.rewards = {
        ...(chance(0.7) ? { freeShipping: { threshold: { CZK: pick([500_00, 1500_00]) } } } : {}),
        gifts: giftTier ? [{ id: "gift-1", threshold: { CZK: pick([600_00, 1800_00]) }, choices: [V(GIFT_VARIANT)] }] : [],
        countOtherDiscounts: chance(0.3),
      };
    }
    if (chance(0.15)) modules.margin = { enabled: true, global: { maxDiscountPercent: pick([20, 40]) }, perCollection: [], perProduct: [] };

    const config = { schemaVersion: 1, markets: [{ handle: "cz", currency: "CZK", enabled: true }], engine: { combination }, modules };

    // Two carts a shop, so one config is seen with and without codes, sale lines and a gift.
    for (let c = 0; c < 2; c++) {
      const lines: CartLineInput[] = [];
      const lineCount = int(1, 4);
      for (let i = 0; i < lineCount; i++) {
        const product = int(1, 3);
        const line: CartLineInput = {
          id: `L${i + 1}`,
          variantId: V(product * 10 + i),
          productId: P(product),
          quantity: int(1, 5),
          unitPrice: pick([120_00, 250_00, 499_00, 1000_00]),
          ruleIds: productRules.filter(() => chance(0.6)),
        };
        // A sale line: under the shop's rule (`true`) or with its own list (1–6: tiers 1, product 2, order 4).
        if (chance(0.2)) line.outlet = chance(0.6) ? true : int(1, 6);
        lines.push(line);
      }
      if (giftTier && chance(0.7)) {
        lines.push({ id: "G1", variantId: V(GIFT_VARIANT), productId: P(900), quantity: 1, unitPrice: 300_00, ruleIds: [], giftTierId: "gift-1" });
      }
      const enteredCodes = [...codesOf.values()].filter(() => chance(0.6));
      out.push({
        config,
        plan: chance(0.5) ? "pro" : "free",
        cart: { currency: "CZK", countryCode: "CZ", lines, enteredCodes, today: "2026-10-01" },
      });
    }
  }
  return out;
}

/** What `plan` gives, in the frozen file's shape. */
export function combineResultOf(plan: {
  lines: { lineId: string; product: { amount: number } | null }[];
  order: { amount: number } | null;
  shipping: { ruleId: string } | null;
  gifts: { tierId: string; state: string }[];
  totals: { total: number };
}): CombineResult {
  return {
    lines: plan.lines.map((l) => l.product?.amount ?? 0),
    order: plan.order?.amount ?? 0,
    shipping: plan.shipping?.ruleId ?? null,
    gifts: plan.gifts.filter((g) => g.state === "earned").map((g) => g.tierId),
    total: plan.totals.total,
  };
}
