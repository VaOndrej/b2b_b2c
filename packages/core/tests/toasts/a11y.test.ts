import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ariaRoleFor,
  politenessFor,
  screenReaderText,
} from "../../src/toasts/a11y.ts";

test("urgent types announce assertively with role=alert", () => {
  assert.equal(politenessFor("stock"), "assertive");
  assert.equal(ariaRoleFor("stock"), "alert");
});

test("ambient types announce politely with role=status", () => {
  for (const t of ["added", "announcement", "sale", "countdown", "info"]) {
    assert.equal(politenessFor(t), "polite");
    assert.equal(ariaRoleFor(t), "status");
  }
});

test("an explicit override wins over the per-type default", () => {
  assert.equal(politenessFor("added", "assertive"), "assertive");
  assert.equal(politenessFor("stock", "polite"), "polite");
  assert.equal(ariaRoleFor("added", "assertive"), "alert");
});

test("screenReaderText joins title + detail, trimming empties", () => {
  assert.equal(screenReaderText("Added to cart", "Blue Mug"), "Added to cart. Blue Mug");
  assert.equal(screenReaderText("Added to cart", ""), "Added to cart");
  assert.equal(screenReaderText("", "Blue Mug"), "Blue Mug");
});
