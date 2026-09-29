#!/usr/bin/env node
// F0 — live platform facts (native Shopify discounts only, no Won function).
//
// Fact 1 (minimum scope): native "amount off products" 10% on won-e2e-simple-a
//   only, minimumRequirement subtotal an amount the WHOLE cart (A+B) exceeds
//   but A alone does not. Cart = A+B → does the 10% line allocation appear?
// Fact 2 (combining): native PRODUCT discount A (10% on simple-a) +
//   native ORDER discount B (5% on items.all=true, which Shopify classifies
//   as discountClasses=[ORDER]) with combinesWith flags flipped two ways.
//
//   node apps/won-discounts/scripts/prototypes/f0-native-facts.mjs           # dry-run (prints plan only)
//   node --env-file=apps/won-discounts/.env \
//     apps/won-discounts/scripts/prototypes/f0-native-facts.mjs --live
//
// Safety: every discount created here is titled "WON-PROTO-F0 …" and deleted
// in `finally` (best effort, every id attempted even if one delete fails).
// Never touches the real "Won Discounts" node or its shop function_config.

import { Evidence, Storefront, describeCart, now, parseArgs, shopifyExecute, sleep } from "./lib.mjs";

const { live } = parseArgs();
const evidence = new Evidence("f0-native-facts", live);
const TITLE_PREFIX = "WON-PROTO-F0";
const SIMPLE_A_HANDLE = "won-e2e-simple-a";
const SIMPLE_B_HANDLE = "won-e2e-simple-b";

const AUTO_CREATE = `mutation F0AutoCreate($d: DiscountAutomaticBasicInput!) {
  discountAutomaticBasicCreate(automaticBasicDiscount: $d) {
    automaticDiscountNode {
      id
      automaticDiscount { ... on DiscountAutomaticBasic { title discountClasses minimumRequirement { ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } } } } }
    }
    userErrors { field message code }
  }
}`;
const AUTO_DELETE = `mutation F0AutoDelete($id: ID!) {
  discountAutomaticDelete(id: $id) { deletedAutomaticDiscountId userErrors { field message } }
}`;

const created = []; // ids to delete in finally, in reverse order

async function createAuto(label, variables) {
  const data = await shopifyExecute(`create-${label}`, AUTO_CREATE, { d: variables });
  const result = data.discountAutomaticBasicCreate;
  evidence.data.graphql = evidence.data.graphql ?? [];
  evidence.data.graphql.push({ at: now(), label, variables, response: result });
  if (result.userErrors.length) throw new Error(`${label}: ${JSON.stringify(result.userErrors)}`);
  const node = result.automaticDiscountNode;
  created.push({ id: node.id, label });
  console.log(`  created ${label}: ${node.id} discountClasses=${JSON.stringify(node.automaticDiscount.discountClasses)}`);
  return node;
}

async function deleteAuto(id, label) {
  try {
    const data = await shopifyExecute(`delete-${label}`, AUTO_DELETE, { id });
    evidence.data.cleanup = evidence.data.cleanup ?? { actions: [] };
    evidence.data.cleanup.actions.push({ at: now(), label, id, result: data.discountAutomaticDelete });
    console.log(`  deleted ${label}: ${id}`);
  } catch (error) {
    evidence.data.cleanup = evidence.data.cleanup ?? { actions: [] };
    evidence.data.cleanup.actions.push({ at: now(), label, id, failed: String(error.message).slice(0, 500) });
    console.error(`  ✖ delete ${label} (${id}) failed: ${error.message}`);
  }
}

async function deleteAllCreated() {
  for (const { id, label } of [...created].reverse()) await deleteAuto(id, label);
}

console.log(`# f0-native-facts — ${live ? "LIVE" : "DRY-RUN"}`);
evidence.data.plan = "Fact 1: minimum-scope (whole cart vs entitled items). Fact 2: combining (mutual combinesWith agreement), two directions.";

if (!live) {
  console.log("dry-run: would create native PRODUCT + ORDER automatic discounts, read carts via Storefront, then delete everything. Pass --live to run.");
  process.exit(0);
}

const storefront = new Storefront(evidence, true);
let failed = null;
try {
  await storefront.open(); // unlocks password page, resolves variant of simple-a
  const variantA = storefront.variant;
  const variantB = await storefront.variantOf(SIMPLE_B_HANDLE);
  evidence.data.variants = { a: variantA, b: variantB };
  console.log(`variants: A=${JSON.stringify(variantA)} B=${JSON.stringify(variantB)}`);

  // ---------------------------------------------------------------------
  // FACT 1: minimum scope
  // ---------------------------------------------------------------------
  console.log("\n== FACT 1: minimum purchase scope ==");
  const priceA = Number(variantA.price) / 100 || Number(variantA.price); // /products/*.js price is in cents
  const priceB = Number(variantB.price) / 100 || Number(variantB.price);
  // /products/*.js prices are in the shop's smallest currency unit (cents); whole-cart A+B must exceed the
  // minimum, A alone must not. Using $15.00 with A=$10.00, B=$12.00 (whole cart $22.00) is unambiguous.
  const minAmount = "15.00";
  const d1 = await createAuto("fact1-min-scope", {
    title: `${TITLE_PREFIX} fact1 min-scope`,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: minAmount } },
    customerGets: {
      value: { percentage: 0.1 },
      items: { products: { productVariantsToAdd: [`gid://shopify/ProductVariant/${String(variantA.id).replace(/\D/g, "")}`] } },
    },
    combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true },
  });

  await sleep(2000);
  const cartAB = await storefront.freshCart([], [variantA.id, variantB.id]);
  console.log(`  cart A+B: ${describeCart(cartAB.summary)}`);
  evidence.data.fact1 = {
    minAmount,
    priceA: variantA.price,
    priceB: variantB.price,
    cartAB: cartAB.summary,
    lineAAllocations: cartAB.summary.items[0]?.line_level_discount_allocations ?? [],
  };
  const appliedOnWholeCart = (cartAB.summary.items[0]?.line_level_discount_allocations ?? []).length > 0;
  evidence.data.fact1.verdict = appliedOnWholeCart
    ? "APPLIES: whole-cart subtotal (A+B) counted toward the minimum — A's own line ($<min) still got the discount"
    : "NOT APPLIED: minimum was evaluated against entitled items only (A alone), so the discount did not fire even though the whole cart exceeds it";
  console.log(`  verdict: ${evidence.data.fact1.verdict}`);
  await deleteAuto(d1.id, "fact1-min-scope");
  created.splice(created.findIndex((c) => c.id === d1.id), 1);

  // ---------------------------------------------------------------------
  // FACT 2: combining (two directions)
  // ---------------------------------------------------------------------
  console.log("\n== FACT 2a: A(orderDiscounts:false) + B(productDiscounts:true) ==");
  const a1 = await createAuto("fact2a-A", {
    title: `${TITLE_PREFIX} fact2a A 10pct-product`,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    customerGets: {
      value: { percentage: 0.1 },
      items: { products: { productVariantsToAdd: [`gid://shopify/ProductVariant/${String(variantA.id).replace(/\D/g, "")}`] } },
    },
    combinesWith: { orderDiscounts: false, productDiscounts: true, shippingDiscounts: true },
  });
  const b1 = await createAuto("fact2a-B", {
    title: `${TITLE_PREFIX} fact2a B 5pct-order`,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    customerGets: { value: { percentage: 0.05 }, items: { all: true } },
    combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true },
  });
  await sleep(2000);
  const cart2a = await storefront.freshCart([], [variantA.id, variantB.id]);
  console.log(`  cart: ${describeCart(cart2a.summary)}`);
  evidence.data.fact2a = { cart: cart2a.summary };
  await deleteAuto(a1.id, "fact2a-A");
  await deleteAuto(b1.id, "fact2a-B");
  created.splice(created.findIndex((c) => c.id === a1.id), 1);
  created.splice(created.findIndex((c) => c.id === b1.id), 1);

  console.log("\n== FACT 2b: A(orderDiscounts:true) + B(productDiscounts:false) ==");
  const a2 = await createAuto("fact2b-A", {
    title: `${TITLE_PREFIX} fact2b A 10pct-product`,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    customerGets: {
      value: { percentage: 0.1 },
      items: { products: { productVariantsToAdd: [`gid://shopify/ProductVariant/${String(variantA.id).replace(/\D/g, "")}`] } },
    },
    combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true },
  });
  const b2 = await createAuto("fact2b-B", {
    title: `${TITLE_PREFIX} fact2b B 5pct-order`,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    customerGets: { value: { percentage: 0.05 }, items: { all: true } },
    combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true },
  });
  await sleep(2000);
  const cart2b = await storefront.freshCart([], [variantA.id, variantB.id]);
  console.log(`  cart: ${describeCart(cart2b.summary)}`);
  evidence.data.fact2b = { cart: cart2b.summary };
  await deleteAuto(a2.id, "fact2b-A");
  await deleteAuto(b2.id, "fact2b-B");
  created.splice(created.findIndex((c) => c.id === a2.id), 1);
  created.splice(created.findIndex((c) => c.id === b2.id), 1);

  const orderAllocation = (summary) => summary.cart_level_discount_applications;
  evidence.data.fact2 = {
    a_disallows_order_b_allows_product: {
      lineAAllocations: cart2a.summary.items[0]?.line_level_discount_allocations ?? [],
      orderAllocations: orderAllocation(cart2a.summary),
      stacked: (orderAllocation(cart2a.summary).length > 0) && ((cart2a.summary.items[0]?.line_level_discount_allocations ?? []).length > 0),
    },
    a_allows_order_b_disallows_product: {
      lineAAllocations: cart2b.summary.items[0]?.line_level_discount_allocations ?? [],
      orderAllocations: orderAllocation(cart2b.summary),
      stacked: (orderAllocation(cart2b.summary).length > 0) && ((cart2b.summary.items[0]?.line_level_discount_allocations ?? []).length > 0),
    },
  };
  console.log(`\nfact2 verdict: ${JSON.stringify(evidence.data.fact2, null, 2)}`);
} catch (error) {
  failed = error;
  evidence.data.error = String(error.message).slice(0, 2000);
  console.error(`\n✖ ${error.message}`);
} finally {
  await storefront.close().catch(() => {});
  await deleteAllCreated();
  evidence.data.finishedAt = now();
  await evidence.save();
  console.log(`\nEvidence: ${evidence.file}`);
}
process.exitCode = failed ? 1 : 0;
