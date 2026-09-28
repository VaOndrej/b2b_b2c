#!/usr/bin/env node
// C4 — does the function know the campaign window via shop.localTime +
//      input-query variables ($campaignStart/$campaignEnd) read from function_config?
//
// One automatic node, mode campaign_window + debugCampaign (active 10 %, started
// but not active 3 %, not started 0 %). The window is written in SHOP-LOCAL time
// (shop.ianaTimezone, America/New_York); UTC is 4 h off, so a ±1 h window only
// reads "active" if Shopify interprets it in shop time. The config is rewritten
// with metafieldsSet between reads; consecutive states always differ so a stale
// read cannot pass for a new one.
//   a  [now−1h, now+1h]          → 10 %
//   b  [now+1h, now+2h]          → 0 %
//   c  [now−1h, now−30min]       → 3 %
//   a2 [now−1h, now+1h] again    → 10 % (control before d)
//   d  config WITHOUT campaignStart/campaignEnd keys → record
//        3 % = query defaults ("1970…") used; 0 % + InvalidVariableValueError = null passed
//   e  function_config metafield deleted → record (run log status)
//
//   node apps/won-discounts/scripts/prototypes/c4-campaign-window.mjs          # dry-run
//   WON_PROTO_OUT=<dir> WON_PROTO_APP_DEV_LOG=<app-dev.log> \
//     node --env-file=apps/won-discounts/.env apps/won-discounts/scripts/prototypes/c4-campaign-window.mjs --live

import { CONFIG_KEY, CONFIG_NAMESPACE, approx, observe, runExperiment, shopLocal } from "./lib.mjs";

const PROTOTYPE = { mode: "campaign_window", debugCampaign: true };
const HOUR = 3_600_000;

const PLAN = `Plan:
 1. sweep leftover WON-PROTO nodes; read shop.ianaTimezone
 2. create automatic node "WON-PROTO C4 campaign", config {prototype:{mode:campaign_window,debugCampaign:true}, campaignStart, campaignEnd}
 3. states (metafieldsSet on the node, times computed in shop-local time right before each write):
      a  [now−1h, now+1h]      → 10 %
      b  [now+1h, now+2h]      → 0 %
      c  [now−1h, now−30min]   → 3 %
      a2 [now−1h, now+1h]      → 10 % (control)
      d  keys campaignStart/campaignEnd omitted → record (3 % = defaults, 0 % = null → function error)
      e  function_config metafield deleted (metafieldsDelete) → record run-log status
 4. finally: delete the node (and its metafields), list WON-PROTO nodes (must be 0)`;

const percentOf = (summary) => (summary ? (summary.totalDiscountPercent ?? 0) : null);

await runExperiment("c4-campaign-window", PLAN, async ({ evidence, admin, cleanup, logs, storefront, shop }) => {
  const timeZone = shop.ianaTimezone;
  const windowFor = (startOffsetMs, endOffsetMs) => {
    const at = new Date();
    return {
      campaignStart: shopLocal(new Date(at.getTime() + startOffsetMs), timeZone),
      campaignEnd: shopLocal(new Date(at.getTime() + endOffsetMs), timeZone),
      writtenAtUtc: at.toISOString(),
      shopNow: shopLocal(at, timeZone),
    };
  };
  const configWith = (window) => JSON.stringify({ prototype: PROTOTYPE, campaignStart: window.campaignStart, campaignEnd: window.campaignEnd });

  const first = windowFor(-HOUR, HOUR);
  evidence.step(`create automatic node, window a (shop ${timeZone} now ${first.shopNow})`, first);
  const node = await admin.createAutomatic({ title: "C4 campaign", configValue: configWith(first) });
  cleanup.node(node.discountId, "C4 campaign");
  evidence.data.node = node;
  evidence.data.windows = { a: first };

  await storefront.open();
  const results = {};

  const state = async ({ key, label, window, value, expectPercent, expectFn, record }) => {
    if (value !== undefined || window) {
      const written = value ?? configWith(window);
      if (key !== "a") {
        evidence.step(`metafieldsSet ${key}: ${written}`, window);
        await admin.setNodeConfig(node.discountId, written);
      }
      evidence.data.windows[key] = { ...(window ?? {}), value: written };
    }
    const observation = await observe({
      evidence, storefront,
      label,
      expectation: record ?? `≈${expectPercent} %`,
      expect: expectFn ?? ((summary) => (expectPercent === undefined ? true : approx(percentOf(summary), expectPercent))),
      timeoutMs: key === "a" ? 150_000 : 120_000,
    });
    results[key] = { label, matched: observation.matched, cartPercent: percentOf(observation.finalCart), allocations: observation.finalCart?.items[0]?.line_level_discount_allocations };
    return observation;
  };

  await state({ key: "a", label: "a: window around now", window: first, expectPercent: 10 });
  await state({ key: "b", label: "b: window starts in +1 h", window: windowFor(HOUR, 2 * HOUR), expectPercent: 0 });
  await state({ key: "c", label: "c: window −1 h … −30 min (ended)", window: windowFor(-HOUR, -HOUR / 2), expectPercent: 3 });
  await state({ key: "a2", label: "a2: window around now (control before d)", window: windowFor(-HOUR, HOUR), expectPercent: 10 });
  await state({
    key: "d",
    label: "d: config without campaignStart/campaignEnd keys",
    value: JSON.stringify({ prototype: PROTOTYPE }),
    record: "record (accepted once the cart leaves a2's 10 %): 3 % = query defaults used; 0 % = null passed → function error",
    expectFn: (summary) => !approx(percentOf(summary), 10),
  });

  evidence.step("e: metafieldsDelete function_config on the node");
  const deleted = await admin.run("metafieldsDelete", {
    metafields: [{ ownerId: node.discountId, namespace: CONFIG_NAMESPACE, key: CONFIG_KEY }],
  });
  evidence.data.eDeleted = deleted.metafieldsDelete;
  evidence.data.eNodeConfig = await admin.readNodeConfig(node.discountId);
  await state({ key: "e", label: "e: no function_config metafield", record: "record: run-log status without the metafield", expectPercent: undefined });

  if (!evidence.live) return;
  await logs.attach(evidence);

  const runsOf = (label) =>
    evidence.data.observations
      .filter((observation) => observation.label.startsWith(label))
      .flatMap((observation) => observation.functionRuns)
      .map((run) => ({
        at: run.logTimestamp,
        status: run.status,
        errorType: run.errorType,
        errorMessages: run.errorMessages,
        variables: run.inputQueryVariables,
        localTime: run.localTime,
        out: run.candidates.map((candidate) => `${candidate.message}@${candidate.percent}%`),
      }));
  evidence.data.verdictData = {
    timeZone,
    windows: evidence.data.windows,
    results: Object.fromEntries(Object.entries(results).map(([key, result]) => [key, { ...result, runs: runsOf(result.label.split(":")[0] + ":") }])),
  };
  console.log(`\nverdictData: ${JSON.stringify(evidence.data.verdictData, null, 2)}`);
});
