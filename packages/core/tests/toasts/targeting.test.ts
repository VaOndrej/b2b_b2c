import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_TARGETING,
  matchesTargeting,
} from "../../src/toasts/targeting.ts";
import { sanitizeTargeting } from "../../src/toasts/config.defaults.ts";

const ctx = (over = {}) => ({
  pageType: "product" as const,
  isMobile: false,
  isLoggedIn: false,
  ...over,
});

test("default targeting matches everything", () => {
  assert.equal(matchesTargeting(ctx(), DEFAULT_TARGETING), true);
});

test("page filter restricts to listed page types", () => {
  const t = { ...DEFAULT_TARGETING, pages: ["cart" as const] };
  assert.equal(matchesTargeting(ctx({ pageType: "product" }), t), false);
  assert.equal(matchesTargeting(ctx({ pageType: "cart" }), t), true);
});

test("device filter honours mobile/desktop", () => {
  const mobile = { ...DEFAULT_TARGETING, device: "mobile" as const };
  assert.equal(matchesTargeting(ctx({ isMobile: true }), mobile), true);
  assert.equal(matchesTargeting(ctx({ isMobile: false }), mobile), false);
});

test("customer state is ignored when storefront can't tell", () => {
  const t = { ...DEFAULT_TARGETING, customerState: "logged-in" as const };
  assert.equal(matchesTargeting(ctx({ isLoggedIn: undefined }), t), true);
  assert.equal(matchesTargeting(ctx({ isLoggedIn: false }), t), false);
  assert.equal(matchesTargeting(ctx({ isLoggedIn: true }), t), true);
});

test("sanitizeTargeting drops unknown pages/enums", () => {
  const t = sanitizeTargeting({
    pages: ["cart", "moon", "home"],
    device: "mobile",
    customerState: "bogus",
  });
  assert.deepEqual(t.pages, ["cart", "home"]);
  assert.equal(t.device, "mobile");
  assert.equal(t.customerState, "both");
});
