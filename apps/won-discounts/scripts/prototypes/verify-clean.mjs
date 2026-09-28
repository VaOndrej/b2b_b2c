#!/usr/bin/env node
// Read-only check after the C1–C4 / C7 prototypes: no WON-PROTO app discount of this
// app's function on ANY page of discountNodes, no $app:won_discounts.product
// metafield on ANY won-e2e-* product, and (C7) no $app:won_discounts.function_config
// metafield on the shop (the app itself does not write one yet). WON-PROTO nodes that are not ours (e.g.
// a native code a prototype made) are listed separately — the sweep never
// deletes them, so they need a human look.
//
//   node apps/won-discounts/scripts/prototypes/verify-clean.mjs          # dry-run (prints the queries)
//   WON_PROTO_OUT=<dir> node apps/won-discounts/scripts/prototypes/verify-clean.mjs --live

import { Admin, Evidence, now, parseArgs } from "./lib.mjs";

const { live } = parseArgs();
const evidence = new Evidence("cleanup-final", live);
const admin = new Admin(evidence, live);

await admin.functionInfo();
const { ours, foreign } = await admin.listProtoNodes();
const allNodes = live ? await admin.listDiscountNodes() : [];
const products = await admin.e2eProductMetafields();
const shop = await admin.shopConfig();
evidence.data.result = {
  checkedAt: now(),
  protoNodes: ours,
  foreignProtoNodes: foreign,
  allDiscountNodes: allNodes.map((node) => ({ id: node.id, title: node.title, status: node.status, type: node.type })),
  products: products.map((product) => ({ handle: product.handle, id: product.id, wonProductMetafield: product.metafield })),
  shop: { id: shop.shopId, functionConfigMetafield: shop.metafield },
  clean:
    ours.length === 0 &&
    foreign.length === 0 &&
    products.every((product) => product.metafield === null) &&
    shop.metafield === null,
};
console.log(JSON.stringify(evidence.data.result, null, 2));
await evidence.save();
if (live) console.log(`\nEvidence: ${evidence.file}`);
