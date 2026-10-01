import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { formatLiquidMoney, previewTiers } from "../../app/components/model/tiers.ts";
import type { TierSetView } from "../../app/components/model/types.ts";

// The admin preview's arithmetic (model/tiers.ts previewTiers) is a PORT of the
// storefront block's own pure logic (assets/won-discounts-tiers-core.js
// `compute`, the same steps as blocks/quantity_tiers.liquid). This runs both on
// the same fixtures — percent and amount sets, prices whose percent lands on a
// fraction, margin ceilings, every quantity from 1 to 12 — so a change to the
// storefront math that the preview did not follow fails here (review fix 1:
// the storefront moved to a floored per-item percent and a per-line round).

const ASSET = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extensions/won-discounts-storefront/assets/won-discounts-tiers-core.js");

interface CoreRow {
  min: number;
  pct: number | null;
  d: number;
  unit: number;
}
interface CoreResult {
  rows: CoreRow[];
  active: CoreRow | null;
  unit: number;
  total: number;
  next: CoreRow | null;
  empty: boolean;
}
interface Core {
  compute(data: unknown, variantId: number, qty: number): CoreResult | null;
  money(cents: number, fmt: string): string;
}

/** The storefront file as the theme runs it (a `window` global, no DOM needed). */
function loadCore(): Core {
  const window: { WonDiscountsTiersCore?: Core } = {};
  vm.runInContext(readFileSync(ASSET, "utf8"), vm.createContext({ window }));
  assert.ok(window.WonDiscountsTiersCore, "the core file defines window.WonDiscountsTiersCore");
  return window.WonDiscountsTiersCore;
}

/** K5 storefront breaks of a view (amounts in Liquid money units for `cur`). */
function k5Breaks(set: TierSetView): unknown[] {
  return set.breaks.map((b) => (b.kind === "percent" ? { min: b.minQty, pct: b.percent } : { min: b.minQty, off: { ...b.amount } }));
}

const PERCENT: TierSetView = {
  id: "global",
  scope: { kind: "global" },
  countAcross: "line",
  breaks: [
    { minQty: 3, kind: "percent", percent: 10, amount: {} },
    { minQty: 5, kind: "percent", percent: 12.5, amount: {} },
    { minQty: 10, kind: "percent", percent: 33.3, amount: {} },
  ],
};
const AMOUNT: TierSetView = {
  id: "t_a",
  scope: { kind: "global" },
  countAcross: "line",
  breaks: [
    { minQty: 2, kind: "amount", percent: null, amount: { CZK: 3000, EUR: 120 } },
    { minQty: 4, kind: "amount", percent: null, amount: { CZK: 3000 } },
    { minQty: 6, kind: "amount", percent: null, amount: { CZK: 6000, EUR: 250 } },
  ],
};

test("previewTiers = the storefront's compute() on every fixture (rows, active, live per-item price and total, next, empty)", () => {
  const core = loadCore();
  let compared = 0;
  for (const set of [PERCENT, AMOUNT]) {
    for (const cur of ["CZK", "EUR"]) {
      for (const price of [999, 1290, 1999, 20000, 79000, 12345]) {
        for (const max of [100, 37.5, 12.5, 9.9, 0]) {
          for (let qty = 1; qty <= 12; qty += 1) {
            const data = { count: "line", cur, breaks: k5Breaks(set), variants: [{ id: 1, p: price, m: max, c: 0 }], cart: { p: 0, s: 0 } };
            // (plain JSON: objects made in the vm realm have another Array/Object prototype)
            const theirs = JSON.parse(JSON.stringify(core.compute(data, 1, qty))) as CoreResult;
            const ours = previewTiers(set, { unitPrice: price, currency: cur, quantity: qty, maxPercent: max });
            const label = `${set.id} ${cur} price ${price} max ${max} qty ${qty}`;
            assert.deepEqual(
              ours.rows.map((r) => [r.minQty, r.unitPrice, r.hidden]),
              theirs.rows.map((r) => [r.min, r.unit, r.d <= 0]),
              `${label}: rows`,
            );
            assert.deepEqual(
              ours.rows.map((r) => (r.save.kind === "percent" ? r.save.percent : r.save.amount)),
              theirs.rows.map((r) => (r.pct !== null ? Math.round(r.pct * 10) / 10 : r.d)),
              `${label}: what a row says it saves`,
            );
            assert.equal(ours.active, theirs.active ? theirs.active.min : null, `${label}: active`);
            assert.equal(ours.unitPrice, theirs.unit, `${label}: live per-item price`);
            assert.equal(ours.total, theirs.total, `${label}: live total`);
            assert.equal(ours.next?.minQty ?? null, theirs.next ? theirs.next.min : null, `${label}: next`);
            if (ours.next && theirs.next) assert.equal(ours.next.unitPrice, theirs.next.unit, `${label}: next price`);
            assert.equal(ours.empty, theirs.empty, `${label}: empty`);
            compared += 1;
          }
        }
      }
    }
  }
  assert.equal(compared, 2 * 2 * 6 * 5 * 12);
});

test("money: the preview writes every money format like the storefront's money()", () => {
  const core = loadCore();
  const formats = [
    "{{amount_with_comma_separator}} Kč",
    "€{{amount}}",
    "{{ amount_no_decimals_with_space_separator }} Kč",
    "{{amount_no_decimals_with_comma_separator}}",
    "{{amount_with_space_separator}} €",
    "{{amount_with_period_and_space_separator}}",
    "CHF {{amount_with_apostrophe_separator}}",
    "{{amount}} / {{amount_no_decimals}}",
  ];
  for (const fmt of formats) {
    for (const cents of [0, 5, 990, 123450, 100000000, 1234567]) {
      assert.equal(formatLiquidMoney(cents, "CZK", fmt, "cs"), core.money(cents, fmt), `${fmt} ${cents}`);
    }
  }
});
