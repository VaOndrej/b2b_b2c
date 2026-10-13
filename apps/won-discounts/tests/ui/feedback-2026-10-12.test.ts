import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig } from "@won/core/discounts/config";

import { tiersSetsStatus } from "../../app/components/model/module-status.ts";
import type { SyncView } from "../../app/components/model/types.ts";
import { tiersOverviewOf } from "../../app/lib/integration/tiers.server.ts";

// Feedback of 12 Oct 2026 (Ondřej, four points on the dev shop).

const OK: SyncView = { state: "ok", at: "2026-10-12T10:00:00.000Z" } as SyncView;

test("1: an exception that takes a product OUT of the quantity discount is an exception that runs ('Aktivní')", () => {
  const { config } = sanitizeConfig({
    modules: {
      tiers: {
        sets: [
          { id: "g", scope: "global", countAcross: "product", breaks: [{ minQty: 3, percent: 10 }] },
          { id: "x", scope: { productIds: ["gid://shopify/Product/1"] }, countAcross: "product", breaks: [] },
        ],
      },
    },
  });
  assert.equal(config.modules.tiers.sets.length, 2, "the exclusion is stored");
  const overview = tiersOverviewOf(config, "pro", { state: "on", themeName: "Horizon" });
  assert.equal(overview.sets, 0, "no set with its own levels");
  assert.equal(overview.excluded, 1);
  assert.equal(tiersSetsStatus(overview, OK, "pro").state, "active");
  // On Free the plan does not run it.
  assert.equal(tiersSetsStatus(tiersOverviewOf(config, "free", { state: "on", themeName: "Horizon" }), OK, "free").state, "locked");
});

test("4: a cart an automatic discount keeps under a gift step lost nothing — only a typed code takes a gift away", async () => {
  const { findingsOf } = await import("../../app/lib/integration/combination-check.ts");
  const plan = { lines: [], rules: [], tiers: [], warnings: [{ code: "code_loses_gift", ruleId: "gift:g1" }] } as unknown as Parameters<typeof findingsOf>[0];
  const preview = { degraded: false, shortfall: 0, droppedCandidates: [] } as unknown as Parameters<typeof findingsOf>[1];
  assert.deepEqual(findingsOf(plan, preview, { codes: false }), []);
  assert.deepEqual(findingsOf(plan, preview, { codes: true }).map((f) => f.kind), ["code_loses_gift"]);
});

test("13 Oct 2026: with more products known, every combination is shown per basket — the cheapest, a middle, the most expensive product and a mix", async () => {
  await import("./support/raw-import.ts");
  const { createStaticHandler, createStaticRouter, StaticRouterProvider } = await import("react-router");
  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  try {
    const mod = await import("../../app/routes/dev.preview.$.tsx");
    const routes = [{ path: "/dev/preview/*", loader: mod.loader, action: mod.action, Component: mod.default }];
    const handler = createStaticHandler(routes);
    const context = await handler.query(new Request("http://localhost/dev/preview/try-cart?plan=pro&combos=baskets"));
    assert.ok(!(context instanceof Response));
    const html = renderToString(createElement(StaticRouterProvider, { router: createStaticRouter(handler.dataRoutes, context), context }));
    const row = html.slice(html.indexOf('data-won-combo-row="tiers"'), html.indexOf('data-won-combo-row="code"'));
    assert.deepEqual([...row.matchAll(/data-won-combo-basket="([a-z]+)"/g)].map((m) => m[1]), ["cheap", "mid", "expensive", "mix"]);
    for (const label of ["Nejlevnější produkt", "Střední produkt", "Nejdražší produkt", "Mix produktů"]) assert.ok(row.includes(label), label);
    assert.ok(row.includes("Vzorek proteinu 30 g") && row.includes("BCAA Aminokyseliny") && row.includes("Mikina Won"));
    // A gift step at 2 000 Kč would take over 30 samples at 39 Kč: that basket is not planned, and the row says so.
    const gift = html.slice(html.indexOf('data-won-combo-row="gift"'), html.indexOf('data-won-combo-row="gift-code"'));
    assert.ok(!gift.includes('data-won-combo-basket="cheap"') && /Nepočítáno: nejlevnější produkt\./.test(gift), gift.replace(/<[^>]+>/g, " ").slice(0, 300));
  } finally {
    process.env.NODE_ENV = prev;
  }
});
