import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { sanitizeConfig } from "@won/core/discounts/config";
import { gateConfigForPlan } from "@won/core/discounts/plan-gate";
import { buildStorefrontConfig, type StorefrontConfigV1 } from "@won/core/discounts/storefront-config";

// SPEC-DRIVEN contract for the quantity-tiers app block (MVP 3, Task 4),
// docs/plans/2026-09-30-won-discounts-mvp3.md contracts K3–K8:
//   - blocks/quantity_tiers.liquid: app block, product template only; reads the
//     K5 app-data config, the K3 product metafield (tierRef) and the K4 variant
//     metafield (pdp.max); renders the K8 markup for the selected variant and a
//     JSON of every variant for the script.
//   - assets/won-discounts-tiers.js: readable, no build; keeps the table live
//     from the product form (quantity + variant), K6 count incl. cart items,
//     K8 event; never touches the cart (SF-1).
//   - assets/won-discounts-tiers.css: the four K7 presets, colors/fonts inherited.
// The JS pure logic runs here in a vm against a minimal fake DOM.

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionRoot = path.join(appRoot, "extensions/won-discounts-storefront");
const read = (relativePath: string) => readFile(path.join(extensionRoot, relativePath), "utf8");

const BLOCK = "blocks/quantity_tiers.liquid";
const SCRIPT = "assets/won-discounts-tiers.js";
const STYLES = "assets/won-discounts-tiers.css";
const LOCALES = ["en.default.json", "cs.json", "sk.json"] as const;
const TEXT_KEYS = ["heading", "row_qty", "save_pct", "save_off", "unit", "live", "live_cart", "next"] as const;

function schemaOf(liquid: string): Record<string, unknown> {
  const match = liquid.match(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/);
  assert.ok(match, "the block has a {% schema %}");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

// --- Realistic K5 fixture (what buildStorefrontConfig emits) ------------------------------------

/** Shop in CZK, SK market in EUR; Free-like global set + a Pro cart-counted set on a collection. */
const CONFIG: StorefrontConfigV1 = {
  v: 1,
  cv: "2026-09-30T10:00:00.000Z#7",
  tiers: {
    global: "tiers-global",
    sets: {
      "tiers-global": { count: "product", breaks: [{ min: 3, pct: 10 }, { min: 5, pct: 15 }] },
      "tiers-b2b": {
        count: "cart",
        breaks: [
          { min: 10, off: { CZK: 300, EUR: 12 } },
          { min: 20, off: { CZK: 500 } },
        ],
      },
      "tiers-removed": { count: "line", breaks: [] },
    },
  },
  margin: { on: true, max: 30, col: { "4567": 12 } },
  appearance: { preset: "highlight" },
  texts: { cs: { "tiers.heading": "Kupte víc, zaplaťte míň" } },
};

// Czech texts as the block resolves them (extension locale, merchant override wins).
const TEXTS_CS = {
  save_pct: "−{pct} %",
  save_off: "−{amount}",
  unit: "{price}/ks",
  live: "{qty} ks za {total} ({price}/ks)",
  live_cart: "{qty} ks za {total} ({price}/ks). Počítáme i {cart} ks v košíku.",
  next: "Ještě {count} ks a zaplatíte {price}/ks.",
};

type Variant = { id: number; p: number; m: number; c: number };
type BlockData = {
  v: 1;
  product: number;
  set: string;
  count: "line" | "product" | "cart";
  cur: string;
  fmt: string;
  lang: string;
  sel: number;
  breaks: unknown;
  cart: { p: number; s: number };
  variants: Variant[];
  t: Record<string, string>;
};

/**
 * The data JSON as the Liquid renders it for a product on the global set:
 * raw K5 breaks (the script resolves the cart currency itself) and, per
 * variant, only the RESOLVED max % (K6: pdp.max, else the margin ceiling) —
 * never a cost.
 */
function globalSetData(over: Partial<BlockData> = {}): BlockData {
  return {
    v: 1,
    product: 900,
    set: "tiers-global",
    count: "product",
    cur: "CZK",
    fmt: "{{amount_with_comma_separator}} Kč",
    lang: "cs",
    sel: 901,
    breaks: CONFIG.tiers.sets["tiers-global"].breaks,
    cart: { p: 0, s: 0 },
    variants: [
      { id: 901, p: 1000, m: 30, c: 0 }, // no purchase cost: global max 30 %
      { id: 902, p: 2000, m: 12.5, c: 0 }, // pdp.max 12.5 % (margin lowers the 15 % tier)
    ],
    t: TEXTS_CS,
    ...over,
  };
}

// --- Minimal fake DOM (only what the script uses: simple compound selectors) -----------------------

type Listener = (event: unknown) => void;

class FakeElement {
  tagName: string;
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  ownText = "";
  hidden = false;
  value = "";
  formOverride: FakeElement | null = null;
  ownerDocument: FakeDocument | null = null;
  [key: string]: unknown;

  constructor(tagName: string, attrs: Record<string, string | true> = {}) {
    this.tagName = tagName.toUpperCase();
    for (const [name, value] of Object.entries(attrs)) {
      if (name === "hidden") this.hidden = true;
      else if (name === "value") this.value = String(value);
      else this.attributes.set(name, value === true ? "" : value);
    }
  }
  append(...nodes: Array<FakeElement | string>): this {
    for (const node of nodes) {
      if (typeof node === "string") this.ownText += node;
      else {
        node.parentNode = this;
        this.children.push(node);
      }
    }
    return this;
  }
  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  set textContent(text: string) {
    this.ownText = String(text);
    this.children = [];
  }
  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  get isConnected(): boolean {
    return rootOf(this).tagName === "HTML";
  }
  get form(): FakeElement | null {
    if (this.formOverride) return this.formOverride;
    return this.closest("form");
  }
  contains(other: FakeElement): boolean {
    for (let node: FakeElement | null = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }
  matches(selector: string): boolean {
    return matchesCompound(this, selector);
  }
  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    for (let node = this.parentNode; node; node = node.parentNode) if (node.matches(selector)) return node;
    return null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function rootOf(el: FakeElement): FakeElement {
  let node = el;
  while (node.parentNode) node = node.parentNode;
  return node;
}

/** tag? (.class | [attr] | [attr="v"] | [attr*="v"])* — no combinators, no lists (the script must not need them). */
function matchesCompound(el: FakeElement, selector: string): boolean {
  const re = /^([a-zA-Z]+)?((?:\.[\w-]+|\[[\w-]+(?:\*?=(?:"[^"]*"|'[^']*'))?\])*)$/;
  const match = selector.trim().match(re);
  if (!match) throw new Error(`fake DOM: unsupported selector ${selector}`);
  if (match[1] && match[1].toUpperCase() !== el.tagName) return false;
  const parts = match[2].match(/\.[\w-]+|\[[^\]]+\]/g) ?? [];
  for (const part of parts) {
    if (part.startsWith(".")) {
      const classes = (el.getAttribute("class") ?? "").split(/\s+/);
      if (!classes.includes(part.slice(1))) return false;
      continue;
    }
    const attr = part.slice(1, -1).match(/^([\w-]+)(?:(\*?=)["'](.*)["'])?$/);
    if (!attr) return false;
    const [, name, op, expected] = attr;
    const actual = name === "value" ? el.value : el.getAttribute(name);
    if (actual === null || actual === undefined) return false;
    if (op === "=" && actual !== expected) return false;
    if (op === "*=" && !actual.includes(expected)) return false;
  }
  return true;
}

class FakeDocument {
  readyState = "complete";
  html = new FakeElement("html");
  listeners: Record<string, Array<{ fn: Listener; capture: boolean }>> = {};
  dispatched: Array<{ type: string; detail: unknown }> = [];
  querySelectorAll(selector: string) {
    return this.html.querySelectorAll(selector);
  }
  querySelector(selector: string) {
    return this.html.querySelector(selector);
  }
  addEventListener(type: string, fn: Listener, capture?: boolean) {
    (this.listeners[type] ??= []).push({ fn, capture: Boolean(capture) });
  }
  dispatchEvent(event: { type: string; detail?: unknown }) {
    this.dispatched.push({ type: event.type, detail: event.detail });
    for (const { fn } of this.listeners[event.type] ?? []) fn(event);
    return true;
  }
  /** A DOM event reaching the document (bubbling or captured). */
  fire(type: string, props: Record<string, unknown> = {}) {
    for (const { fn } of this.listeners[type] ?? []) fn({ type, ...props });
  }
}

const h = (tag: string, attrs: Record<string, string | true> = {}, ...children: Array<FakeElement | string>) =>
  new FakeElement(tag, attrs).append(...children);

/** The K8 markup exactly as blocks/quantity_tiers.liquid renders it (before the script runs). */
function tiersBlock(data: BlockData, { preset = "default", rows = [3, 5] }: { preset?: string; rows?: number[] } = {}) {
  return h(
    "div",
    {
      class: `won-tiers won-tiers--${preset}`,
      "data-won-discounts-tiers": true,
      "data-state": "ready",
      "data-set-id": data.set,
      "data-count-mode": data.count,
      "data-preset": preset,
    },
    h("p", { class: "won-tiers__heading" }, "Množstevní sleva"),
    h(
      "ol",
      { class: "won-tiers__list", role: "list" },
      ...rows.map((min) =>
        h(
          "li",
          { class: "won-tiers__row", "data-won-discounts-tier-row": true, "data-min": String(min), "data-active": "false" },
          h("span", { class: "won-tiers__qty" }, `Od ${min} ks`),
          h("span", { class: "won-tiers__save" }, "?"),
          h("span", { class: "won-tiers__unit" }, "?"),
        ),
      ),
    ),
    h("p", { class: "won-tiers__live", "data-won-discounts-live-price": true, "data-unit-cents": "0", "aria-live": "polite" }, "?"),
    h("p", { class: "won-tiers__next", "data-won-discounts-tier-next": true, hidden: true }, ""),
    h("script", { type: "application/json", "data-won-discounts-tiers-data": true }, JSON.stringify(data)),
  );
}

type Timer = { fn: () => void; delay: number };

type TiersApi = {
  version: string;
  offered(breaks: unknown, currency: string): Array<{ min: number; pct?: number; off?: number }>;
  discount(brk: { pct?: number; off?: number }, price: number, max: number): number;
  countOf(mode: string, qty: number, inCart: { v?: number; p?: number; s?: number }): number;
  compute(
    data: BlockData,
    variantId: number | string,
    qty: number,
  ): null | {
    variantId: number;
    qty: number;
    count: number;
    unit: number;
    empty: boolean;
    active: null | { min: number; d: number; unit: number };
    next: null | { min: number; unit: number };
    rows: Array<{ min: number; d: number; unit: number; pct: number | null }>;
  };
  money(cents: number, format: string): string;
  fill(template: string, vars: Record<string, unknown>): string;
  scan(): void;
};

async function boot(document: FakeDocument) {
  const javascript = await read(SCRIPT);
  const timers: Timer[] = [];
  const window: Record<string, unknown> = {};
  class CustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }
  const context = vm.createContext({
    window,
    document,
    CustomEvent,
    setTimeout: (fn: () => void, delay?: number) => timers.push({ fn, delay: delay ?? 0 }),
    clearTimeout: () => timers.splice(0, timers.length),
  });
  vm.runInContext(javascript, context);
  const flush = () => {
    while (timers.length) timers.shift()?.fn();
  };
  return {
    api: window.WonDiscountsTiers as TiersApi,
    timers,
    flush,
    runAgain: () => vm.runInContext(javascript, context),
    // (compared as plain JSON: objects made in the vm realm have another Object.prototype)
    events: () =>
      document.dispatched
        .filter((e) => e.type === "won-discounts:tiers:update")
        .map((e) => plain(e.detail) as Record<string, unknown>),
  };
}

/** Horizon-like product section: the app block renders AFTER the product grid, outside the buy box. */
function horizonPage(data: BlockData) {
  const document = new FakeDocument();
  const qty = h("input", { type: "number", name: "quantity", value: "1" });
  const id = h("input", { type: "hidden", name: "id", value: String(data.sel) });
  const form = h("form", { action: "/cart/add", id: "BuyButtons-ProductForm-main" }, id, h("div", { class: "product-form-buttons" }, qty));
  const block = tiersBlock(data);
  // A quick-add form of ANOTHER product elsewhere on the page must never be picked.
  const otherQty = h("input", { name: "quantity", value: "7" });
  const otherForm = h("form", { action: "/cart/add" }, h("input", { name: "id", value: "555" }), otherQty);
  const section = h(
    "div",
    { class: "shopify-section", id: "shopify-section-template--main" },
    h("div", { class: "product-grid" }, h("div", { class: "product-details" }, form)),
    h("div", { class: "shopify-app-block" }, block),
  );
  document.html.append(h("body", {}, section, h("div", { class: "shopify-section" }, otherForm)));
  return { document, qty, id, form, block };
}

/** Dawn-like: the quantity input sits OUTSIDE the form and is bound with form="…" (input.form). */
function dawnPage(data: BlockData) {
  const document = new FakeDocument();
  const id = h("input", { type: "hidden", name: "id", value: String(data.sel) });
  const form = h("form", { action: "/cart/add", id: "product-form-main" }, id);
  const qty = h("input", { name: "quantity", form: "product-form-main", value: "1" });
  qty.formOverride = form;
  const block = tiersBlock(data);
  const section = h(
    "div",
    { class: "shopify-section" },
    h("product-info", {}, h("div", {}, block), h("quantity-input", {}, qty), h("div", { class: "product-form" }, form)),
  );
  document.html.append(h("body", {}, section));
  return { document, qty, id, form, block };
}

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const rowsOf = (block: FakeElement) => block.querySelectorAll("[data-won-discounts-tier-row]");
const liveOf = (block: FakeElement) => block.querySelector("[data-won-discounts-live-price]") as FakeElement;
const nextOf = (block: FakeElement) => block.querySelector("[data-won-discounts-tier-next]") as FakeElement;
const activeMin = (block: FakeElement) => rowsOf(block).find((r) => r.getAttribute("data-active") === "true")?.getAttribute("data-min") ?? null;

// ================================================================================================
// Liquid block: schema, K3/K4/K5 reads, K6 cart counts, K7 presets, K8 markup
// ================================================================================================

test("quantity_tiers is an app block on the product template with the tiers JS/CSS and one accent color setting", async () => {
  const schema = schemaOf(await read(BLOCK));
  assert.equal(schema.target, "section");
  assert.deepEqual(schema.enabled_on, { templates: ["product"] });
  assert.equal(schema.javascript, "won-discounts-tiers.js");
  assert.equal(schema.stylesheet, "won-discounts-tiers.css");
  assert.equal(typeof schema.name, "string");
  assert.ok(!String(schema.name).startsWith("t:"), "a literal block name (the embed's missing-translation lesson)");
  assert.ok(String(schema.name).length <= 25, "schema names are limited to 25 characters");
  const settings = schema.settings as Array<Record<string, unknown>>;
  assert.equal(settings.length, 1);
  assert.equal(settings[0].id, "accent");
  assert.equal(settings[0].type, "color");
  assert.ok(!("default" in settings[0]), "accent defaults to blank: the theme's own color");
});

test("the block reads the K5 app-data config (plain namespace), K3 tierRef and K4 pdp.max", async () => {
  const liquid = await read(BLOCK);
  assert.match(liquid, /app\.metafields\.won_discounts\.storefront_config\.value/);
  assert.doesNotMatch(liquid, /app\.metafields\[['"]\$app/, "app-data metafields do not use $app (K5)");
  assert.match(liquid, /product\.metafields\[['"]\$app:won_discounts['"]\]\.product\.value/);
  assert.match(liquid, /\.tierRef\b/);
  assert.match(liquid, /cfg\.tiers\.global/, "no tierRef = the global set (K1 step 3)");
  assert.match(liquid, /cfg\.v\s*!=\s*1/, "an unknown config version renders nothing");
  assert.match(liquid, /\.metafields\[['"]\$app:won_discounts['"]\]\.pdp\.value\.max/);
  assert.match(liquid, /cfg\.margin\.on/);
  assert.match(liquid, /marginRefs\.size\s*>\s*4/, "> 4 refs = the strictest ceiling (margin.ts MAX_MARGIN_REFS)");
  assert.match(liquid, /cfg\.margin\.col\[/);
  assert.doesNotMatch(liquid, /cost/i, "a purchase cost never reaches the page");
});

test("K6: cart quantities come from Liquid at render time (line_items_for), never from a cart request", async () => {
  const liquid = await read(BLOCK);
  assert.match(liquid, /cart\s*\|\s*line_items_for:\s*variant\s*\|\s*sum:\s*'quantity'/);
  assert.match(liquid, /cart\s*\|\s*line_items_for:\s*product\s*\|\s*sum:\s*'quantity'/);
  assert.match(liquid, /for item in cart\.items/, "cart mode counts lines whose effective set is the same");
  assert.match(liquid, /cart\.currency\.iso_code/);
});

test("K7: the preset comes from the config; an unknown one falls back to default", async () => {
  const liquid = await read(BLOCK);
  assert.match(liquid, /'default,highlight,chips,tiles'\s*\|\s*split/);
  assert.match(liquid, /cfg\.appearance\.preset/);
  assert.match(liquid, /won-tiers--\{\{\s*preset\s*\}\}/);
  assert.match(liquid, /data-preset="\{\{\s*preset\s*\}\}"/);
});

test("K8: the block renders the contract markup and markers", async () => {
  const liquid = await read(BLOCK);
  for (const marker of [
    'class="won-tiers won-tiers--',
    "data-won-discounts-tiers",
    'data-state="',
    "data-set-id=",
    "data-count-mode=",
    'class="won-tiers__heading"',
    'class="won-tiers__list" role="list"',
    'class="won-tiers__row" data-won-discounts-tier-row data-min=',
    "data-active=",
    'class="won-tiers__qty"',
    'class="won-tiers__save"',
    'class="won-tiers__unit"',
    'class="won-tiers__live" data-won-discounts-live-price data-unit-cents=',
    'aria-live="polite"',
    'class="won-tiers__next" data-won-discounts-tier-next',
    '<script type="application/json" data-won-discounts-tiers-data>',
  ]) {
    assert.ok(liquid.includes(marker), `missing K8 marker: ${marker}`);
  }
  assert.match(liquid, /data-state="empty"/, "no set / no offered break renders an empty, hidden root");
  assert.match(liquid, /--won-tiers-accent:\s*\{\{\s*block\.settings\.accent\s*\}\}/);
  assert.match(liquid, /replace:\s*'<\/',\s*'<\\\/'/, "the data JSON can never close its <script> early");
});

test("block texts: every tiers.* key exists in cs/sk/en with the same placeholders; merchant texts win", async () => {
  const liquid = await read(BLOCK);
  const locales = await Promise.all(LOCALES.map(async (file) => JSON.parse(await read(`locales/${file}`)) as { tiers: Record<string, string> }));
  for (const key of TEXT_KEYS) {
    assert.match(liquid, new RegExp(`'tiers\\.${key}'\\s*\\|\\s*t\\b`), `the block falls back to the locale for tiers.${key}`);
    assert.match(liquid, new RegExp(`tx\\['tiers\\.${key}'\\]`), `a merchant text overrides tiers.${key}`);
    const placeholders = locales.map((l) => {
      assert.equal(typeof l.tiers?.[key], "string", `tiers.${key} missing in a locale`);
      return [...l.tiers[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    });
    assert.equal(new Set(placeholders).size, 1, `tiers.${key} placeholders differ across locales: ${placeholders.join(" | ")}`);
  }
  assert.deepEqual(Object.keys(locales[0].tiers).sort(), [...TEXT_KEYS].sort());
});

test("SF-1: neither the block nor its script can change the cart", async () => {
  for (const file of [BLOCK, SCRIPT]) {
    const source = await read(file);
    // (Reading the product form via the selector form[action*="/cart/add"] is fine; posting is not.)
    assert.doesNotMatch(source, /\/cart\/(add|change|update|clear)\.js/, `${file} names a cart AJAX endpoint`);
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|sendBeacon/, `${file} makes a request`);
    assert.doesNotMatch(source, /\.submit\s*\(|requestSubmit|dispatchEvent\([^)]*submit/, `${file} submits a form`);
  }
});

test("K8 selectors the script uses all exist in the Liquid markup", async () => {
  const [liquid, javascript] = await Promise.all([read(BLOCK), read(SCRIPT)]);
  const attrs = new Set([...javascript.matchAll(/\[(data-won-discounts-[\w-]+)/g)].map((m) => m[1]));
  const classes = new Set([...javascript.matchAll(/"\.(won-tiers[\w-]*)"/g)].map((m) => m[1]));
  assert.ok(attrs.size >= 4, "the script uses the K8 data markers");
  for (const attr of attrs) assert.ok(liquid.includes(attr), `the script reads ${attr}, which the block never renders`);
  for (const cls of classes) assert.ok(liquid.includes(cls), `the script reads .${cls}, which the block never renders`);
});

test("K7 CSS: four presets, theme colors and fonts inherited, accent via --won-tiers-accent, empty hidden", async () => {
  const css = await read(STYLES);
  for (const preset of ["default", "highlight", "chips", "tiles"]) assert.match(css, new RegExp(`\\.won-tiers--${preset}\\b`));
  assert.match(css, /color:\s*inherit/);
  assert.match(css, /font:\s*inherit/);
  assert.match(css, /--won-tiers-accent:\s*currentColor/);
  assert.match(css, /\[data-state="empty"\][^{]*\{[^}]*display:\s*none/);
  assert.match(css, /\[data-active="true"\]/);
  // No color literal: every color derives from the theme's currentColor or the block accent.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(withoutComments, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  assert.doesNotMatch(withoutComments, /font-family:/);
  for (const cls of ["won-tiers__heading", "won-tiers__list", "won-tiers__row", "won-tiers__qty", "won-tiers__save", "won-tiers__unit", "won-tiers__live", "won-tiers__next"]) {
    assert.match(css, new RegExp(`\\.${cls}\\b`), `.${cls} is styled`);
  }
});

// ================================================================================================
// Script: pure logic
// ================================================================================================

/** The merchant config behind CONFIG, as the admin saves it (minor units, GIDs). */
const SHOP_CONFIG = {
  schemaVersion: 1,
  modules: {
    tiers: {
      sets: [
        { id: "tiers-global", scope: "global", countAcross: "product", breaks: [{ minQty: 5, percent: 15 }, { minQty: 3, percent: 10 }] },
        {
          id: "tiers-b2b",
          scope: { collectionIds: ["gid://shopify/Collection/4567"] },
          countAcross: "cart",
          breaks: [{ minQty: 10, amountOff: { CZK: 300, EUR: 12 } }, { minQty: 20, amountOff: { CZK: 500 } }],
        },
      ],
    },
    margin: {
      enabled: true,
      global: { maxDiscountPercent: 30 },
      perCollection: [{ collectionId: "gid://shopify/Collection/4567", maxDiscountPercent: 12 }],
    },
  },
  storefront: { appearancePreset: "highlight" },
  locales: { cs: { "tiers.heading": "Kupte víc, zaplaťte míň" } },
};

test("drift guard: the real K5 builder (@won/core) emits exactly the shape the block and script read", async () => {
  const { config } = sanitizeConfig(SHOP_CONFIG);
  const pro = buildStorefrontConfig(gateConfigForPlan(config, "pro").config, { configVersion: CONFIG.cv });
  const expected = JSON.parse(JSON.stringify(CONFIG)) as StorefrontConfigV1;
  delete (expected.tiers.sets as Record<string, unknown>)["tiers-removed"];
  assert.deepEqual(pro, expected);
  // Free: the scoped set stays but is inert (K1), so its products show no table.
  const free = buildStorefrontConfig(gateConfigForPlan(config, "free").config, { configVersion: CONFIG.cv });
  assert.deepEqual(free.tiers.sets["tiers-b2b"].breaks, []);
  const { api } = await boot(new FakeDocument());
  const inert = globalSetData({ set: "tiers-b2b", count: free.tiers.sets["tiers-b2b"].count, breaks: free.tiers.sets["tiers-b2b"].breaks });
  assert.equal(api.compute(inert, 901, 50)?.empty, true);
});

test("offered(): percent breaks stay; an amount is resolved for the cart currency; no value = not offered (MKT-1)", async () => {
  const { api } = await boot(new FakeDocument());
  const b2b = CONFIG.tiers.sets["tiers-b2b"].breaks;
  assert.deepEqual(plain(api.offered(b2b, "CZK")), [{ min: 10, off: 300 }, { min: 20, off: 500 }]);
  assert.deepEqual(plain(api.offered(b2b, "EUR")), [{ min: 10, off: 12 }]);
  assert.deepEqual(plain(api.offered(b2b, "USD")), []);
  assert.deepEqual(plain(api.offered(CONFIG.tiers.sets["tiers-global"].breaks, "USD")), [
    { min: 3, pct: 10 },
    { min: 5, pct: 15 },
  ]);
  assert.deepEqual(plain(api.offered([{ min: 0, pct: 5 }, null, { min: 2 }, "x"], "CZK")), []);
  assert.deepEqual(plain(api.offered(undefined, "CZK")), []);
});

test("K6 discount per item: min(pct, max) % of the price; min(off, price × max / 100); never above the price", async () => {
  const { api } = await boot(new FakeDocument());
  assert.equal(api.discount({ pct: 10 }, 1000, 100), 100);
  assert.equal(api.discount({ pct: 15 }, 2000, 12.5), 250, "margin lowers 15 % to 12.5 %");
  assert.equal(api.discount({ pct: 10 }, 1235, 100), 124, "rounded like the engine (Math.round)");
  assert.equal(api.discount({ pct: 10 }, 1235, 10), 123, "…but never above the margin ceiling (floor)");
  assert.equal(api.discount({ off: 500 }, 1000, 30), 300, "amount capped at price × max / 100");
  assert.equal(api.discount({ off: 5000 }, 1000, 100), 1000, "an amount never exceeds the item price");
  assert.equal(api.discount({ pct: 10 }, 1000, 0), 0, "max 0 = no discount");
});

test("K6 count: chosen quantity + cart items of the same variant (line) / product / set (cart)", async () => {
  const { api } = await boot(new FakeDocument());
  const inCart = { v: 1, p: 3, s: 8 };
  assert.equal(api.countOf("line", 2, inCart), 3);
  assert.equal(api.countOf("product", 2, inCart), 5);
  assert.equal(api.countOf("cart", 2, inCart), 10);
  assert.equal(api.countOf("line", 2, {}), 2);
  assert.equal(api.countOf("bogus", 2, inCart), 2, "an unknown mode counts only the chosen quantity");
});

test("tier selection: the highest min ≤ count (boundaries 2 / 3 / 4 / 5 items)", async () => {
  const { api } = await boot(new FakeDocument());
  const data = globalSetData({ variants: [{ id: 901, p: 1000, m: 100, c: 0 }] });
  const at = (qty: number) => api.compute(data, 901, qty);
  assert.equal(at(2)?.active, null);
  assert.equal(at(2)?.unit, 1000);
  assert.equal(at(3)?.active?.min, 3);
  assert.equal(at(3)?.unit, 900);
  assert.equal(at(4)?.active?.min, 3);
  assert.equal(at(5)?.active?.min, 5);
  assert.equal(at(5)?.unit, 850);
  assert.equal(at(2)?.next?.min, 3);
  assert.equal(at(4)?.next?.min, 5);
  assert.equal(at(5)?.next, null, "no next tier at the top");
  assert.equal(api.compute(data, 999, 3), null, "an unknown variant renders nothing (fail closed)");
});

test("compute(): items already in the cart count toward the tier (K6) per count mode", async () => {
  const { api } = await boot(new FakeDocument());
  const byProduct = globalSetData({ cart: { p: 2, s: 0 }, variants: [{ id: 901, p: 1000, m: 100, c: 1 }] });
  assert.equal(api.compute(byProduct, 901, 1)?.count, 3);
  assert.equal(api.compute(byProduct, 901, 1)?.active?.min, 3);
  const byLine = { ...byProduct, count: "line" as const };
  assert.equal(api.compute(byLine, 901, 1)?.count, 2, "line mode: only the same variant's items");
  const byCart = { ...byProduct, count: "cart" as const, cart: { p: 2, s: 6 } };
  assert.equal(api.compute(byCart, 901, 1)?.count, 7);
});

test("compute(): margin protection lowers the table and the live price (the value checkout gives)", async () => {
  const { api } = await boot(new FakeDocument());
  const state = api.compute(globalSetData(), 902, 5);
  assert.deepEqual(
    plain(state?.rows.map((r) => [r.min, r.pct, r.d, r.unit])),
    [
      [3, 10, 200, 1800],
      [5, 12.5, 250, 1750],
    ],
  );
  assert.equal(state?.unit, 1750);
  const zero = api.compute(globalSetData({ variants: [{ id: 901, p: 1000, m: 0, c: 0 }] }), 901, 5);
  assert.equal(zero?.empty, true, "nothing to save = empty");
});

test("compute(): an amount off per item follows the cart currency (CZK vs EUR vs a currency without a value)", async () => {
  const { api } = await boot(new FakeDocument());
  const b2b = (cur: string, p: number) =>
    globalSetData({ set: "tiers-b2b", count: "cart", cur, breaks: CONFIG.tiers.sets["tiers-b2b"].breaks, variants: [{ id: 901, p, m: 100, c: 0 }] });
  assert.equal(api.compute(b2b("CZK", 1000), 901, 20)?.unit, 500);
  assert.equal(api.compute(b2b("EUR", 42), 901, 20)?.unit, 30, "EUR offers only the 10+ break (12 per item)");
  assert.equal(api.compute(b2b("USD", 1000), 901, 20)?.empty, true);
  assert.equal(api.compute(b2b("USD", 1000), 901, 20)?.rows.length, 0);
});

test("money(): the theme's money format placeholders, Liquid money units (× 100 for every currency)", async () => {
  const { api } = await boot(new FakeDocument());
  assert.equal(api.money(123456, "${{amount}}"), "$1,234.56");
  assert.equal(api.money(123456, "{{amount_with_comma_separator}} Kč"), "1.234,56 Kč");
  assert.equal(api.money(123456, "{{amount_no_decimals}} Kč"), "1,235 Kč");
  assert.equal(api.money(42, "€{{amount_with_comma_separator}}"), "€0,42");
  assert.equal(api.money(100000, "¥{{ amount_no_decimals }}"), "¥1,000", "JPY: Liquid units are major × 100");
  assert.equal(api.money(123456789, "{{amount_with_space_separator}} Kč"), "1 234 567,89 Kč");
  assert.equal(api.money(123456789, "{{amount_no_decimals_with_space_separator}} Kč"), "1 234 568 Kč");
  assert.equal(api.money(123456789, "{{amount_with_period_and_space_separator}}"), "1 234 567.89");
  assert.equal(api.money(123456789, "CHF {{amount_with_apostrophe_separator}}"), "CHF 1'234'567.89");
  assert.equal(api.money(123456, "{{amount_no_decimals_with_comma_separator}} Kč"), "1.235 Kč");
  assert.equal(api.money(0, "{{amount}}"), "0.00");
  assert.equal(api.money(500, "{{constructor}} {{amount}}"), "{{constructor}} 5.00", "unknown placeholders stay");
  assert.equal(api.money(500, ""), "5.00", "no format = plain amount");
});

test("fill(): {placeholders} are replaced everywhere; unknown ones stay", async () => {
  const { api } = await boot(new FakeDocument());
  assert.equal(api.fill("Od {min} ks, {min}+", { min: 3 }), "Od 3 ks, 3+");
  assert.equal(api.fill("{x} {toString}", {}), "{x} {toString}");
  assert.equal(api.fill(undefined as unknown as string, { a: 1 }), "");
});

// ================================================================================================
// Script: DOM wiring (Horizon + Dawn layouts, variant switch, K8 event)
// ================================================================================================

test("Horizon layout: the block below the product grid still finds the section's form and quantity", async () => {
  const page = horizonPage(globalSetData());
  const { events } = await boot(page.document);
  const { block } = page;
  assert.equal(block.getAttribute("data-state"), "ready");
  assert.equal(block.hidden, false);
  assert.equal(activeMin(block), null);
  assert.equal(liveOf(block).textContent, "1 ks za 10,00 Kč (10,00 Kč/ks)");
  assert.equal(liveOf(block).getAttribute("data-unit-cents"), "1000");
  const rows = rowsOf(block);
  assert.deepEqual(
    rows.map((r) => [r.querySelector(".won-tiers__save")?.textContent, r.querySelector(".won-tiers__unit")?.textContent]),
    [
      ["−10 %", "9,00 Kč/ks"],
      ["−15 %", "8,50 Kč/ks"],
    ],
  );
  assert.equal(nextOf(block).hidden, false);
  assert.equal(nextOf(block).textContent, "Ještě 2 ks a zaplatíte 9,00 Kč/ks.");
  assert.deepEqual(events().at(-1), { variantId: 901, quantity: 1, count: 1, min: 0, unitCents: 1000 });
});

test("Horizon: plus/minus (quantity-selector:update) and typing (input) update the live price and active row", async () => {
  const page = horizonPage(globalSetData());
  const { flush, events } = await boot(page.document);
  page.qty.value = "3";
  page.document.fire("quantity-selector:update");
  flush();
  assert.equal(activeMin(page.block), "3");
  assert.equal(liveOf(page.block).textContent, "3 ks za 27,00 Kč (9,00 Kč/ks)");
  assert.deepEqual(events().at(-1), { variantId: 901, quantity: 3, count: 3, min: 3, unitCents: 900 });
  page.qty.value = "6";
  page.document.fire("input", { target: page.qty });
  flush();
  assert.equal(activeMin(page.block), "5");
  assert.equal(nextOf(page.block).hidden, true);
  assert.equal(events().length, 3, "one event per change");
  page.document.fire("input", { target: page.qty });
  flush();
  assert.equal(events().length, 3, "no event without a change");
});

test("Horizon: shopify:product:select waits for event.promise before rescanning the morphed form", async () => {
  const page = horizonPage(globalSetData());
  const { flush, events } = await boot(page.document);
  let resolve: (value: unknown) => void = () => {};
  const promise = new Promise((r) => (resolve = r));
  page.document.fire("shopify:product:select", { promise });
  // Horizon sets input[name=id] via .value AFTER the fetch; nothing may happen before the promise.
  flush();
  assert.equal(events().length, 1);
  page.id.value = "902";
  resolve({ variant: { id: "gid://shopify/ProductVariant/902" } });
  await promise;
  await Promise.resolve();
  flush();
  assert.equal(events().at(-1)?.variantId, 902);
  assert.deepEqual(
    rowsOf(page.block).map((r) => r.querySelector(".won-tiers__save")?.textContent),
    ["−10 %", "−12,5 %"],
    "variant 902 has pdp.max 12.5: the 15 % row shows the lowered value",
  );
  assert.equal(liveOf(page.block).getAttribute("data-unit-cents"), "2000");
});

test("shopify:product:select without a promise falls back to a debounced rescan", async () => {
  const page = horizonPage(globalSetData());
  const { timers, flush, events } = await boot(page.document);
  page.id.value = "902";
  page.document.fire("shopify:product:select", {});
  assert.ok(timers.some((t) => t.delay > 0), "debounced");
  flush();
  assert.equal(events().at(-1)?.variantId, 902);
});

test("Dawn layout: a quantity input outside the form (input.form) and a change event on input[name=id]", async () => {
  const page = dawnPage(globalSetData({ cart: { p: 2, s: 0 } }));
  const { flush, events } = await boot(page.document);
  assert.equal(activeMin(page.block), "3", "1 chosen + 2 already in the cart (product mode)");
  assert.equal(liveOf(page.block).textContent, "1 ks za 9,00 Kč (9,00 Kč/ks). Počítáme i 2 ks v košíku.");
  page.qty.value = "3";
  page.document.fire("change", { target: page.qty });
  flush();
  assert.equal(activeMin(page.block), "5");
  assert.deepEqual(events().at(-1), { variantId: 901, quantity: 3, count: 5, min: 5, unitCents: 850 });
  page.id.value = "902";
  page.document.fire("change", { target: page.id });
  flush();
  assert.equal(events().at(-1)?.variantId, 902);
  assert.equal(liveOf(page.block).getAttribute("data-unit-cents"), "1750");
});

test("the block outside the product section still finds the product's form by its variant ids", async () => {
  const data = globalSetData();
  const document = new FakeDocument();
  const qty = h("input", { name: "quantity", value: "5" });
  const form = h("form", { action: "/cart/add" }, h("input", { name: "id", value: "901" }), qty);
  const decoyQty = h("input", { name: "quantity", value: "9" });
  const decoy = h("form", { action: "/cart/add" }, h("input", { name: "id", value: "555" }), decoyQty);
  const block = tiersBlock(data);
  document.html.append(
    h("body", {}, h("div", { class: "shopify-section" }, decoy), h("div", { class: "shopify-section" }, form), h("div", { class: "shopify-section" }, block)),
  );
  const { events } = await boot(document);
  assert.equal(events().at(-1)?.quantity, 5);
  assert.equal(activeMin(block), "5");
});

test("no product form at all: the selected variant and quantity 1", async () => {
  const data = globalSetData({ sel: 902 });
  const document = new FakeDocument();
  const block = tiersBlock(data);
  document.html.append(h("body", {}, block));
  const { events } = await boot(document);
  assert.deepEqual(events().at(-1), { variantId: 902, quantity: 1, count: 1, min: 0, unitCents: 2000 });
});

test("a variant whose max is 0 hides the block (data-state=empty); switching back shows it", async () => {
  const data = globalSetData({ variants: [{ id: 901, p: 1000, m: 30, c: 0 }, { id: 902, p: 1000, m: 0, c: 0 }] });
  const page = horizonPage(data);
  const { flush } = await boot(page.document);
  page.id.value = "902";
  page.document.fire("change", { target: page.id });
  flush();
  assert.equal(page.block.getAttribute("data-state"), "empty");
  assert.equal(page.block.hidden, true);
  page.id.value = "901";
  page.document.fire("change", { target: page.id });
  flush();
  assert.equal(page.block.getAttribute("data-state"), "ready");
  assert.equal(page.block.hidden, false);
});

test("a row whose value is 0 for this variant is hidden; the others stay", async () => {
  // A 1 Kč item with max 0.9 %: the ceiling floor(100 × 0.9 / 100) = 0 caps both rows to 0.
  const data = globalSetData({ variants: [{ id: 901, p: 100, m: 0.9, c: 0 }] });
  const page = horizonPage(data);
  await boot(page.document);
  assert.equal(page.block.getAttribute("data-state"), "empty", "every row is 0: nothing visible");
  const data2 = globalSetData({ variants: [{ id: 901, p: 10000, m: 12, c: 0 }], breaks: [{ min: 3, off: { CZK: 0 } }, { min: 5, pct: 15 }] });
  const page2 = horizonPage(data2);
  await boot(page2.document);
  assert.deepEqual(rowsOf(page2.block).map((r) => r.hidden), [true, false]);
});

test("a malformed data JSON never throws and leaves the Liquid render alone", async () => {
  const page = horizonPage(globalSetData());
  const script = page.block.querySelector("[data-won-discounts-tiers-data]") as FakeElement;
  script.textContent = "{not json";
  const { events } = await boot(page.document);
  assert.equal(events().length, 0);
  assert.equal(page.block.getAttribute("data-state"), "ready");
});

test("the script initialises once: a second load keeps the first instance and its listeners", async () => {
  const page = horizonPage(globalSetData());
  const { runAgain, api } = await boot(page.document);
  const before = Object.values(page.document.listeners).reduce((n, list) => n + list.length, 0);
  runAgain();
  const after = Object.values(page.document.listeners).reduce((n, list) => n + list.length, 0);
  assert.equal(after, before);
  assert.equal(typeof api.version, "string");
});

test("the script waits for DOMContentLoaded when the document is still loading", async () => {
  const page = horizonPage(globalSetData());
  page.document.readyState = "loading";
  const { events } = await boot(page.document);
  assert.equal(events().length, 0);
  page.document.fire("DOMContentLoaded");
  assert.equal(events().length, 1);
});
