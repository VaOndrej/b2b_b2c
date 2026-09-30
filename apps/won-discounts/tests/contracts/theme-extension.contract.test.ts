import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

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
  // Audit P3-11: Liquid renders "loading"; only the storefront JS may set
  // "ready", so a "ready" marker proves the JS actually ran (the live E2E waits
  // for it plus window.WonDiscounts.ready).
  assert.match(block, /data-won-discounts-status="loading"/);
  assert.doesNotMatch(block, /data-won-discounts-status="ready"/);
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
  // Reads the K5 app-data metafield (owner AppInstallation) defensively — falls
  // back to an empty object when it is absent. App-data metafields use a PLAIN
  // namespace (shopify.dev "About metafields": the AppInstallation owner gives
  // the isolation, `$app` is not used); `app.metafields['$app:won_discounts']`
  // (MVP 0) never matched the metafield the sync writes (MVP 3 contract K5).
  assert.match(block, /app\.metafields\.won_discounts\.storefront_config\.value/);
  assert.doesNotMatch(block, /app\.metafields\[['"]\$app/);
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

test("MVP 3: the extension ships the embed and the quantity_tiers app block; every schema asset exists", async () => {
  const blocks = (await readdir(path.join(extensionRoot, "blocks"))).filter((f) => f.endsWith(".liquid")).sort();
  // The handle `quantity_tiers` is the file name: the admin deep link (addAppBlockId) and the
  // theme template's block type `shopify://apps/won-discounts/blocks/quantity_tiers/<uuid>` use it.
  assert.deepEqual(blocks, ["quantity_tiers.liquid", "won_discounts_embed.liquid"]);
  for (const file of blocks) {
    const liquid = await readExtension(`blocks/${file}`);
    const schema = JSON.parse(liquid.match(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/)?.[1] ?? "{}");
    for (const key of ["javascript", "stylesheet"] as const) {
      if (!schema[key]) continue;
      await assert.doesNotReject(readExtension(`assets/${schema[key]}`), `${file}: ${key} ${schema[key]} is missing`);
    }
  }
});

/**
 * Every Liquid file of the extension, tokenized the way Shopify's (Ruby) Liquid does:
 * a tag `{% … %}` ends at the FIRST `%}`, an output `{{ … }}` at the FIRST `}` (the
 * tokenizer's VariableIncompleteEnd is /\}\}?/; the variable must then end in `}}`).
 * Theme Check and liquidjs accept `{{ x | replace: '{min}', y }}`, but `shopify app
 * dev` refuses to bundle it ("Variable '{{ … '{min}' was not properly terminated",
 * MVP 3 fix round 2), so this guards what only the real bundler would catch.
 */
async function extensionLiquidFiles(): Promise<Array<{ file: string; source: string }>> {
  const out: Array<{ file: string; source: string }> = [];
  for (const dir of ["blocks", "snippets"]) {
    let names: string[] = [];
    try {
      names = await readdir(path.join(extensionRoot, dir));
    } catch {
      continue;
    }
    for (const name of names.filter((n) => n.endsWith(".liquid"))) {
      out.push({ file: `${dir}/${name}`, source: await readExtension(`${dir}/${name}`) });
    }
  }
  return out;
}

test("Shopify's Liquid tokenizer: no {{ … }} output contains `}` before its closing `}}`", async () => {
  const files = await extensionLiquidFiles();
  assert.ok(files.length >= 2);
  for (const { file, source } of files) {
    const tokens = source.match(/\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}?/g) ?? [];
    for (const token of tokens) {
      if (!token.startsWith("{{")) continue;
      const line = source.slice(0, source.indexOf(token)).split("\n").length;
      assert.ok(token.endsWith("}}"), `${file}:${line}: output tag cut at a '}' inside it: ${token.slice(0, 80)}`);
    }
  }
});

test("Shopify's Liquid tokenizer: no {% … %} tag contains `%}` inside a string", async () => {
  for (const { file, source } of await extensionLiquidFiles()) {
    const tags = source.match(/\{%[\s\S]*?%\}/g) ?? [];
    for (const tag of tags) {
      // `#` lines are comments inside {% liquid %} / {% # %}: apostrophes there are prose.
      const code = tag
        .split("\n")
        .filter((l) => !l.trim().startsWith("#") && !/^\{%-?\s*#/.test(l.trim()))
        .join("\n")
        .replace(/'[^']*'|"[^"]*"/g, "");
      const line = source.slice(0, source.indexOf(tag)).split("\n").length;
      assert.doesNotMatch(code, /['"]/, `${file}:${line}: a tag ends inside a string (a '%}' in a literal?): ${tag.slice(0, 80)}`);
    }
  }
});

test("MVP 3: the embed and the tiers block read the same K5 config path", async () => {
  const [embed, tiers] = await Promise.all([
    readExtension("blocks/won_discounts_embed.liquid"),
    readExtension("blocks/quantity_tiers.liquid"),
  ]);
  const k5 = /app\.metafields\.won_discounts\.storefront_config\.value/;
  assert.match(embed, k5);
  assert.match(tiers, k5);
});

// --- Audit P3-11: the JS, not the Liquid, flips the marker to "ready" ---------------------------

type FakeRoot = {
  attributes: Record<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  __wonDiscountsInit?: boolean;
};

/** Run assets/won-discounts.js against a minimal DOM: the root marker as Liquid renders it. */
async function bootEmbed({ config = "{}", readyState = "complete" }: { config?: string; readyState?: string } = {}) {
  const javascript = await readExtension("assets/won-discounts.js");
  const listeners: Record<string, Array<() => void>> = {};
  const window: Record<string, unknown> = {};
  const statusWhenSet: Array<{ status: string; wonDiscountsReady: unknown }> = [];
  const root: FakeRoot = {
    attributes: { "data-won-discounts-status": "loading" },
    setAttribute(name, value) {
      if (name === "data-won-discounts-status") {
        statusWhenSet.push({ status: value, wonDiscountsReady: (window.WonDiscounts as { ready?: unknown } | undefined)?.ready });
      }
      this.attributes[name] = value;
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
  };
  const document = {
    readyState,
    querySelector: (selector: string) => (selector === "[data-won-discounts-embed]" ? root : null),
    getElementById: (id: string) => (id === "won-discounts-config" ? { textContent: config } : null),
    addEventListener: (event: string, fn: () => void) => {
      (listeners[event] ??= []).push(fn);
    },
  };
  const context = vm.createContext({ window, document, JSON });
  vm.runInContext(javascript, context);
  return {
    root,
    window,
    statusWhenSet,
    fire: (event: string) => (listeners[event] ?? []).forEach((fn) => fn()),
    runAgain: () => vm.runInContext(javascript, context),
  };
}

test("storefront JS turns the Liquid 'loading' marker into 'ready' only after WonDiscounts is initialised", async () => {
  const { root, window, statusWhenSet } = await bootEmbed({ config: '{"hello":"world"}' });
  assert.equal(root.getAttribute("data-won-discounts-status"), "ready");
  const api = window.WonDiscounts as { ready: boolean; config: unknown; version: string };
  assert.equal(api.ready, true);
  assert.deepEqual(api.config, { hello: "world" });
  assert.deepEqual(statusWhenSet, [{ status: "ready", wonDiscountsReady: true }], "ready is set last, exactly once");
});

test("storefront JS waits for DOMContentLoaded when the document is still loading", async () => {
  const embed = await bootEmbed({ readyState: "loading" });
  assert.equal(embed.root.getAttribute("data-won-discounts-status"), "loading", "nothing ran yet");
  embed.fire("DOMContentLoaded");
  assert.equal(embed.root.getAttribute("data-won-discounts-status"), "ready");
});

test("storefront JS still reaches 'ready' with a malformed config and initialises only once", async () => {
  const embed = await bootEmbed({ config: "{not json" });
  assert.equal(embed.root.getAttribute("data-won-discounts-status"), "ready");
  // (compared as JSON: the object comes from the vm realm)
  assert.equal(JSON.stringify((embed.window.WonDiscounts as { config: unknown }).config), "{}");
  embed.runAgain();
  assert.equal(embed.statusWhenSet.length, 1, "the init guard keeps a second load from re-initialising");
});
