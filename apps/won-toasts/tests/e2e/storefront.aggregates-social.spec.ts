import {
  expect,
  mockAggregates,
  mockConfig,
  mockSocial,
  openProduct,
  readyEmbed,
  settle,
  test,
  toast,
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

// SPEC-DRIVEN (MVP12, acceptance 2). The social-proof feed renders stored
// (anonymized) sales. Marker [data-type='sale'].
test.describe("Won Toasts social proof (MVP12)", () => {
  test("renders a recent sale from the feed with name + city", async ({
    page,
  }) => {
    await mockConfig(page, {
      plan: "pro",
      notifications: [
        {
          id: "sales",
          type: "order.created",
          enabled: true,
          surface: "toast",
          pages: ["product"],
          message: "{name} from {city} bought {product}",
          showName: true,
          showCity: true,
          minOrders: 1,
        },
      ],
    });
    await mockSocial(page, [
      { firstName: "Anna", city: "Praha", product: "Blue Mug", at: recent(4) },
    ]);
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);

    const sale = toast(page, "sale");
    await expect(sale).toHaveCount(1);
    await expect(sale).toContainText("Anna");
    await expect(sale).toContainText("Praha");
    await expect(sale).toContainText("Blue Mug");
  });

  test("renders nothing when the feed is empty (cold-start honesty)", async ({
    page,
  }) => {
    await mockConfig(page, {
      plan: "pro",
      notifications: [
        {
          id: "sales",
          type: "order.created",
          enabled: true,
          surface: "toast",
          pages: ["product"],
          message: "{name} from {city} bought {product}",
          showName: true,
          showCity: true,
          minOrders: 1,
        },
      ],
    });
    await mockSocial(page, []); // no stored sales → nothing to show
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await settle(page);
    await expect(toast(page, "sale")).toHaveCount(0);
  });
});
