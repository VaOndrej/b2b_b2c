import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { cardTier } from "@won/core/discounts/card-tier";

// Amounts per market (7 Oct 2026, docs/won-discounts/navrh-castky-podle-trhu.md): the storefront reads the
// amount of the customer's own market ("EUR@sk", from Liquid `localization.market.handle`) before its currency's
// ("EUR") — in the quantity table, on product cards, in the progress to a reward and in the cart panel.

const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extensions/won-discounts-storefront");
const read = (file: string) => readFile(path.join(ext, file), "utf8");

test("every Liquid amount lookup tries the market's key, then the currency's", async () => {
  const tiers = await read("blocks/quantity_tiers.liquid");
  assert.match(tiers, /assign mk = cur \| append: '@' \| append: localization\.market\.handle/);
  assert.equal((tiers.match(/assign d = b\.off\[mk\] \| default: b\.off\[cur\]/g) ?? []).length, 2, "both passes over the breaks");
  assert.doesNotMatch(tiers, /assign d = b\.off\[cur\]/);
  const progress = await read("snippets/won-progress.liquid");
  assert.match(progress, /assign won_ship = rw\.ship\[won_mk\] \| default: rw\.ship\[cur\]/);
  assert.match(progress, /assign won_t = won_g\.t\[won_mk\] \| default: won_g\.t\[cur\]/);
  assert.match(await read("snippets/won-card-tier.liquid"), /assign off = b\.off\[mk\] \| default: b\.off\[cur\]/);
  assert.match(await read("blocks/won_discounts_embed.liquid"), /"mk":\{\{ cur \| append: '@' \| append: localization\.market\.handle \| json \}\}/);
  assert.match(await read("assets/won-discounts-cart.js"), /wd\.plan\(c, data\.rw \|\| \{\}, data\.g \|\| \{\}, data\.mk\)/);
});

test("the card text: the market's own amount, else its currency's, never another market's", () => {
  const cfg = { cards: 1 as const, margin: { on: false as const }, tiers: { global: "g", sets: { g: { count: "product" as const, breaks: [{ min: 3, off: { EUR: 120, "EUR@de": 250 } }] } } } };
  const at = (market: string | null) => cardTier({ cfg, product: null, currency: "EUR", market, costed: false, onSale: false, priceMin: 10000 } as Parameters<typeof cardTier>[0]);
  assert.deepEqual(at("de"), { min: 3, off: 250 });
  assert.deepEqual(at("sk"), { min: 3, off: 120 });
  assert.deepEqual(at(null), { min: 3, off: 120 });
  const only = { ...cfg, tiers: { global: "g", sets: { g: { count: "product" as const, breaks: [{ min: 3, off: { "EUR@de": 250 } }] } } } };
  assert.equal(cardTier({ cfg: only, product: null, currency: "EUR", market: "sk", costed: false, onSale: false, priceMin: 10000 } as Parameters<typeof cardTier>[0]), null);
});

test("a market left without an amount (−1 under its key) is never given the currency's fallback on the storefront", async () => {
  const tiers = await read("blocks/quantity_tiers.liquid");
  assert.equal((tiers.match(/if d == nil or d < 0\s+continue/g) ?? []).length, 2, "both passes skip the break");
  const progress = await read("snippets/won-progress.liquid");
  assert.match(progress, /if won_ship != nil and won_ship < 0\s+assign won_ship = nil/);
  assert.match(progress, /if won_t != nil and won_t < 0\s+assign won_t = nil/);
  assert.match(await read("assets/won-discounts.js"), /return v > 0 \? v : undefined;/);
  const cfg = { cards: 1 as const, margin: { on: false as const }, tiers: { global: "g", sets: { g: { count: "product" as const, breaks: [{ min: 3, off: { EUR: 120, "EUR@de": -1, "EUR@sk": 120 } }] } } } };
  const at = (market: string | null) => cardTier({ cfg, product: null, currency: "EUR", market, costed: false, onSale: false, priceMin: 10000 } as Parameters<typeof cardTier>[0]);
  assert.equal(at("de"), null, "Germany: not offered");
  assert.deepEqual(at("sk"), { min: 3, off: 120 });
  assert.deepEqual(at(null), { min: 3, off: 120 }, "no market: the fallback");
});
