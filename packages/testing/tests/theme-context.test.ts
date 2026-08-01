import assert from "node:assert/strict";
import test from "node:test";

import {
  SHARED_THEME_SELECTORS,
  createThemeContext,
} from "../src/playwright/index.ts";

test("shared selectors use stable Shopify form contracts", () => {
  assert.equal(
    SHARED_THEME_SELECTORS.addToCartForm,
    "form[action*='/cart/add']",
  );
  assert.match(
    SHARED_THEME_SELECTORS.quantityInput,
    /input\[name='quantity'\]/,
  );
  assert.match(SHARED_THEME_SELECTORS.addToCartButton, /type='submit'/);
});

test("remote Dawn requires and decorates with a preview theme id", () => {
  assert.equal(createThemeContext({ name: "dawn", env: {} }), null);

  const context = createThemeContext({
    name: "dawn",
    env: {
      SHOPIFY_E2E_PREVIEW_THEME_ID: "12345",
      SHOPIFY_E2E_DAWN_THEME_NAME: "Dawn QA",
    },
  });

  assert.ok(context);
  assert.equal(context.previewThemeId, "12345");
  assert.equal(context.expectedThemeName, "Dawn QA");
  assert.equal(
    context.decoratePath("/products/example?view=test"),
    "/products/example?view=test&preview_theme_id=12345",
  );
});

test("local theme-dev mode collapses preview mechanics", () => {
  const context = createThemeContext({
    name: "dawn",
    env: {
      SHOPIFY_E2E_THEME_DEV: "1",
      SHOPIFY_E2E_PREVIEW_THEME_ID: "must-not-leak",
    },
  });

  assert.ok(context);
  assert.equal(context.previewThemeId, null);
  assert.equal(context.decoratePath("/products/example"), "/products/example");
});

test("app-specific path decoration stays outside the generic theme layer", () => {
  const context = createThemeContext({
    name: "horizon",
    env: {},
    decorateUrl: (url) => {
      url.searchParams.set("app_test_context", "catalog");
    },
  });

  assert.ok(context);
  assert.equal(
    context.decoratePath("/collections/all"),
    "/collections/all?app_test_context=catalog",
  );
});
