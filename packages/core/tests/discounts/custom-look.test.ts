// MVP 7 contract M7: the Pro custom look — validated variables + CSS that only ever reaches a page scoped under its
// element's root (SEC-3; since the split of 8 Oct 2026 every element has its own look and root, looks.test.ts).

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConfigIssue } from "../../src/discounts/config.ts";
import { customLookCss as cssUnder, customLookIssue as issueUnder, LOOK_ROOT, sanitizeCustomLook } from "../../src/discounts/custom-look.ts";

// The table's root: what the table's custom look is confined to.
const WON_BLOCK_ROOT = LOOK_ROOT.tiers;
const customLookCss = (look: Parameters<typeof cssUnder>[0]) => cssUnder(look, WON_BLOCK_ROOT);
const customLookIssue = (look: Parameters<typeof issueUnder>[0]) => issueUnder(look, WON_BLOCK_ROOT);

const sanitize = (raw: unknown) => {
  const issues: ConfigIssue[] = [];
  return { look: sanitizeCustomLook(raw, issues), codes: issues.map((i) => i.code) };
};

test("stored form: valid colors (lower-cased) and a radius clamped to 0–32 px; junk values dropped with an issue; nothing left = undefined", () => {
  assert.deepEqual(sanitize({ vars: { accent: "#0A7D4F", line: "#eee", tint: "", radius: 40.4 }, css: ".a{b:c}" }), {
    look: { vars: { accent: "#0a7d4f", line: "#eee", radius: 32 }, css: ".a{b:c}" },
    codes: [],
  });
  assert.deepEqual(sanitize({ vars: { accent: "red", radius: "4" } }), { look: undefined, codes: ["invalid_custom_color", "invalid_custom_radius"] });
  assert.deepEqual(sanitize({ vars: { accent: "#12345g" }, css: 7 }), { look: undefined, codes: ["invalid_custom_color", "invalid_custom_css"] });
  assert.deepEqual(sanitize(undefined), { look: undefined, codes: [] });
  assert.deepEqual(sanitize("x"), { look: undefined, codes: ["invalid_custom_look"] });
  assert.deepEqual(sanitize({ vars: {}, css: "   " }), { look: undefined, codes: [] });
  assert.deepEqual(sanitize({ css: "x".repeat(4001) }), { look: undefined, codes: ["custom_css_too_long"] });
});

test("the page's stylesheet: the variables as one rule on the element's root, then the CSS scoped under it", () => {
  const css = customLookCss({ vars: { accent: "#0a7d4f", radius: 4 }, css: ".won-tiers__row{font-weight:700} :root{margin:0}" });
  assert.equal(
    css,
    `${WON_BLOCK_ROOT}{--won-tiers-accent:#0a7d4f;--won-tiers-radius:4px}${WON_BLOCK_ROOT} .won-tiers__row{font-weight:700}${WON_BLOCK_ROOT}{margin:0}`,
  );
  assert.equal(customLookCss({ vars: { tint: "#fff" }, css: "" }), `${WON_BLOCK_ROOT}{--won-tiers-tint:#fff}`);
  assert.equal(customLookCss(undefined), "");
  assert.equal(customLookCss({ vars: {}, css: "" }), "");
});

test("CSS that is not acceptable never reaches a page: the variables still apply, the issue says why", () => {
  const look = { vars: { accent: "#000" }, css: ".a{background:url(https://evil.example/x)}" };
  assert.deepEqual(customLookIssue(look), { reason: "forbidden", detail: "url(" });
  assert.equal(customLookCss(look), `${WON_BLOCK_ROOT}{--won-tiers-accent:#000}`);
  assert.deepEqual(customLookIssue({ css: ".a{b:c" }), { reason: "unbalanced" });
  assert.equal(customLookIssue({ css: ".a{b:c}" }), null);
  assert.equal(customLookIssue(undefined), null);
});

test("a hand-made stored value cannot inject through the variables", () => {
  const css = customLookCss({ vars: { accent: "red;}</style><script>" as string, radius: Number.NaN }, css: "" });
  assert.equal(css, "");
  assert.doesNotMatch(customLookCss({ vars: { accent: "#fff", line: "#000}body{display:none" }, css: "" }), /body/);
});

test("config → gate → storefront config: Pro ships the scoped stylesheet, Free ships none and the stored config keeps it; cards flag follows the setting", async () => {
  const { sanitizeConfig } = await import("../../src/discounts/config.ts");
  const { gateConfigForPlan } = await import("../../src/discounts/plan-gate.ts");
  const { buildStorefrontConfig } = await import("../../src/discounts/storefront-config.ts");
  const { config, issues } = sanitizeConfig({ storefront: { appearancePreset: "chips", cardPricesEnabled: true, custom: { vars: { accent: "#0A7D4F" }, css: ".won-tiers__row{color:red}" } } });
  assert.deepEqual(issues, []);
  assert.deepEqual(config.storefront.looks.tiers, { preset: "chips", custom: { vars: { accent: "#0a7d4f" }, css: ".won-tiers__row{color:red}" } });
  const pro = buildStorefrontConfig(gateConfigForPlan(config, "pro").config, { configVersion: "v" });
  // The table's look on the table, and (a config from before the split) its colour on the ladder, as it always showed.
  assert.equal(pro.appearance.css, ".won-tiers{--won-tiers-accent:#0a7d4f}.won-tiers .won-tiers__row{color:red}.won-ms{--won-tiers-accent:#0a7d4f}");
  assert.equal(pro.cards, 1);
  const free = gateConfigForPlan(config, "free");
  assert.deepEqual(free.config.storefront.looks, { tiers: { preset: "chips" }, milestones: {} }, "the custom look, and the custom colour copied to the ladder, are Pro");
  assert.deepEqual(buildStorefrontConfig(free.config, { configVersion: "v" }).appearance, { preset: "chips" });
  assert.deepEqual(config.storefront.looks.tiers?.custom?.vars, { accent: "#0a7d4f" }, "the stored config is untouched by the gate");
  const plain = buildStorefrontConfig(sanitizeConfig({}).config, { configVersion: "v" });
  assert.equal("cards" in plain || "css" in plain.appearance, false);
});
