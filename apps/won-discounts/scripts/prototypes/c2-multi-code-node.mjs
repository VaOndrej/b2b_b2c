#!/usr/bin/env node
// C2 — one code node with several redeem codes vs several code nodes.
//
// Part 1: ONE code node (echo_codes) with WONPROTO1 + WONPROTO2 (second code via
//         discountRedeemCodeBulkAdd). Each code alone, then both together:
//         `discount_codes[].applicable` + which code the function saw as
//         triggeringDiscountCode (run logs).
// Part 2: TWO code nodes (one code each, echo_codes → 1 % on the FIRST line)
//         entered together, 1-line cart. Both target the same line.
// Part 3: the same two nodes on DIFFERENT lines: node WONPROTO2 switched to
//         product_metafield (5 % on won-e2e-simple-b only, via its product
//         metafield), cart with simple-a as lines[0] (echo target) + simple-b. Separates "only one Won code
//         per cart" from Shopify's "one product discount per line" (non-Plus).
//
//   node apps/won-discounts/scripts/prototypes/c2-multi-code-node.mjs          # dry-run
//   WON_PROTO_OUT=<dir> WON_PROTO_APP_DEV_LOG=<app-dev.log> \
//     node --env-file=apps/won-discounts/.env apps/won-discounts/scripts/prototypes/c2-multi-code-node.mjs --live

import {
  CONFIG_NAMESPACE,
  PRODUCT_KEY,
  approx,
  functionConfig,
  observe,
  runExperiment,
  sleep,
} from "./lib.mjs";

const SECOND_PRODUCT = "won-e2e-simple-b";
const PLAN = `Plan:
 1. sweep leftover WON-PROTO nodes; read ${SECOND_PRODUCT} ($app:won_discounts.product must be restored/removed at the end)
 Part 1 — one node, two codes
 2. create code node "WON-PROTO C2 one node" code WONPROTO1, config {prototype:{mode:echo_codes}}
 3. discountRedeemCodeBulkAdd WONPROTO2 on it; poll discountRedeemCodeBulkCreation until done; read codesCount
 4. storefront (1× won-e2e-simple-a): a. WONPROTO1  b. WONPROTO2  c. WONPROTO1,WONPROTO2
    expected a/b: code applicable, 1 % on the line; c: record applicable flags + triggering codes (logs)
 5. delete the node
 Part 2 — two nodes, same line
 6. create code nodes "WON-PROTO C2 node 1" (WONPROTO1) and "WON-PROTO C2 node 2" (WONPROTO2), echo_codes
 7. storefront: d. WONPROTO1  (activation check)  e. WONPROTO1,WONPROTO2 → record
 Part 3 — two nodes, different lines
 8. metafieldsSet node 2 config → {prototype:{mode:product_metafield}}; metafieldsSet ${SECOND_PRODUCT} product {percent:5}
 9. storefront cart, add order [${SECOND_PRODUCT}, won-e2e-simple-a] (newest line = lines[0] = simple-a): f. WONPROTO1,WONPROTO2
    expected: WONPROTO1 1 % on line 0 AND WONPROTO2 5 % on the ${SECOND_PRODUCT} line, both applicable
    (if the function's lines[0] turns out to be ${SECOND_PRODUCT}, repeat with the reverse add order)
 10. finally: delete nodes, delete/restore the product metafield, list WON-PROTO nodes (must be 0)`;

const codeState = (summary, code) => summary.discount_codes.find((entry) => entry.code.toUpperCase() === code)?.applicable ?? null;
const allocationsByTitle = (summary) =>
  summary.items.flatMap((item, index) =>
    item.line_level_discount_allocations.map((allocation) => ({ line: index, variant: item.variant_id, title: allocation.title, percent: allocation.percentOfLine })),
  );

await runExperiment("c2-multi-code-node", PLAN, async ({ evidence, admin, cleanup, logs, storefront }) => {
  // --- product B metafield: remember the original to restore it -----------------
  const productB = await admin.product(SECOND_PRODUCT);
  evidence.data.productBBefore = { id: productB.id, metafield: productB.metafield };

  // --- Part 1 -------------------------------------------------------------------
  evidence.step("Part 1: create one code node WONPROTO1 (echo_codes)");
  const one = await admin.createCode({ title: "C2 one node", code: "WONPROTO1", config: functionConfig({ mode: "echo_codes" }) });
  cleanup.node(one.discountId, "C2 one node");

  evidence.step("Part 1: discountRedeemCodeBulkAdd WONPROTO2");
  const bulk = await admin.run("redeemBulkAdd", { discountId: one.discountId, codes: [{ code: "WONPROTO2" }] });
  evidence.data.bulkAdd = bulk.discountRedeemCodeBulkAdd;
  if (bulk.discountRedeemCodeBulkAdd.userErrors.length) throw new Error(`bulk add: ${JSON.stringify(bulk.discountRedeemCodeBulkAdd.userErrors)}`);
  let status = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    status = (await admin.run("redeemBulkStatus", { id: bulk.discountRedeemCodeBulkAdd.bulkCreation.id })).discountRedeemCodeBulkCreation;
    if (status.done) break;
    await sleep(3000);
  }
  evidence.data.bulkStatus = status;
  evidence.data.oneNodeAfterBulk = await admin.readNodeConfig(one.discountId);

  await storefront.open();
  const a = await observe({
    evidence, storefront,
    label: "a: one node, WONPROTO1",
    codes: ["WONPROTO1"],
    expectation: "WONPROTO1 applicable, ≈1 % on the line",
    expect: (summary) => codeState(summary, "WONPROTO1") === true && approx(summary.totalDiscountPercent, 1, 0.2),
    timeoutMs: 150_000,
  });
  const b = await observe({
    evidence, storefront,
    label: "b: one node, WONPROTO2 (bulk-added code)",
    codes: ["WONPROTO2"],
    expectation: "WONPROTO2 applicable, ≈1 % on the line",
    expect: (summary) => codeState(summary, "WONPROTO2") === true && approx(summary.totalDiscountPercent, 1, 0.2),
  });
  const c = await observe({
    evidence, storefront,
    label: "c: one node, WONPROTO1 + WONPROTO2",
    codes: ["WONPROTO1", "WONPROTO2"],
    expectation: "record: applicable flags of both codes; run logs show which code triggered",
    expect: () => true,
  });

  evidence.step("Part 1 done: delete the one-node discount");
  const deletedOne = await admin.deleteNode(one.discountId);
  evidence.data.part1Deleted = deletedOne;
  cleanup.tasks = cleanup.tasks.filter((task) => task.id !== one.discountId);
  await sleep(5000);

  // --- Part 2 -------------------------------------------------------------------
  evidence.step("Part 2: two code nodes, one code each (echo_codes)");
  const n1 = await admin.createCode({ title: "C2 node 1", code: "WONPROTO1", config: functionConfig({ mode: "echo_codes" }) });
  cleanup.node(n1.discountId, "C2 node 1");
  const n2 = await admin.createCode({ title: "C2 node 2", code: "WONPROTO2", config: functionConfig({ mode: "echo_codes" }) });
  cleanup.node(n2.discountId, "C2 node 2");
  evidence.data.part2Nodes = { n1, n2 };

  const d = await observe({
    evidence, storefront,
    label: "d: two nodes, WONPROTO1 (activation check)",
    codes: ["WONPROTO1"],
    expectation: "WONPROTO1 applicable, ≈1 %",
    expect: (summary) => codeState(summary, "WONPROTO1") === true && approx(summary.totalDiscountPercent, 1, 0.2),
    timeoutMs: 150_000,
  });
  const e = await observe({
    evidence, storefront,
    label: "e: two nodes, WONPROTO1 + WONPROTO2, same line",
    codes: ["WONPROTO1", "WONPROTO2"],
    expectation: "record: both nodes emit 1 % on line 0; how many codes end up applicable",
    expect: () => true,
  });

  // --- Part 3 -------------------------------------------------------------------
  evidence.step("Part 3: node 2 → product_metafield; product B metafield {percent:5}");
  const n2Config = JSON.stringify(functionConfig({ mode: "product_metafield" }));
  evidence.data.part3NodeConfig = await admin.setNodeConfig(n2.discountId, n2Config);
  cleanup.metafield(
    { ownerId: productB.id, namespace: CONFIG_NAMESPACE, key: PRODUCT_KEY },
    productB.metafield ? { type: productB.metafield.type, value: productB.metafield.value } : null,
  );
  evidence.data.part3ProductMetafield = await admin.setProductMetafield(productB.id, JSON.stringify({ percent: 5 }));

  const variantB = await storefront.variantOf(SECOND_PRODUCT);
  evidence.data.variantB = variantB;
  const variantA = storefront.variant;

  const part3 = async (label, order) =>
    observe({
      evidence, storefront,
      label,
      codes: ["WONPROTO1", "WONPROTO2"],
      variants: order.map((variant) => variant.id),
      expectation: "WONPROTO1 1 % on the simple-a line AND WONPROTO2 5 % on the simple-b line, both applicable",
      expect: (summary) => codeState(summary, "WONPROTO1") === true && codeState(summary, "WONPROTO2") === true,
      timeoutMs: 120_000,
    });

  // Shopify lists cart lines newest first (verified in the first C2 run: add order
  // [a, b] → function lines[0] = b), so add b first to make simple-a lines[0].
  const f = await part3("f: two nodes on different lines, add order [simple-b, simple-a] → lines[0] = simple-a", [variantB, variantA]);
  let g = null;
  if (evidence.live) {
    await logs.attach(evidence, 8000);
    const finalEchoRuns = f.functionRuns.filter(
      (run) => run.triggeringDiscountCode === "WONPROTO1" && run.candidates.length && (run.productMetafields ?? []).length === 2,
    );
    const echoRun = finalEchoRuns[finalEchoRuns.length - 1];
    const target = echoRun?.candidates[0]?.lines?.[0];
    const targetVariant = echoRun?.productMetafields?.find((line) => line.line === target)?.variant ?? null;
    evidence.data.part3EchoTargetVariant = targetVariant;
    if (!f.matched && targetVariant && targetVariant.endsWith(`/${variantB.id}`)) {
      g = await part3("g: reverse add order [simple-a, simple-b]", [variantA, variantB]);
    }
  }

  if (!evidence.live) return;
  await logs.attach(evidence);

  const runsOf = (observation) =>
    observation.functionRuns.map((run) => ({
      at: run.logTimestamp,
      triggering: run.triggeringDiscountCode,
      entered: (run.enteredDiscountCodes ?? []).map((entry) => entry.code),
      mode: run.configMode,
      out: run.candidates.map((candidate) => `${candidate.message}@${candidate.percent}%→${candidate.lines.join(",")}`),
      lines: run.productMetafields?.map((line) => `${line.line}=${line.variant}${line.wonProduct ? ` ${JSON.stringify(line.wonProduct)}` : ""}`),
    }));
  const summaryOf = (observation) =>
    observation && {
      matched: observation.matched,
      codes: observation.finalCart.discount_codes,
      totalDiscountPercent: observation.finalCart.totalDiscountPercent,
      allocations: allocationsByTitle(observation.finalCart),
      runs: runsOf(observation),
    };
  evidence.data.verdictData = {
    bulk: { importedCount: evidence.data.bulkStatus?.importedCount, failedCount: evidence.data.bulkStatus?.failedCount, codesCount: evidence.data.oneNodeAfterBulk?.discount?.codesCount },
    part1: { a: summaryOf(a), b: summaryOf(b), c: summaryOf(c) },
    part2: { d: summaryOf(d), e: summaryOf(e) },
    part3: { f: summaryOf(f), g: summaryOf(g), echoTargetVariant: evidence.data.part3EchoTargetVariant },
  };
  console.log(`\nverdictData: ${JSON.stringify(evidence.data.verdictData, null, 2)}`);
});
