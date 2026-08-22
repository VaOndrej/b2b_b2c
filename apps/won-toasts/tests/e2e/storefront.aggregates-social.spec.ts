import {
  expect,
  mockAggregates,
  mockConfig,
  openProduct,
  readyEmbed,
  settle,
  test,
  TOASTS_E2E_HANDLES,
} from "./support/fixtures.ts";

// Fixed reference timestamps (Playwright/Node context — Date.now is fine here).
const NOW = Date.now();
const recent = (minutesAgo: number) => NOW - minutesAgo * 60_000;

// SPEC-DRIVEN (MVP11, acceptance 3). Aggregates are REAL counts and MUST be
// visually distinguished from single events via data-won-aggregate="1".
test.describe("Won Toasts aggregates (MVP11)", () => {
  test("cart-activity renders the real count with the aggregate marker", async ({
    page,
  }) => {
    await mockConfig(page, {
      plan: "pro",
      notifications: [
        {
          id: "activity",
          type: "cart.activity",
          enabled: true,
          surface: "toast",
          pages: ["product"],
          message: "{count} people added this recently",
          windowHours: 24,
        },
      ],
    });
    // Three genuine cart-adds inside the window.
    await mockAggregates(page, {
      cartAdds: [recent(5), recent(30), recent(120)],
    });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);

    const aggregate = page.locator('[data-won-toast][data-won-aggregate="1"]');
    await expect(aggregate).toHaveCount(1);
    await expect(aggregate).toContainText("3"); // the real count, never random
  });

  test("cart-activity shows nothing when there are no events in the window", async ({
    page,
  }) => {
    await mockConfig(page, {
      plan: "pro",
      notifications: [
        {
          id: "activity",
          type: "cart.activity",
          enabled: true,
          surface: "toast",
          pages: ["product"],
          message: "{count} people added this recently",
          windowHours: 24,
        },
      ],
    });
    await mockAggregates(page, { cartAdds: [] }); // cold-start: empty
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await settle(page);
    // Honest: zero → render nothing (never "0 people").
    await expect(page.locator('[data-won-aggregate="1"]')).toHaveCount(0);
  });
});

// The MVP12 social-proof specs were REMOVED 2026-08-22 together with the runtime
// they covered. order.created reads SaleEvent rows that only the orders/create
// webhook writes, and that webhook is off until Partner "Protected customer data
// access" is approved — so the feature could not fire, the admin no longer offers
// it, and renderSocialProof is gone from storefront-src/won-toasts.js.
// Restoring the feature is a revert of that commit, which brings these specs back
// with it. Cart-activity aggregates (above) are unaffected: they count cart-add
// beacons the storefront itself sends, so they work without any order data.
