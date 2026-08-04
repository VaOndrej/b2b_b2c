import {
  expect,
  mockConfig,
  mockInventory,
  openProduct,
  readyEmbed,
  settle,
  test,
  toast,
  TOASTS_E2E_HANDLES,
} from "./support/fixtures.ts";

// SPEC-DRIVEN (won-toasts-mvp-plan.md §7b, MVP9). First VISIBLE cold-start-safe
// types — countdown + low-stock — rendered from config, governed by MVP8. These
// assert the acceptance criteria and the spec's DOM markers, not the code.

test.describe("Won Toasts countdown (MVP9)", () => {
  test("countdown renders [data-won-countdown] on a product page and counts down", async ({
    page,
  }) => {
    await mockConfig(page, {
      plan: "pro",
      notifications: [
        {
          id: "sale",
          type: "countdown",
          enabled: true,
          surface: "banner",
          pages: ["product"],
          message: "Ends in {countdown}",
          evergreenMs: 3_600_000,
        },
      ],
    });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);

    // Acceptance (1): rendered with the spec marker on the product page.
    const countdown = page.locator("[data-won-countdown]");
    await expect(countdown).toHaveCount(1);

    // ...and it counts down: the visible time must change within ~2s.
    const first = (await countdown.textContent())?.trim();
    await expect
      .poll(async () => (await countdown.textContent())?.trim() !== first, {
        timeout: 3000,
      })
      .toBe(true);
  });

  test("countdown does not render on a non-targeted page", async ({ page }) => {
    await mockConfig(page, {
      plan: "pro",
      notifications: [
        {
          id: "sale",
          type: "countdown",
          enabled: true,
          surface: "banner",
          pages: ["cart"], // only the cart page
          message: "Ends in {countdown}",
          evergreenMs: 3_600_000,
        },
      ],
    });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await settle(page);
    await expect(page.locator("[data-won-countdown]")).toHaveCount(0);
  });
});

// SPEC-DRIVEN (MVP9). Low-stock urgency shows ONLY on genuine scarcity —
// real inventory strictly below the threshold. Marker [data-type='stock'].
test.describe("Won Toasts low-stock (MVP9)", () => {
  test("shows 'only N left' when inventory is below the threshold", async ({
    page,
  }) => {
    await mockConfig(page, {
      plan: "pro",
      notifications: [
        {
          id: "few",
          type: "stock.low",
          enabled: true,
          surface: "toast",
          pages: ["product"],
          message: "Only {count} left",
          threshold: 5,
        },
      ],
    });
    await mockInventory(page, TOASTS_E2E_HANDLES.primary, 2); // below threshold
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);

    const stock = toast(page, "stock");
    await expect(stock).toHaveCount(1);
    await expect(stock).toContainText("2");
  });

  test("shows nothing when inventory is at or above the threshold", async ({
    page,
  }) => {
    await mockConfig(page, {
      plan: "pro",
      notifications: [
        {
          id: "few",
          type: "stock.low",
          enabled: true,
          surface: "toast",
          pages: ["product"],
          message: "Only {count} left",
          threshold: 5,
        },
      ],
    });
    await mockInventory(page, TOASTS_E2E_HANDLES.primary, 25); // plenty
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await settle(page);
    // Honest: no fake urgency when there is no scarcity.
    await expect(toast(page, "stock")).toHaveCount(0);
  });
});

// SPEC-DRIVEN (MVP8 GATE, acceptance 4). Governance caps page-view types: the
// same rule may fire at most `maxPerSession` times across page views — not once
// per page. We use a persistent countdown so presence is reliable per load.
test.describe("Won Toasts frequency governance (MVP8)", () => {
  test("a page-view type is capped at maxPerSession across 5 product views", async ({
    page,
  }) => {
    await mockConfig(page, {
      plan: "pro",
      global: { frequency: { maxPerSession: 2 } },
      notifications: [
        {
          id: "sale",
          type: "countdown",
          enabled: true,
          surface: "banner",
          pages: ["product"],
          message: "Ends in {countdown}",
          evergreenMs: 3_600_000,
        },
      ],
    });

    let rendered = 0;
    for (let visit = 0; visit < 5; visit++) {
      await openProduct(page, TOASTS_E2E_HANDLES.primary);
      await readyEmbed(page);
      await settle(page, 300);
      if ((await page.locator("[data-won-countdown]").count()) > 0) rendered += 1;
    }

    // Exactly maxPerSession emits — the 3rd–5th views are suppressed.
    expect(rendered).toBe(2);
  });
});
