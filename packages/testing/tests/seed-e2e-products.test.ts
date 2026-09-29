import assert from "node:assert/strict";
import test from "node:test";

import { WON_E2E_PRODUCTS } from "../src/e2e-products.js";
import {
  isAccessError,
  matchVariant,
  parseArgs,
  planCostChanges,
  sameCost,
  summarizeCostRun,
  toProductSetInput,
  tryReadCost,
  tryWriteCost,
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

test("sameCost treats a matching amount in a different currency as a change", () => {
  assert.equal(sameCost("6.00", "USD", "6.00"), true, "same amount, same currency: unchanged");
  assert.equal(sameCost("6.00", "EUR", "6.00"), false, "same amount, foreign currency: still a change");
  assert.equal(sameCost("6.00", null, "6.00"), true, "no currency reported: fall back to amount only");
  assert.equal(sameCost(null, "USD", "6.00"), false, "no current cost at all: a change");
});

test("planCostChanges never marks a variant unchanged when its currency differs from the shop's", () => {
  const catalogProduct = { options: [], variants: [{ price: "10.00", cost: "6.00" }] };
  const foreignCurrency = planCostChanges(
    {
      variants: {
        nodes: [
          {
            id: "gid://v",
            selectedOptions: [],
            inventoryItem: { unitCost: { amount: "6.00", currencyCode: "EUR" } },
          },
        ],
      },
    },
    catalogProduct,
  );
  assert.equal(foreignCurrency[0].unchanged, false);
});

test("isAccessError classifies scope/permission errors and only those", () => {
  const accessDenied = new Error(
    'GraphQL errors: [{"message":"Access denied for inventoryItem field. Required access: `read_inventory` access scope or higher.","extensions":{"code":"ACCESS_DENIED"}}]',
  );
  assert.equal(isAccessError(accessDenied), true);
  assert.equal(isAccessError(new Error("Forbidden by app scope")), true);
  assert.equal(isAccessError(new Error("Unauthorized")), true);
  assert.equal(isAccessError(new Error("not approved to access this data")), true);

  assert.equal(isAccessError(new Error("HTTP 500 from Admin API.")), false);
  assert.equal(isAccessError(new Error("ECONNRESET")), false);
  assert.equal(
    isAccessError(new Error('productVariantsBulkUpdate: [{"field":["cost"],"message":"can\'t be blank"}]')),
    false,
  );
});

test("tryReadCost skips on an access error, rethrows anything else", async () => {
  const accessDenied = () => {
    throw new Error("Access denied: requires read_inventory access scope");
  };
  const skipped = await tryReadCost(accessDenied, "won-e2e-simple-a");
  assert.equal(skipped.skipped, true);
  assert.match(skipped.message, /reading inventoryItem\.unitCost failed/);

  const transportFailure = () => {
    throw new Error("fetch failed");
  };
  await assert.rejects(() => tryReadCost(transportFailure, "won-e2e-simple-a"), /fetch failed/);

  const ok = async () => ({ productByIdentifier: { id: "gid://p", variants: { nodes: [] } } });
  const result = await tryReadCost(ok, "won-e2e-simple-a");
  assert.equal(result.skipped, false);
  assert.equal(result.product.id, "gid://p");
});

test("tryWriteCost skips on an access error, rethrows a transport error, throws a real userError", async () => {
  const toUpdate = [{ variantId: "gid://v", newCost: "6.00" }];

  const accessDenied = () => {
    throw new Error("Forbidden: missing write_products access scope");
  };
  const skipped = await tryWriteCost(accessDenied, "gid://product", toUpdate);
  assert.equal(skipped.skipped, true);
  assert.match(skipped.message, /writing inventoryItem\.cost failed/);

  const transportFailure = () => {
    throw new Error("socket hang up");
  };
  await assert.rejects(() => tryWriteCost(transportFailure, "gid://product", toUpdate), /socket hang up/);

  const withUserError = async () => ({
    productVariantsBulkUpdate: { userErrors: [{ field: ["cost"], message: "can't be blank" }] },
  });
  await assert.rejects(
    () => tryWriteCost(withUserError, "gid://product", toUpdate),
    /productVariantsBulkUpdate/,
  );

  const ok = async () => ({ productVariantsBulkUpdate: { userErrors: [] } });
  const success = await tryWriteCost(ok, "gid://product", toUpdate);
  assert.equal(success.skipped, false);
});

test("summarizeCostRun reports variants and calls, matching the real dev-store run (1 + 4 = 5 across 2 calls)", () => {
  assert.deepEqual(summarizeCostRun([]), { variants: 0, calls: 0 });
  assert.deepEqual(summarizeCostRun([1, 4]), { variants: 5, calls: 2 });
  assert.deepEqual(summarizeCostRun([1, 4, 0]), { variants: 5, calls: 2 });
});
