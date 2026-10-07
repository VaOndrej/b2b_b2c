import assert from "node:assert/strict";
import test from "node:test";

import { assertExtensionAssetsLoaded, missingExtensionAssets } from "../src/playwright/extension-assets.ts";

// won-discounts, 7 Oct 2026: the storefront linked the extension's stylesheet and scripts from a dev preview whose
// files answered 404 — the block was on the page with the right classes, unstyled. These are the real answers.

const CDN = "https://cdn.shopify.com/extensions/01a114fb-fe3b-7c4c-be87-e8992818c869/dev-5dc73830-6f88-4be1-b2ff-dde53e55b00e/assets";
const page = (reads: unknown) => ({ evaluate: async () => reads }) as unknown as import("@playwright/test").Page;

test("a 404 (Shopify's HTML page) for an extension file is a missing asset", () => {
  const reads = [
    { url: `${CDN}/won-discounts-tiers.css`, status: 404, type: "text/html; charset=utf-8" },
    { url: `${CDN}/won-discounts-tiers.js`, status: 200, type: "application/javascript" },
    { url: `${CDN}/won-discounts.css`, status: 200, type: "text/html; charset=utf-8" },
    { url: `${CDN}/won-discounts.js`, status: 0, type: "" },
  ];
  assert.deepEqual(missingExtensionAssets(reads).map((r) => r.url.split("/").pop()), ["won-discounts-tiers.css", "won-discounts.css", "won-discounts.js"]);
});

test("assertExtensionAssetsLoaded fails on the 7 Oct state and names the files", async () => {
  await assert.rejects(
    () => assertExtensionAssetsLoaded(page([{ url: `${CDN}/won-discounts-tiers.css`, status: 404, type: "text/html; charset=utf-8" }])),
    /404 https:\/\/cdn\.shopify\.com\/extensions\/[^ ]+won-discounts-tiers\.css/,
  );
});

test("it passes when every file loads, and fails when the page links no extension file at all", async () => {
  await assertExtensionAssetsLoaded(page([{ url: `${CDN}/won-discounts-tiers.css`, status: 200, type: "text/css" }]));
  await assert.rejects(() => assertExtensionAssetsLoaded(page([])));
});
