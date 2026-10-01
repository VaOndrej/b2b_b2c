// MVP 4 contracts R5 + R7 + the rewards sanitizer. The function payload carries
// rewards compact (R5): `s` = free-shipping threshold per currency (minor
// units), `g` = [tierId, threshold per currency, numeric variant ids (choices
// then the fallback)], `o` only when countOtherDiscounts is on. The storefront
// config (R7) carries the same in Liquid units with each variant's product
// handle (from the sync), so Liquid can render the gift.

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig } from "../../src/discounts/config.ts";
import { buildShopFunctionConfig, buildShopFunctionConfigWorstCase } from "../../src/discounts/function-payload.ts";
import { buildRewardsPayload, readRewardsPayload } from "../../src/discounts/rewards.ts";
import { buildStorefrontConfig } from "../../src/discounts/storefront-config.ts";

const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const OPTS = { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague", shopCurrency: "CZK" };

function config(rewards: unknown) {
  const out = sanitizeConfig({ modules: { rewards } });
  return out;
}

test("R5: compact payload — thresholds per currency, numeric variant ids (choices, then the fallback), `o` only when on", () => {
  const { config: c, issues } = config({
    freeShipping: { threshold: { CZK: 1000_00, EUR: 40_00 } },
    gifts: [
      { id: "gift-1", threshold: { CZK: 1500_00 }, choices: [V(11), V(12)], fallbackVariantId: V(13) },
      { id: "gift-2", threshold: { EUR: 80_00 }, choices: [V(21)] },
    ],
    countOtherDiscounts: false,
  });
  assert.deepEqual(issues, []);
  assert.deepEqual(buildRewardsPayload(c.modules.rewards), {
    s: { CZK: 1000_00, EUR: 40_00 },
    g: [
      ["gift-1", { CZK: 1500_00 }, [11, 12, 13]],
      ["gift-2", { EUR: 80_00 }, [21]],
    ],
  });
  const on = config({ gifts: [], countOtherDiscounts: true }).config;
  assert.deepEqual(buildRewardsPayload(on.modules.rewards), { g: [], o: 1 });
});

test("R5: the shop config ships the compact rewards under modules.rewards", () => {
  const c = config({ freeShipping: { threshold: { CZK: 500_00 } }, gifts: [] }).config;
  const built = buildShopFunctionConfig(c, OPTS);
  assert.deepEqual(built.payload.modules.rewards, { s: { CZK: 500_00 }, g: [] });
});

test("R5: readRewardsPayload is tolerant — junk, the pre-MVP 4 shape and non-numeric ids read as nothing offered", () => {
  assert.deepEqual(readRewardsPayload(undefined), { shipping: null, tiers: [], countOther: false });
  assert.deepEqual(readRewardsPayload({ freeShipping: { threshold: { CZK: 1 } }, gifts: [], countOtherDiscounts: false }), {
    shipping: null,
    tiers: [],
    countOther: false,
  });
  assert.deepEqual(
    readRewardsPayload({ s: { CZK: 1000_00, EUR: "x", USD: -1, GBP: 1.5 }, g: [["a", { CZK: 5 }, [1, "2", 3.5, -4, 5]], ["", {}, []], "junk", ["b"]], o: 1 }),
    {
      shipping: { CZK: 1000_00 },
      tiers: [{ id: "a", threshold: { CZK: 5 }, variants: [1, 5] }],
      countOther: true,
    },
  );
});

test("sanitizer: a threshold must be a whole positive amount; Pro offers at most 3 gifts; the fallback cannot be one of them", () => {
  const { config: c, issues } = config({
    freeShipping: { threshold: { CZK: 0, EUR: 40_00 } },
    gifts: [{ id: "g", threshold: { CZK: -5, EUR: 10_00 }, choices: [V(1), V(2), V(3), V(4)], fallbackVariantId: V(2) }],
  });
  assert.deepEqual(c.modules.rewards.freeShipping, { threshold: { EUR: 40_00 } });
  assert.deepEqual(c.modules.rewards.gifts[0]!.threshold, { EUR: 10_00 });
  assert.deepEqual(c.modules.rewards.gifts[0]!.choices, [V(1), V(2), V(3)]);
  assert.equal(c.modules.rewards.gifts[0]!.fallbackVariantId, undefined);
  const codes = issues.map((i) => i.code).sort();
  assert.ok(codes.includes("too_many_gift_choices"), JSON.stringify(codes));
  assert.ok(codes.includes("gift_fallback_is_choice"), JSON.stringify(codes));
});

test("worst case: 10 Pro tiers × 4 variants in 2 currencies fit the 9 000 B budget next to the rest", () => {
  const gifts = Array.from({ length: 10 }, (_, i) => ({
    id: `gift-tier-${String(i).padStart(2, "0")}-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH`.slice(0, 64),
    threshold: { CZK: 99_999_999_00, EUR: 9_999_999_99 },
    choices: [V(48468678902001 + i), V(48468678902101 + i), V(48468678902201 + i)],
    fallbackVariantId: V(48468678902301 + i),
  }));
  const c = config({ freeShipping: { threshold: { CZK: 99_999_999_00, EUR: 9_999_999_99 } }, gifts, countOtherDiscounts: true }).config;
  const worst = buildShopFunctionConfigWorstCase(c, OPTS);
  const rewardsBytes = JSON.stringify(worst.payload.modules.rewards).length;
  // 64-character tier ids, 16-digit variant ids, both thresholds at the money cap: 1 642 B measured.
  assert.ok(rewardsBytes <= 1_700, `rewards ${rewardsBytes} B`);
  assert.equal(worst.fits, true);
});

test("R7: storefront config — Liquid units, the product handle of every variant, the fallback apart; a variant without a handle is left out", () => {
  const c = config({
    freeShipping: { threshold: { CZK: 1000_00, EUR: 40_00, JPY: 5000 } },
    gifts: [{ id: "gift-1", threshold: { CZK: 1500_00 }, choices: [V(11), V(12)], fallbackVariantId: V(13) }],
    countOtherDiscounts: true,
  }).config;
  const sf = buildStorefrontConfig(c, {
    configVersion: "v1",
    shopCurrency: "CZK",
    variantHandles: { [V(11)]: "won-e2e-spare", [V(13)]: "won-e2e-simple-b" },
  });
  assert.deepEqual(sf.rewards, {
    ship: { CZK: 1000_00, EUR: 40_00, JPY: 5000_00 },
    gifts: [{ id: "gift-1", t: { CZK: 1500_00 }, c: [{ v: 11, h: "won-e2e-spare" }], f: { v: 13, h: "won-e2e-simple-b" } }],
    other: true,
  });
});

test("R7: no rewards configured → `rewards` is left out (the embed hides the panel)", () => {
  const c = config({ gifts: [] }).config;
  const sf = buildStorefrontConfig(c, { configVersion: "v1", shopCurrency: "CZK" });
  assert.equal(sf.rewards, undefined);
});
