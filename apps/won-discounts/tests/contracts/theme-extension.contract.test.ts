import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// SPEC-DRIVEN contract for the Won Discounts storefront foundation (MVP0,
// Task 4). In MVP0 the embed only has to prove it loads: it renders a hidden
// root marker + a JSON config script tag, and loads storefront JS with
// `defer`. It must never touch cart mutation endpoints (SF-1) and must stay
// under the gzip perf budget (SF-2, enforced by perf-budget.contract.test.ts).

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const extensionRoot = path.join(
  appRoot,
  "extensions/won-discounts-storefront",
);

async function readExtension(relativePath: string): Promise<string> {
  return readFile(path.join(extensionRoot, relativePath), "utf8");
}

test("shopify.extension.toml declares a theme app extension with a uid", async () => {
  const toml = await readExtension("shopify.extension.toml");
  assert.match(toml, /type\s*=\s*"theme"/);
  assert.match(toml, /^uid\s*=\s*".+"/m);
});

test("theme extension is an app embed with static storefront assets", async () => {
  const block = await readExtension("blocks/won_discounts_embed.liquid");

  assert.match(block, /"target"\s*:\s*"body"/);
  assert.match(block, /"javascript"\s*:\s*"won-discounts\.js"/);
  assert.match(block, /"stylesheet"\s*:\s*"won-discounts\.css"/);
});

test("embed renders the MVP0 root marker with status and currency", async () => {
  const block = await readExtension("blocks/won_discounts_embed.liquid");

  assert.match(block, /id="won-discounts-root"/);
  assert.match(block, /data-won-discounts-embed/);
  assert.match(block, /data-won-discounts-status="ready"/);
  assert.match(
    block,
    /data-won-discounts-currency="\{\{\s*cart\.currency\.iso_code\s*\}\}"/,
  );
  assert.match(block, /\bhidden\b/);
});

test("embed serves the app-data config as an inline JSON script tag", async () => {
  const block = await readExtension("blocks/won_discounts_embed.liquid");

  assert.match(
    block,
    /<script[^>]+type="application\/json"[^>]+id="won-discounts-config"/,
  );
  // Reads the app-owned $app:won_discounts namespace metafield defensively —
  // falls back to an empty object when the metafield is absent.
  assert.match(block, /app\.metafields\[['"]\$app:won_discounts['"]\]/);
  assert.match(block, /storefront_config/);
  assert.match(block, /\|\s*json/);
  assert.match(block, /==\s*blank/);
  assert.match(block, /'\{\}'|"\{\}"/);
});

test("embed loads storefront JS with defer via the schema, not an inline <script src>", async () => {
  const block = await readExtension("blocks/won_discounts_embed.liquid");
  assert.doesNotMatch(block, /<script[^>]+src=/);
});

test("storefront JS never touches cart mutation endpoints and stays a passive foundation", async () => {
  const javascript = await readExtension("assets/won-discounts.js");

  assert.doesNotMatch(javascript, /\/cart\/(add|change|update)/);
  assert.match(javascript, /window\.WonDiscounts\s*=/);
  assert.match(javascript, /ready:\s*true/);
  assert.match(javascript, /version/);
});

test("storefront JS has an idempotent init guard", async () => {
  const javascript = await readExtension("assets/won-discounts.js");
  // Some marker of "already initialized, bail out" logic.
  assert.match(javascript, /__wonDiscountsInit|WonDiscounts.*ready/s);
});

test("storefront JS parses its config JSON defensively (invalid JSON never throws)", async () => {
  const javascript = await readExtension("assets/won-discounts.js");
  assert.match(javascript, /try\s*\{[\s\S]*JSON\.parse/);
  assert.match(javascript, /catch/);
});

test("block name is a plain literal string, not a translation key", async () => {
  // "Won Discounts" is a brand name, identical in every locale. Using a
  // literal here (instead of t:blocks.won_discounts.name) avoids the
  // theme-editor bug where a missing/mismatched schema-locale entry renders
  // as `missing translation: "t:blo…"` in non-English admin locales (e.g.
  // Czech) — see fix round 2.
  const block = await readExtension("blocks/won_discounts_embed.liquid");
  assert.match(block, /"name"\s*:\s*"Won Discounts"/);
  assert.doesNotMatch(block, /"name"\s*:\s*"t:/);
});

test("locale files stay valid JSON with identical key sets across en/cs/sk", async () => {
  const locales = ["en.default.json", "cs.json", "sk.json"];
  const parsedByLocale: Record<string, unknown> = {};
  for (const locale of locales) {
    parsedByLocale[locale] = JSON.parse(await readExtension(`locales/${locale}`));
  }

  function collectKeys(value: unknown, prefix: string): string[] {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.entries(value as Record<string, unknown>).flatMap(
        ([key, nested]) => collectKeys(nested, prefix ? `${prefix}.${key}` : key),
      );
    }
    return [prefix];
  }

  const [first, ...rest] = locales;
  const firstKeys = collectKeys(parsedByLocale[first], "").sort();
  for (const locale of rest) {
    const keys = collectKeys(parsedByLocale[locale], "").sort();
    assert.deepEqual(
      keys,
      firstKeys,
      `${locale} keys differ from ${first}: ${JSON.stringify(keys)} vs ${JSON.stringify(firstKeys)}`,
    );
  }
});
