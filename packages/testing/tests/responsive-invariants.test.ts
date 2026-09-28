import assert from "node:assert/strict";
import test from "node:test";

import { assertResponsiveSane } from "../src/playwright/responsive-invariants.ts";

// audit fix round 3 (E2E helper): assertResponsiveSane's `root` option must scope
// the ELEMENT-level checks (wide elements, tap targets) to a subtree, while the
// PAGE-level horizontal-overflow check always covers the whole document — an app
// embed can make the whole page scroll even though its own box looks fine, so that
// check must never be scoped away by a caller (e.g. an app's own embed root).
//
// No real browser is needed: page.evaluate is stubbed to capture what argument
// assertResponsiveSane sends it, without invoking the (browser-only) callback —
// that stub is the scoping logic under test.

type FakePage = { evaluate: (fn: unknown, arg?: unknown) => Promise<unknown> };

function fakePage(results: [unknown, unknown, unknown]): { page: FakePage; args: unknown[] } {
  const args: unknown[] = [];
  let call = 0;
  const page: FakePage = {
    evaluate: async (_fn, arg) => {
      args.push(arg);
      return results[call++];
    },
  };
  return { page, args };
}

test("assertResponsiveSane passes the root selector to the element-level checks only", async () => {
  const { page, args } = fakePage([{ scrollW: 400, clientW: 400 }, [], []]);
  await assertResponsiveSane(page as unknown as import("@playwright/test").Page, {
    root: "#won-discounts-root",
  });
  assert.equal(args.length, 3, "overflow, wide-elements, tap-targets");
  assert.equal(args[0], undefined, "page-level overflow check takes no scoping argument");
  assert.deepEqual(args[1], { tol: 1, rootSelector: "#won-discounts-root" });
  assert.deepEqual(args[2], { min: 44, rootSelector: "#won-discounts-root" });
});

test("omitting root checks the whole page (rootSelector: null), unchanged from before", async () => {
  const { page, args } = fakePage([{ scrollW: 400, clientW: 400 }, [], []]);
  await assertResponsiveSane(page as unknown as import("@playwright/test").Page);
  assert.deepEqual(args[1], { tol: 1, rootSelector: null });
  assert.deepEqual(args[2], { min: 44, rootSelector: null });
});

test("a scroll-width violation still fails even when root is scoped to a subtree", async () => {
  const { page } = fakePage([{ scrollW: 500, clientW: 400 }, [], []]);
  await assert.rejects(() =>
    assertResponsiveSane(page as unknown as import("@playwright/test").Page, { root: "#embed" }),
  );
});
