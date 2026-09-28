#!/usr/bin/env node
// C7 (MVP 1 Task 0) — config transport: does the discount function read an
// app-owned SHOP metafield `$app:won_discounts` / `function_config` (owner =
// shop GID, written with metafieldsSet) live, shared by every node, while each
// node's own function_config carries only the input-query variables?
//
// Two automatic nodes (tags A and B), mode shop_config. Each node's own
// function_config = {prototype:{mode:"shop_config", tag}, campaignStart, campaignEnd}
// (C4: the variables must be there). The percent lives ONLY in the shop
// metafield. Every state has its own percent, so a stale read can never pass
// for a new one; the nodes are never written after creation:
//   s9      shop {percent:9}                          → 9 %
//   s13     shop {percent:13}, nodes untouched         → 13 % (one write, both nodes)
//   s10000  shop {percent:12} padded to 10 000 B       → record (12 % = within the function-input limit)
//   s10100  shop {percent:15} padded to 10 100 B       → record (0 % + success = null; 0 % + failure = error)
//   s11     shop {percent:11} (control)                → 11 %
//   del     shop metafield deleted (metafieldsDelete)  → record (expected 0 %, shop.metafield null)
//
//   node apps/won-discounts/scripts/prototypes/c7-shop-metafield.mjs              # dry-run
//   WON_PROTO_OUT=<dir> WON_PROTO_APP_DEV_LOG=<app-dev.log> \
//     node --env-file=apps/won-discounts/.env apps/won-discounts/scripts/prototypes/c7-shop-metafield.mjs --live --confirm-store-wide
//   (--confirm-store-wide: its AUTOMATIC nodes discount every cart on the shared dev
//    store while they exist — run only when no other app's E2E is running, audit P3-3)
//
// Needs the function with the shop_config mode + shop.metafield in its input
// query running as the dev preview (`shopify app dev`).

import {
  CONFIG_KEY,
  CONFIG_NAMESPACE,
  approx,
  bytes,
  functionConfig,
  observe,
  paddedConfigValue,
  runExperiment,
} from "./lib.mjs";

const TAGS = ["A", "B"];

const PLAN = `Plan:
 1. sweep leftover WON-PROTO nodes; read shop { id, metafield($app:won_discounts/function_config) } (must be absent; restored if not)
 2. metafieldsSet shop $app:won_discounts.function_config = {"percent":9}
 3. create automatic nodes "WON-PROTO C7 shop A" / "… B", node function_config = {prototype:{mode:"shop_config",tag}, campaignStart, campaignEnd}
 4. states (metafieldsSet on the SHOP only; fresh carts until 2 consecutive reads match):
      s9      {percent:9}                      → 9 %
      s13     {percent:13}                     → 13 % (node metafields re-read: unchanged)
      s10000  {percent:12} padded to 10 000 B  → record
      s10100  {percent:15} padded to 10 100 B  → record (0 % = over the function-input limit)
      s11     {percent:11}                     → 11 % (control)
      del     metafieldsDelete shop metafield  → record
 5. finally: delete both nodes, delete (or restore) the shop metafield, sweep, verify 0 WON-PROTO nodes + shop metafield absent`;

const percentOf = (summary) => (summary ? (summary.totalDiscountPercent ?? 0) : null); // null in dry-run
const shopValue = (percent) => JSON.stringify({ percent });
const paddedShopValue = (percent, targetBytes) => paddedConfigValue({ percent }, targetBytes);

await runExperiment("c7-shop-metafield", PLAN, async ({ evidence, admin, cleanup, logs, storefront }) => {
  const before = await admin.shopConfig();
  evidence.data.shopMetafieldBefore = { shopId: before.shopId, metafield: before.metafield, storedBytes: before.storedBytes };
  const identifier = { ownerId: before.shopId, namespace: CONFIG_NAMESPACE, key: CONFIG_KEY };
  // Registered before the first write: a crash after it still deletes (or restores) the shop metafield.
  cleanup.metafield(identifier, before.metafield ? { type: before.metafield.type, value: before.metafield.value } : null);
  cleanup.check("shopMetafield", async () => {
    const after = await admin.shopConfig({ cleanup: true });
    const expected = before.metafield?.value ?? null;
    const actual = after.metafield?.value ?? null;
    return { clean: actual === expected, expected: expected === null ? "absent" : "restored", metafield: after.metafield ? { id: after.metafield.id, storedBytes: after.storedBytes } : null };
  });

  const results = {};
  const shopReads = {};
  const writeShop = async (key, value) => {
    evidence.step(`${key}: metafieldsSet shop ${CONFIG_NAMESPACE}.${CONFIG_KEY} = ${bytes(value)} B`, { value });
    const written = await admin.setShopConfig(value);
    const read = await admin.shopConfig();
    shopReads[key] = { sentBytes: bytes(value), storedBytes: read.storedBytes, updatedAt: read.metafield?.updatedAt ?? null, metafieldId: read.metafield?.id ?? null, written };
  };

  await writeShop("s9", shopValue(9));

  const nodes = [];
  for (const tag of TAGS) {
    evidence.step(`create automatic node ${tag} (shop_config, variables only)`);
    const node = await admin.createAutomatic({ title: `C7 shop ${tag}`, config: functionConfig({ mode: "shop_config", tag }) });
    cleanup.node(node.discountId, `C7 shop ${tag}`);
    nodes.push({ tag, ...node });
  }
  evidence.data.nodes = nodes;
  const readNodes = async () => Promise.all(nodes.map(async (node) => ({ tag: node.tag, ...(await admin.readNodeConfig(node.discountId)) })));
  const nodeReads = { afterCreate: await readNodes() };

  await storefront.open();

  const state = async ({ key, label, expectPercent, expectFn, record, timeoutMs = 120_000 }) => {
    const observation = await observe({
      evidence, storefront,
      label,
      expectation: record ?? `≈${expectPercent} %`,
      expect: expectFn ?? ((summary) => approx(percentOf(summary), expectPercent)),
      timeoutMs,
    });
    results[key] = {
      label,
      matched: observation.matched,
      attempts: observation.attempts,
      elapsedMs: observation.elapsedMs,
      cartPercent: percentOf(observation.finalCart),
      allocations: observation.finalCart?.items[0]?.line_level_discount_allocations,
    };
    return observation;
  };

  await state({ key: "s9", label: "s9: shop {percent:9}", expectPercent: 9, timeoutMs: 150_000 });

  await writeShop("s13", shopValue(13));
  await state({ key: "s13", label: "s13: shop {percent:13}, nodes untouched", expectPercent: 13 });
  nodeReads.afterS13 = await readNodes();

  await writeShop("s10000", paddedShopValue(12, 10_000));
  await state({
    key: "s10000",
    label: "s10000: shop {percent:12} padded to 10 000 B",
    record: "record (accepted once the cart leaves 13 %): 12 % = delivered to the function; 0 % = not delivered",
    expectFn: (summary) => !approx(percentOf(summary), 13),
  });

  const previous = results.s10000.cartPercent;
  await writeShop("s10100", paddedShopValue(15, 10_100));
  await state({
    key: "s10100",
    label: "s10100: shop {percent:15} padded to 10 100 B",
    record: "record (accepted once the cart leaves the 10 000 B state): 15 % = delivered; 0 % = over the function-input limit (run log tells null vs error)",
    expectFn: (summary) => (previous !== null && !approx(previous, 0) ? !approx(percentOf(summary), previous) : true),
  });

  await writeShop("s11", shopValue(11));
  await state({ key: "s11", label: "s11: shop {percent:11} (control)", expectPercent: 11 });

  evidence.step("del: metafieldsDelete the shop metafield");
  const deleted = await admin.run("metafieldsDelete", { metafields: [identifier] });
  evidence.data.delResult = deleted.metafieldsDelete;
  const afterDelete = await admin.shopConfig();
  shopReads.del = { metafield: afterDelete.metafield };
  await state({
    key: "del",
    label: "del: shop metafield deleted",
    record: "record (accepted once the cart leaves 11 %): expected 0 %, run success with shop.metafield null",
    expectFn: (summary) => !approx(percentOf(summary), 11),
  });
  nodeReads.atEnd = await readNodes();

  evidence.data.shopReads = shopReads;
  evidence.data.nodeReads = nodeReads;
  const nodeSignature = (reads) => reads.map((read) => `${read.tag}:${read.metafieldId}:${read.updatedAt}:${read.storedBytes}`).join(" ");
  evidence.data.nodesUntouched = {
    afterCreate: nodeSignature(nodeReads.afterCreate),
    afterS13: nodeSignature(nodeReads.afterS13),
    atEnd: nodeSignature(nodeReads.atEnd),
    unchanged: nodeSignature(nodeReads.afterCreate) === nodeSignature(nodeReads.afterS13) && nodeSignature(nodeReads.afterS13) === nodeSignature(nodeReads.atEnd),
  };

  if (!evidence.live) return;
  await logs.attach(evidence);

  const runsOf = (label) =>
    evidence.data.observations
      .filter((observation) => observation.label === label)
      .flatMap((observation) => observation.functionRuns)
      .map((run) => ({
        at: run.logTimestamp,
        status: run.status,
        tag: run.configTag,
        errorType: run.errorType,
        errorMessages: run.errorMessages,
        shopMetafield: run.shopMetafield,
        variables: run.inputQueryVariables,
        out: run.candidates.map((candidate) => `${candidate.message}@${candidate.percent}%`),
      }));
  evidence.data.verdictData = {
    shopId: before.shopId,
    shopMetafieldBefore: before.metafield,
    shopReads,
    nodesUntouched: evidence.data.nodesUntouched,
    results: Object.fromEntries(Object.entries(results).map(([key, result]) => [key, { ...result, runs: runsOf(result.label) }])),
  };
  console.log(`\nverdictData: ${JSON.stringify(evidence.data.verdictData, null, 2)}`);
});
