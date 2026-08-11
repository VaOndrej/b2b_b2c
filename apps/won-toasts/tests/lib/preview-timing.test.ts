import assert from "node:assert/strict";
import { test } from "node:test";

import { previewTiming } from "../../app/lib/preview-timing";

test("labelSec always reflects the REAL configured duration (never clamped)", () => {
  // The bug: a 10s setting showed as "8s" because the animation cap leaked
  // into the label. The label is the factual claim the merchant reads.
  assert.equal(previewTiming(10_000).labelSec, 10);
  assert.equal(previewTiming(60_000).labelSec, 60);
  assert.equal(previewTiming(3_500).labelSec, 3.5);
});

test("dwellMs plays the real duration up to the 12s practical bound", () => {
  assert.equal(previewTiming(10_000).dwellMs, 10_000); // real, under the bound
  assert.equal(previewTiming(12_000).dwellMs, 12_000); // exactly at the bound
});

test("dwellMs compresses durations longer than the bound so the loop stays useful", () => {
  assert.equal(previewTiming(60_000).dwellMs, 12_000); // capped for the animation
  // ...but the label still tells the truth:
  assert.equal(previewTiming(60_000).labelSec, 60);
});

test("dwellMs has a readable floor and tolerates missing/zero input", () => {
  assert.equal(previewTiming(0).labelSec, 3.5); // falls back to the 3.5s default
  assert.equal(previewTiming(500).dwellMs, 1_000); // floor so it's never unreadable
});
