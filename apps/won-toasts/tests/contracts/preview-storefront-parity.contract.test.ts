import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// A1 drift guard for the ADMIN PREVIEW.
//
// The storefront builds three different kinds of card, and they are NOT the same:
//
//   cartCard            → calls iconFor(), per-event accent
//   renderMilestoneToast → NO icon, per-event accent
//   notifCard            → NO icon, accentFor("info") for every notification type
//
// The admin preview rendered all three as "a WonToastCard with the theme's icon
// and a per-type accent", so a merchant editing "Accent colour per event" saw
// colours on countdown / low-stock / announcement toasts that shoppers never got,
// and an icon on milestone toasts that the runtime never draws.
//
// These assertions pin the runtime facts the preview now mirrors. If someone adds
// icons or per-type accents to the storefront (a good change!), this test fails —
// which is the point: the preview must be updated in the SAME commit, or the two
// silently diverge again.
//
// Source-text assertions, not execution: the storefront is an IIFE that needs a
// DOM. Full behavioural parity still belongs to the E2E harness (TEST-3).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STOREFRONT_SRC = readFileSync(
  path.join(HERE, "../../storefront-src/won-toasts.js"),
  "utf8",
);
const NOTIFICATION_PREVIEW = readFileSync(
  path.join(HERE, "../../app/components/NotificationPreview.tsx"),
  "utf8",
);
const TOAST_PREVIEW = readFileSync(
  path.join(HERE, "../../app/components/ToastPreview.tsx"),
  "utf8",
);

/** Extract a top-level `function name(...) { … }` body by brace matching. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `storefront must still define ${name}()`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}()`);
}

test("storefront notification cards render NO icon and a single 'info' accent", () => {
  const body = functionBody(STOREFRONT_SRC, "notifCard");
  assert.ok(
    !body.includes("iconFor("),
    "notifCard() gained an icon — NotificationPreview must render one too (A1)",
  );
  assert.ok(
    body.includes('accentFor("info")'),
    "notifCard() no longer forces the info accent — NotificationPreview must follow (A1)",
  );
});

test("storefront milestone toasts render NO icon", () => {
  const body = functionBody(STOREFRONT_SRC, "renderMilestoneToast");
  assert.ok(
    !body.includes("iconFor("),
    "renderMilestoneToast() gained an icon — ToastPreview's milestone() must too (A1)",
  );
});

test("the admin previews mirror those two facts", () => {
  // NotificationPreview: one shared accent, icon suppressed.
  assert.ok(
    NOTIFICATION_PREVIEW.includes("icon={false}"),
    "NotificationPreview must suppress the icon while notifCard() draws none",
  );
  assert.ok(
    !NOTIFICATION_PREVIEW.includes("ACCENT_OF["),
    "NotificationPreview must not reintroduce a per-recipe accent map",
  );
  // ToastPreview: milestone cards suppress the icon, cart cards keep theirs.
  assert.ok(
    TOAST_PREVIEW.includes("icon: false"),
    "ToastPreview's milestone() must suppress the icon",
  );
});

test("cart toasts DO keep their icon on both sides", () => {
  // The parity fix must not have quietly stripped icons from cart toasts, which
  // are the one surface the runtime really does draw them on.
  assert.ok(
    STOREFRONT_SRC.includes("var iconEl = iconFor(p);"),
    "the cart card must still call iconFor()",
  );
  assert.ok(
    !TOAST_PREVIEW.includes("icon={false}"),
    "ToastPreview must not blanket-disable icons — only milestone cards opt out",
  );
});
