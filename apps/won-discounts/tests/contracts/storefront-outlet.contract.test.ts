import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// MVP 5 contract O9: the sale badge block `outlet_badge` (PDP). It reads the product metafield
// `$app:won_discounts.outlet` = {"d": display, "v": {"<variant numeric id>": left}} the sale writes:
//   silent / strike → nothing (the theme strikes `compare_at_price` itself);
//   strike_badge → "Výprodej"; strike_badge_left → + "Zbývá X ks" (X > 0, from the quota).
// One badge for a single-variant product; otherwise one row per sale variant, NAMED — right whatever variant
// the shopper picks, with no script at all (SF-2) and never a cart change (SF-1).

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extensions/won-discounts-storefront");
const liquid = readFileSync(path.join(EXT, "blocks/outlet_badge.liquid"), "utf8");
const code = liquid.replace(/\{% comment %\}[\s\S]*?\{% endcomment %\}/g, "");

test("Liquid: reads the product's `outlet` metafield (app-owned), shows only for strike_badge / strike_badge_left", () => {
  assert.match(liquid, /product\.metafields\['\$app:won_discounts'\]\.outlet\.value/);
  assert.match(liquid, /d == 'strike_badge' or d == 'strike_badge_left'/);
  assert.doesNotMatch(code, /\bcart\b/, "never reads the cart (SF-1)");
});

test("Liquid: a row per sale variant (by its numeric id), named unless the product has only the default variant; 'Zbývá X ks' only for strike_badge_left and X > 0", () => {
  assert.match(liquid, /for v in product\.variants/);
  assert.match(liquid, /assign key = v\.id \| append: ''\s+assign left = ov\.v\[key\]/);
  assert.match(liquid, /if left != nil/);
  assert.match(liquid, /unless product\.has_only_default_variant[\s\S]*?v\.title \| escape/);
  assert.match(liquid, /if d == 'strike_badge_left' and left > 0/);
  assert.match(liquid, /'outlet\.left' \| t: count: left/);
  for (const marker of ["data-won-discounts-outlet", "data-won-discounts-outlet-variant", "data-won-discounts-outlet-badge", "data-won-discounts-outlet-left"]) {
    assert.ok(liquid.includes(marker), marker);
  }
});

test("no script of its own: the block names no javascript and there is no outlet asset; only a look with a countdown loads the banner's countdown script, for a sale with an end", () => {
  assert.doesNotMatch(liquid, /"javascript"/);
  assert.equal(existsSync(path.join(EXT, "assets/won-discounts-outlet.js")), false);
  // One script tag, behind the look's flag (`appearance.oc`) and a sale's end date (`ov.e`).
  assert.equal((liquid.match(/<script src=/g) ?? []).length, 1);
  assert.match(liquid, /\{%- if won_timed -%\}\s*<script src="\{\{ 'won-discounts-blocks\.js' \| asset_url \}\}" defer><\/script>\s*\{%- endif -%\}/);
  assert.match(liquid, /if app\.metafields\.won_discounts\.storefront_config\.value\.appearance\.oc == 1 and ov\.e != blank\s+assign won_timed = true/);
  // The countdown is the banner's markup (assets/won-discounts-blocks.js reads it), one per timed variant, hidden until it runs.
  assert.match(liquid, /\{%- if won_timed and ov\.e\[key\] != nil -%\}\s*<span class="won-outlet__time" data-won-discounts-campaign[^>]* hidden>/);
  assert.match(liquid, /<script type="application\/json">\[\{"n":"","s":0,"e":\{\{ ov\.e\[key\] \| plus: 0 \}\}\}\]<\/script>/);
});

test("Locales: badge and 'left' texts in en, cs, sk", () => {
  for (const file of ["en.default.json", "cs.json", "sk.json"]) {
    const t = JSON.parse(readFileSync(path.join(EXT, "locales", file), "utf8")) as { outlet?: { badge?: string; left?: string } };
    assert.ok(t.outlet?.badge, `${file} outlet.badge`);
    assert.match(t.outlet?.left ?? "", /\{\{ count \}\}/, `${file} outlet.left`);
  }
});

test("CSS: sizes in px (Dawn's 62.5 % rem), colors from the theme", () => {
  const css = readFileSync(path.join(EXT, "assets/won-discounts-outlet.css"), "utf8");
  assert.doesNotMatch(css, /\d(\.\d+)?rem/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb\(/i);
});
