import {
  expect,
  injectOptOutMeta,
  mockConfig,
  openProduct,
  readyEmbed,
  settle,
  test,
  toast,
  TOASTS_E2E_HANDLES,
} from "./support/fixtures.ts";

// A page-view announcement is the simplest way to observe whether the app is
// active on a page (no cart interaction needed).
const ALWAYS_ON_ANNOUNCEMENT = {
  plan: "pro" as const,
  notifications: [
    {
      id: "note",
      type: "announcement" as const,
      enabled: true,
      surface: "banner" as const,
      pages: [], // all pages
      message: "Hello shopper",
    },
  ],
};

// SPEC-DRIVEN (MVP10, acceptance 2 & 3). Exclusions + meta opt-out fully
// suppress the app on a page — everywhere else it still runs.
test.describe("Won Toasts exclusions (MVP10)", () => {
  test("excluding the Home page suppresses the app there but not on a product", async ({
    page,
  }) => {
    await mockConfig(page, {
      ...ALWAYS_ON_ANNOUNCEMENT,
      exclusions: { pages: ["home"], urls: [] },
    });

    // Home is excluded → nothing renders.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await readyEmbed(page);
    await settle(page);
    await expect(toast(page, "announcement")).toHaveCount(0);

    // The product page is NOT excluded → the announcement renders.
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await expect(toast(page, "announcement")).toHaveCount(1);
  });

  test("a URL-pattern exclusion suppresses matching paths", async ({ page }) => {
    await mockConfig(page, {
      ...ALWAYS_ON_ANNOUNCEMENT,
      exclusions: { pages: [], urls: [`/products/*`] },
    });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await settle(page);
    await expect(toast(page, "announcement")).toHaveCount(0);
  });

  test("a page meta opt-out makes the embed no-op", async ({ page }) => {
    await mockConfig(page, ALWAYS_ON_ANNOUNCEMENT);
    // <meta name="won-toasts:active" content="false"> on the page.
    await injectOptOutMeta(page);
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await settle(page);
    await expect(toast(page, "announcement")).toHaveCount(0);
  });
});

// SPEC-DRIVEN (MVP11, acceptance 1). A scheduled rule shows inside its window
// and is hidden outside it. Absolute ISO bounds are timezone-independent.
test.describe("Won Toasts scheduling (MVP10/MVP11)", () => {
  test("an announcement shows inside its schedule window", async ({ page }) => {
    await mockConfig(page, {
      plan: "pro",
      notifications: [
        {
          id: "note",
          type: "announcement",
          enabled: true,
          surface: "banner",
          pages: [],
          message: "Live now",
          schedule: {
            startsAt: "2000-01-01T00:00:00Z",
            endsAt: "2100-01-01T00:00:00Z",
          },
        },
      ],
    });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await expect(toast(page, "announcement")).toHaveCount(1);
  });

  test("an announcement is hidden outside its schedule window", async ({
    page,
  }) => {
    await mockConfig(page, {
      plan: "pro",
      notifications: [
        {
          id: "note",
          type: "announcement",
          enabled: true,
          surface: "banner",
          pages: [],
          message: "Past promo",
          schedule: {
            startsAt: "2000-01-01T00:00:00Z",
            endsAt: "2000-01-02T00:00:00Z", // window closed long ago
          },
        },
      ],
    });
    await openProduct(page, TOASTS_E2E_HANDLES.primary);
    await readyEmbed(page);
    await settle(page);
    await expect(toast(page, "announcement")).toHaveCount(0);
  });
});
