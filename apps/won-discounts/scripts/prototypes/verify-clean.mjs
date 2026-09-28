#!/usr/bin/env node
// Read-only check after the C1–C4 prototypes: no WON-PROTO discount nodes and
// no $app:won_discounts.product metafield left on the test products.
//
//   node apps/won-discounts/scripts/prototypes/verify-clean.mjs          # dry-run (prints the queries)
//   WON_PROTO_OUT=<dir> node apps/won-discounts/scripts/prototypes/verify-clean.mjs --live

import { Admin, Evidence, PRODUCT_HANDLE, now, parseArgs } from "./lib.mjs";

const PRODUCTS = [PRODUCT_HANDLE, "won-e2e-simple-b"];
const { live } = parseArgs();
const evidence = new Evidence("cleanup-final", live);
const admin = new Admin(evidence, live);

const protoNodes = await admin.listProtoNodes();
const allNodes = live ? (await admin.run("discountNodes")).discountNodes.nodes.map((node) => ({ id: node.id, title: node.discount?.title, status: node.discount?.status })) : [];
const products = [];
for (const handle of PRODUCTS) {
  const product = await admin.product(handle);
  products.push({ handle, id: product?.id, wonProductMetafield: product?.metafield ?? null });
}
evidence.data.result = {
  checkedAt: now(),
  protoNodes,
  allDiscountNodes: allNodes,
  products,
  clean: protoNodes.length === 0 && products.every((product) => product.wonProductMetafield === null),
};
console.log(JSON.stringify(evidence.data.result, null, 2));
await evidence.save();
if (live) console.log(`\nEvidence: ${evidence.file}`);
