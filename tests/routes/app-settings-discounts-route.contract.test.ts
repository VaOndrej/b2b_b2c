import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MVP_5_1 (move-not-copy): Discounts extracted into a standalone route that
// shares the action handler (discount-settings.server) and the UI
// (DiscountSettingsView) with the legacy monolith workspace.

const DISCOUNTS_ROUTE_PATH = "app/routes/app.settings.discounts.tsx";
const DISCOUNT_VIEW_PATH = "app/components/discount-settings-view.tsx";
const DISCOUNT_SERVER_PATH = "app/services/discount-settings.server.ts";

test("discounts route is standalone, not a re-export of the settings monolith", async () => {
  const source = await readFile(DISCOUNTS_ROUTE_PATH, "utf8");

  assert.doesNotMatch(
    source,
    /from\s+"\.\/app\.settings"/,
    "Discounts must be its own route, not re-export the app.settings monolith.",
  );
  assert.match(source, /export const loader/, "Discounts route needs its own loader.");
  assert.match(source, /export const action/, "Discounts route needs its own action.");
  assert.match(
    source,
    /export default function/,
    "Discounts route needs its own component.",
  );
});

test("discounts route renders the shared DiscountSettingsView and delegates writes", async () => {
  const source = await readFile(DISCOUNTS_ROUTE_PATH, "utf8");

  assert.match(
    source,
    /<DiscountSettingsView/,
    "Discounts route must render the shared discount settings view.",
  );
  assert.match(
    source,
    /handleDiscountSettingsAction\(formData\)/,
    "Discounts route action must delegate writes to the shared discount module.",
  );
  assert.match(
    source,
    /buildDiscountConflictReport/,
    "Discounts route must surface the automatic-discount/floor conflict report.",
  );
});

test("shared discount view + server cover coupons, orchestration, blacklist, and caps", async () => {
  const [viewSource, serverSource] = await Promise.all([
    readFile(DISCOUNT_VIEW_PATH, "utf8"),
    readFile(DISCOUNT_SERVER_PATH, "utf8"),
  ]);

  for (const intent of [
    "save-coupon-segment-rule",
    "save-discount-rule",
    "save-discount-blacklist-rule",
    "save-discount-segment-cap",
  ]) {
    assert.match(
      viewSource,
      new RegExp(`value="${intent}"`),
      `Discount view must expose the ${intent} form.`,
    );
    assert.match(
      serverSource,
      new RegExp(`"${intent}"`),
      `Discount server must handle the ${intent} write.`,
    );
  }
});

test("discounts route stays isolated to discount intents only", async () => {
  const serverSource = await readFile(DISCOUNT_SERVER_PATH, "utf8");

  for (const foreignIntent of [
    "save-global",
    "save-product-floor",
    "save-product-quantity-rule",
    "save-product-visibility-rule",
    "sync-product-catalog",
  ]) {
    assert.doesNotMatch(
      serverSource,
      new RegExp(`"${foreignIntent}"`),
      `Discount module must not handle the non-discount intent ${foreignIntent}.`,
    );
  }
});
