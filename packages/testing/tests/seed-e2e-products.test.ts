import assert from "node:assert/strict";
import test from "node:test";

import { WON_E2E_PRODUCTS } from "../src/e2e-products.js";
import {
  matchVariant,
  parseArgs,
  planCostChanges,
  toProductSetInput,
} from "../scripts/seed-e2e-products.mjs";

test("catalog costs match the MVP 2 margin brief exactly", () => {
  assert.equal(WON_E2E_PRODUCTS.simpleA.variants[0].cost, "6.00");

  const [small, large] = WON_E2E_PRODUCTS.twoVariants.variants;
  assert.equal(small.options.Size, "Small");
  assert.equal(small.cost, "5.00");
  assert.equal(large.options.Size, "Large");
  assert.equal("cost" in large, false, "Large must have no cost (A2 path)");

  for (const variant of WON_E2E_PRODUCTS.multiAxis.variants) {
    assert.equal(variant.cost, "8.00");
  }

  assert.equal("cost" in WON_E2E_PRODUCTS.simpleB.variants[0], false);
  assert.equal("cost" in WON_E2E_PRODUCTS.spare.variants[0], false);
});

test("parseArgs reads --dry-run, --via-app and --version", () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, viaApp: null, version: null });
  assert.deepEqual(parseArgs(["--dry-run"]), { dryRun: true, viaApp: null, version: null });
  assert.deepEqual(parseArgs(["--via-app", "apps/won-discounts", "--dry-run"]), {
    dryRun: true,
    viaApp: "apps/won-discounts",
    version: null,
  });
  assert.deepEqual(parseArgs(["--via-app", "apps/won-discounts", "--version", "2026-07"]), {
    dryRun: false,
    viaApp: "apps/won-discounts",
    version: "2026-07",
  });
  assert.throws(() => parseArgs(["--nope"]), /unknown argument/);
  assert.throws(() => parseArgs(["--via-app"]), /--via-app requires/);
});

test("matchVariant matches a single-variant product by taking the sole node", () => {
  const nodes = [{ id: "gid://1", selectedOptions: [{ name: "Title", value: "Default Title" }] }];
  assert.equal(matchVariant(nodes, { options: {} }, false), nodes[0]);
});

test("matchVariant matches a multi-axis variant by its option values", () => {
  const nodes = [
    { id: "gid://s-red", selectedOptions: [{ name: "Size", value: "S" }, { name: "Color", value: "Red" }] },
    { id: "gid://m-blue", selectedOptions: [{ name: "Size", value: "M" }, { name: "Color", value: "Blue" }] },
  ];
  const match = matchVariant(nodes, { options: { Size: "M", Color: "Blue" } }, true);
  assert.equal(match.id, "gid://m-blue");
  assert.equal(matchVariant(nodes, { options: { Size: "M", Color: "Red" } }, true), null);
});

test("planCostChanges only plans variants that declare a cost, and flags unchanged ones", () => {
  const catalogProduct = {
    options: [{ name: "Size", values: ["Small", "Large"] }],
    variants: [
      { price: "15.00", options: { Size: "Small" }, cost: "5.00" },
      { price: "18.00", options: { Size: "Large" } }, // no cost: never planned
    ],
  };
  const existingProduct = {
    variants: {
      nodes: [
        {
          id: "gid://small",
          selectedOptions: [{ name: "Size", value: "Small" }],
          inventoryItem: { unitCost: { amount: "5.0", currencyCode: "USD" } },
        },
        {
          id: "gid://large",
          selectedOptions: [{ name: "Size", value: "Large" }],
          inventoryItem: { unitCost: null },
        },
      ],
    },
  };

  const plan = planCostChanges(existingProduct, catalogProduct);
  assert.equal(plan.length, 1, "the costless Large variant must never appear in the plan");
  assert.equal(plan[0].variantId, "gid://small");
  assert.equal(plan[0].unchanged, true, "5.0 already equals 5.00");
});

test("planCostChanges reports a real change and a missing variant", () => {
  const catalogProduct = {
    options: [],
    variants: [{ price: "10.00", cost: "6.00" }],
  };
  const changed = planCostChanges(
    { variants: { nodes: [{ id: "gid://v", selectedOptions: [], inventoryItem: { unitCost: { amount: "4.00", currencyCode: "USD" } } }] } },
    catalogProduct,
  );
  assert.equal(changed[0].unchanged, false);
  assert.equal(changed[0].newCost, "6.00");

  const missing = planCostChanges(null, catalogProduct);
  assert.equal(missing[0].notFound, true);
  assert.equal(missing[0].variantId, null);
});

test("toProductSetInput is unchanged for options-based products (no cost leaks into productSet)", () => {
  const input = toProductSetInput(WON_E2E_PRODUCTS.twoVariants);
  assert.equal(input.variants.length, 2);
  for (const variant of input.variants) {
    assert.equal("cost" in variant, false, "cost is written separately via productVariantsBulkUpdate");
  }
});
