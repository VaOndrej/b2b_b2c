import assert from "node:assert/strict";
import { test } from "node:test";

import {
  plural,
  pluralCategory,
  renderTemplate,
} from "../../src/toasts/template.ts";

test("renderTemplate substitutes known placeholders", () => {
  assert.equal(
    renderTemplate("Added {qty}× {product} ({price})", {
      qty: 2,
      product: "Widget",
      price: "€10",
    }),
    "Added 2× Widget (€10)",
  );
});

test("unknown or nullish placeholders render empty", () => {
  assert.equal(renderTemplate("a{missing}b", {}), "ab");
  assert.equal(renderTemplate("a{x}b", { x: null }), "ab");
});

test("english pluralization is one/other", () => {
  assert.equal(pluralCategory(1, "en"), "one");
  assert.equal(pluralCategory(0, "en"), "other");
  assert.equal(pluralCategory(5, "en"), "other");
});

test("czech pluralization is one / few (2-4) / other", () => {
  assert.equal(pluralCategory(1, "cs"), "one");
  assert.equal(pluralCategory(3, "cs"), "few");
  assert.equal(pluralCategory(5, "cs"), "other");
  assert.equal(pluralCategory(0, "cs"), "other");
});

test("plural picks the right form with fallback", () => {
  const forms = { one: "kus", few: "kusy", other: "kusů" };
  assert.equal(plural(1, forms, "cs"), "kus");
  assert.equal(plural(3, forms, "cs"), "kusy");
  assert.equal(plural(8, forms, "cs"), "kusů");
  // english falls back to other when 'few' is irrelevant
  assert.equal(plural(2, { one: "item", other: "items" }, "en"), "items");
});
