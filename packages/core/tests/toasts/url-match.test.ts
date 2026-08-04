import assert from "node:assert/strict";
import { test } from "node:test";

import {
  matchUrlPattern,
  normalizePath,
  pathExcluded,
} from "../../src/toasts/url-match.ts";

test("normalizePath strips query + hash and keeps the path", () => {
  assert.equal(normalizePath("/cart?foo=bar#x"), "/cart");
  assert.equal(normalizePath("/products/shirt#reviews"), "/products/shirt");
  assert.equal(normalizePath("/"), "/");
  assert.equal(normalizePath(""), "/");
});

test("exact and prefix matches ignore query/hash", () => {
  assert.equal(matchUrlPattern("/cart?x=1", "/cart"), true);
  assert.equal(matchUrlPattern("/cart/", "/cart"), false); // exact, trailing differs
  assert.equal(matchUrlPattern("/collections/shoes?page=2", "/collections/*"), true);
  assert.equal(matchUrlPattern("/collections", "/collections/*"), false);
});

test("glob wildcard matches within a segment run", () => {
  assert.equal(matchUrlPattern("/products/red-shirt", "/products/*"), true);
  assert.equal(matchUrlPattern("/pages/about#team", "/pages/*"), true);
  assert.equal(matchUrlPattern("/blogs/news/post-1", "/blogs/*"), true);
  assert.equal(matchUrlPattern("/x", "/y*"), false);
});

test("pathExcluded is true when ANY pattern matches; blank patterns ignored", () => {
  const patterns = ["/cart", "/checkout*", "  ", "/account/*"];
  assert.equal(pathExcluded("/cart?x=1", patterns), true);
  assert.equal(pathExcluded("/checkout/thank-you", patterns), true);
  assert.equal(pathExcluded("/account/orders", patterns), true);
  assert.equal(pathExcluded("/products/shirt", patterns), false);
  assert.equal(pathExcluded("/anything", []), false);
});
