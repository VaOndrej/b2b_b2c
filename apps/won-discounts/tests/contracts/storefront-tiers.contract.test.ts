import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { sanitizeConfig, type WonDiscountsConfig } from "@won/core/discounts/config";
import { buildShopFunctionConfig } from "@won/core/discounts/function-payload";
import { currencyExponent } from "@won/core/discounts/money";
import { planCart } from "@won/core/discounts/plan";
import { gateConfigForPlan } from "@won/core/discounts/plan-gate";
import { buildStorefrontConfig, marginKey, pdpFloor, type StorefrontConfigV1 } from "@won/core/discounts/storefront-config";
import { productMetafieldValue, productRuleIndex } from "@won/core/discounts/targeting";

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
const CORE = "assets/won-discounts-tiers-core.js";
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
  removeAttribute(name: string): void {
    this.attributes.delete(name);
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
  /** Per item; `cap` = the variant's per-item ceiling in Liquid money units (K4 v2 / K6). */
  discount(brk: { pct?: number; off?: number }, price: number, cap: number): number;
  lineDiscount(brk: { pct?: number; off?: number }, price: number, cap: number, qty: number, g?: number): number;
  exp(currency: string): number;
  floorUnits(f: number, shopCurrency: string | null, cartCurrency: string, rate: number | null): number | null;
  sampleFormat(sample: string): string | null;
  countOf(mode: string, qty: number, inCart: { v?: number; p?: number; s?: number }): number;
  compute(
    data: BlockData,
    variantId: number | string,
    qty: number,
    rate?: number | null,
  ): null | {
    variantId: number;
    qty: number;
    count: number;
    unit: number;
    total: number;
    empty: boolean;
    active: null | { min: number; d: number; unit: number };
    next: null | { min: number; unit: number };
    rows: Array<{ min: number; d: number; unit: number; pct: number | null }>;
  };
  money(cents: number, format: string): string;
  fill(template: string, vars: Record<string, unknown>): string;
  scan(): void;
};

/**
 * Load the block's two scripts into one vm realm: the schema's script (DOM) and
 * the pure core the block loads with `defer`. Either may run first (both are
 * deferred, in an order the theme decides); `order` picks it.
 */
async function boot(
  document: FakeDocument,
  { order = "core-first", window = {} }: { order?: "core-first" | "main-first"; window?: Record<string, unknown> } = {},
) {
  const [main, core] = await Promise.all([read(SCRIPT), read(CORE)]);
  const timers: Timer[] = [];
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
  for (const source of order === "core-first" ? [core, main] : [main, core]) vm.runInContext(source, context);
  const flush = () => {
    while (timers.length) timers.shift()?.fn();
  };
  /** Run only the timers due within `ms` (time "advances" to ms; later ones stay pending). */
  const flushDue = (ms: number) => {
    for (const t of timers.filter((x) => x.delay <= ms)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  return {
    api: window.WonDiscountsTiers as TiersApi,
    timers,
    flush,
    flushDue,
    runAgain: () => {
      vm.runInContext(main, context);
      vm.runInContext(core, context);
    },
    // (compared as plain JSON: objects made in the vm realm have another Object.prototype)
    events: () =>
      document.dispatched
        .filter((e) => e.type === "won-discounts:tiers:update")
        .map((e) => plain(e.detail) as Record<string, unknown>),
  };
}

/**
 * Horizon-like product section: the app block renders AFTER the product grid, outside the buy box.
 * With `show_installments` the price block renders its own /cart/add form holding the variant id
 * BEFORE the buy form (blocks/price.liquid `product-form-installment-{block.id}`).
 */
function horizonPage(data: BlockData) {
  const document = new FakeDocument();
  const qty = h("input", { type: "number", name: "quantity", value: "1" });
  const id = h("input", { type: "hidden", name: "id", value: String(data.sel) });
  const form = h(
    "form",
    { action: "/cart/add", id: "BuyButtons-ProductForm-main" },
    id,
    h("div", { class: "product-form-buttons" }, qty, h("button", { type: "submit", name: "add" }, "Add")),
  );
  const installmentId = h("input", { type: "hidden", name: "id", value: String(data.sel) });
  const installments = h("form", { action: "/cart/add", id: "product-form-installment-price" }, installmentId, h("shopify-payment-terms"));
  const block = tiersBlock(data);
  // A quick-add form of ANOTHER product elsewhere on the page must never be picked.
  const otherQty = h("input", { name: "quantity", value: "7" });
  const otherForm = h("form", { action: "/cart/add" }, h("input", { name: "id", value: "555" }), otherQty);
  const section = h(
    "div",
    { class: "shopify-section", id: "shopify-section-template--main" },
    h("div", { class: "product-grid" }, h("div", { class: "product-details" }, h("product-price", {}, installments), form)),
    h("div", { class: "shopify-app-block" }, block),
  );
  document.html.append(h("body", {}, section, h("div", { class: "shopify-section" }, otherForm)));
  return { document, qty, id, form, block, installmentId };
}

/**
 * Dawn-like (sections/main-product.liquid): the price block's installment form
 * `product-form-installment-{section}` holds the variant id and comes FIRST; the
 * quantity input sits OUTSIDE the buy form, bound with form="product-form-{section}"
 * (input.form); the block renders between them.
 */
function dawnPage(data: BlockData) {
  const document = new FakeDocument();
  const installmentId = h("input", { type: "hidden", name: "id", value: String(data.sel) });
  const installments = h("form", { action: "/cart/add", id: "product-form-installment-main", class: "installment" }, installmentId);
  const id = h("input", { type: "hidden", name: "id", value: String(data.sel) });
  const form = h(
    "form",
    { action: "/cart/add", id: "product-form-main" },
    id,
    h("div", { class: "product-form__buttons" }, h("button", { type: "submit", name: "add" }, "Add")),
  );
  const qty = h("input", { name: "quantity", form: "product-form-main", value: "1" });
  qty.formOverride = form;
  const block = tiersBlock(data);
  const section = h(
    "div",
    { class: "shopify-section" },
    h(
      "product-info",
      {},
      h("div", { class: "price" }, installments),
      h("div", {}, block),
      h("quantity-input", {}, qty),
      h("div", { class: "product-form" }, form),
    ),
  );
  document.html.append(h("body", {}, section));
  return { document, qty, id, form, block, installmentId };
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

test("the block reads the K5 app-data config (plain namespace), K3 tierRef and K4 v2 pdp {f, k}", async () => {
  const liquid = await read(BLOCK);
  assert.match(liquid, /app\.metafields\.won_discounts\.storefront_config\.value/);
  assert.doesNotMatch(liquid, /app\.metafields\[['"]\$app/, "app-data metafields do not use $app (K5)");
  assert.match(liquid, /product\.metafields\[['"]\$app:won_discounts['"]\]\.product\.value/);
  assert.match(liquid, /\.tierRef\b/);
  assert.match(liquid, /cfg\.tiers\.global/, "no tierRef = the global set (K1 step 3)");
  assert.match(liquid, /cfg\.v\s*!=\s*1/, "an unknown config version renders nothing");
  assert.doesNotMatch(liquid, /pdp\.value\.max/, "K4 v1 (a percent per variant) is gone");
  assert.match(liquid, /v_pdp\.f != nil and v_pdp\.k != nil and v_pdp\.k == cfg\.margin\.k/, "K4 v2: the floor only with the current margin key");
  assert.match(liquid, /cfg\.margin\.on/);
  assert.match(liquid, /marginRefs\.size\s*>\s*4/, "> 4 refs = the strictest ceiling (margin.ts MAX_MARGIN_REFS)");
  assert.match(liquid, /cfg\.margin\.col\[/);
  // The cost mirror (variant metafield `variant`) is only ever tested for existence, never printed (K4 v2).
  const costUses = [...liquid.matchAll(/(\w+)\.variant\b[^\n]*/g)].map((m) => m[0].trim());
  assert.ok(costUses.length >= 2, "the block checks the cost mirror (selected variant + the variants loop)");
  for (const use of costUses) assert.match(use, /^\w*mf\.variant != nil$/, `the cost mirror is only compared with nil: ${use}`);
  assert.doesNotMatch(liquid, /\{\{[^}]*mf\.variant/, "never output");
});

test("K6: cart quantities come from Liquid at render time (line_items_for), never from a cart request", async () => {
  const liquid = await read(BLOCK);
  assert.match(liquid, /for item in product_lines/, "line + product: one pass over the product's lines");
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
  for (const file of [BLOCK, SCRIPT, CORE]) {
    const source = await read(file);
    // (Reading the product form via the selector form[action*="/cart/add"] is fine; posting is not.)
    assert.doesNotMatch(source, /\/cart\/(add|change|update|clear)\.js/, `${file} names a cart AJAX endpoint`);
    // Feedback 3, bod 4: the script may GET a fresh render of its own section after a cart change — nothing else.
    assert.doesNotMatch(source, /XMLHttpRequest|sendBeacon/, `${file} makes a request`);
    if (file !== SCRIPT) assert.doesNotMatch(source, /\bfetch\s*\(/, `${file} makes a request`);
    else {
      assert.equal((source.match(/\bfetch\s*\(/g) ?? []).length, 1, "one request: the section render");
      assert.match(source, /\?section_id=/);
      assert.doesNotMatch(source, /method\s*:|body\s*:|\/cart\.js|\/cart\?/, "a plain GET, never a cart endpoint");
    }
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

test("K6 discount per item (table): the percent rounded DOWN, or the amount; never above the per-item ceiling or the price", async () => {
  const { api } = await boot(new FakeDocument());
  assert.equal(api.discount({ pct: 10 }, 1000, 1000), 100);
  assert.equal(api.discount({ pct: 15 }, 2000, 250), 250, "the ceiling (12.5 % of 2000) lowers 15 %");
  assert.equal(api.discount({ pct: 10 }, 1235, 1235), 123, "per item floored: never more than checkout at any quantity");
  assert.equal(api.discount({ pct: 10 }, 1235, 123), 123);
  assert.equal(api.discount({ off: 500 }, 1000, 300), 300, "an amount capped by the ceiling");
  assert.equal(api.discount({ off: 5000 }, 1000, 1000), 1000, "an amount never exceeds the item price");
  assert.equal(api.discount({ pct: 10 }, 1000, 0), 0, "ceiling 0 = no discount");
});

test("K6 discount per line like the engine: a percent rounds once per line, capped by qty × the per-item ceiling; an amount is per item × qty", async () => {
  const { api } = await boot(new FakeDocument());
  assert.equal(api.lineDiscount({ pct: 10 }, 1235, 1235, 1), 124, "Math.round per line");
  assert.equal(api.lineDiscount({ pct: 15 }, 333, 333, 3), 150, "round(999 × 15 %) = 150, not 3 × 49");
  assert.equal(api.lineDiscount({ pct: 10 }, 1235, 123, 1), 123, "capped by the per-item ceiling");
  assert.equal(api.lineDiscount({ pct: 15 }, 2000, 250, 5), 1250);
  // P2-1: the engine's floor is per item, so the line ceiling is qty × floor(price × max / 100).
  assert.equal(api.lineDiscount({ pct: 20 }, 999, Math.floor((999 * 15) / 100), 3), 447, "9,99 × 3 at max 15 %: 4,47 like checkout, not 4,49");
  assert.equal(api.lineDiscount({ pct: 30 }, 1999, Math.floor((1999 * 12.5) / 100), 7), 1743, "19,99 × 7 at max 12,5 %: 17,43");
  assert.equal(api.lineDiscount({ off: 500 }, 1000, 300, 3), 900, "an amount: the per-item value × qty");
  assert.equal(api.lineDiscount({ off: 5000 }, 1000, 1000, 2), 2000);
  // The per-item figure never promises more than the line gives.
  for (const [price, pct, qty] of [[333, 15, 3], [1235, 10, 7], [999, 12.5, 11], [101, 33, 2]] as const) {
    const line = api.lineDiscount({ pct }, price, price, qty);
    assert.ok(api.discount({ pct }, price, price) * qty <= line, `${price} × ${qty} at ${pct} %`);
  }
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

// ================================================================================================
// Fix round 1 (review of cbb6fac)
// ================================================================================================

test("review 1: Dawn's installment form (price block, first in the DOM) never wins over the buy form", async () => {
  const page = dawnPage(globalSetData());
  const { flush, events } = await boot(page.document);
  page.qty.value = "5";
  page.document.fire("change", { target: page.qty });
  flush();
  assert.equal(activeMin(page.block), "5", "the quantity comes from the input bound to product-form-main");
  assert.deepEqual(events().at(-1), { variantId: 901, quantity: 5, count: 5, min: 5, unitCents: 850 });
  // Dawn's product-info updates BOTH id inputs on a variant change; the buy form's is the one read.
  page.id.value = "902";
  page.document.fire("change", { target: page.id });
  flush();
  assert.equal(events().at(-1)?.variantId, 902);
});

test("review 1: Horizon with show_installments reads the buy form, not the price block's form", async () => {
  const page = horizonPage(globalSetData());
  const { flush, events } = await boot(page.document);
  page.qty.value = "3";
  page.document.fire("quantity-selector:update");
  flush();
  assert.equal(events().at(-1)?.quantity, 3);
  // An installment form alone (no buy form holding our id) is still better than nothing.
  const lone = new FakeDocument();
  const block = tiersBlock(globalSetData());
  lone.html.append(h("body", {}, h("div", { class: "shopify-section" }, h("form", { action: "/cart/add" }, h("input", { name: "id", value: "902" })), block)));
  const second = await boot(lone);
  assert.equal(second.events().at(-1)?.variantId, 902);
});

test("review 2/5/7: Liquid counts only mergeable lines in line mode, skips gift lines, one pass over the product's lines", async () => {
  const liquid = await read(BLOCK);
  assert.doesNotMatch(liquid, /line_items_for:\s*(variant|v)\b/, "no per-variant cart scan (O(variants × lines)) and no all-lines sum");
  assert.equal(liquid.match(/line_items_for:/g)?.length, 1, "one pass: cart | line_items_for: product");
  assert.match(liquid, /cart\s*\|\s*line_items_for:\s*product\b/);
  assert.match(liquid, /item\.properties\s*==\s*empty/, "a line with properties is not the one an add merges into");
  assert.match(liquid, /item\.selling_plan_allocation\s*==\s*nil/, "…nor a subscription line");
  assert.match(liquid, /product\.selling_plan_groups\.size\s*==\s*0/, "a product with selling plans: no cart count in line mode");
  assert.equal(liquid.match(/item\.properties\['_won_gift'\]/g)?.length, 2, "gift lines skipped in the product and the cart pass");
});

test("review 3: a cart change zeroes the cart counts (Horizon standard event, older cart:update)", async () => {
  for (const signal of ["shopify:cart:lines-update", "cart:update"]) {
    const page = horizonPage(globalSetData({ cart: { p: 2, s: 0 }, variants: [{ id: 901, p: 1000, m: 100, c: 2 }] }));
    const { flush, events } = await boot(page.document);
    assert.equal(activeMin(page.block), "3");
    assert.match(liveOf(page.block).textContent, /Počítáme i 2/);
    page.document.fire(signal, { promise: Promise.resolve() });
    // (bod 4: the theme's own cart request is awaited first; this page has no fetch, so the counts are zeroed)
    await Promise.resolve();
    await Promise.resolve();
    flush();
    assert.equal(activeMin(page.block), null, `${signal}: count = the chosen quantity only`);
    assert.equal(liveOf(page.block).textContent, "1 ks za 10,00 Kč (10,00 Kč/ks)", `${signal}: the cart note is gone`);
    assert.deepEqual(events().at(-1), { variantId: 901, quantity: 1, count: 1, min: 0, unitCents: 1000 });
  }
});

test("review 3: Dawn's pubsub cart-update zeroes the counts, also when pubsub.js loads after the block script", async () => {
  const subscribers: Record<string, Array<() => void>> = {};
  const window: Record<string, unknown> = {};
  const page = dawnPage(globalSetData({ cart: { p: 4, s: 0 } }));
  page.document.readyState = "interactive"; // deferred scripts run before DOMContentLoaded
  const { flush } = await boot(page.document, { window });
  assert.equal(activeMin(page.block), "5", "1 + 4 in the cart");
  window.subscribe = (name: string, cb: () => void) => (subscribers[name] ??= []).push(cb);
  page.document.fire("DOMContentLoaded");
  assert.equal(subscribers["cart-update"]?.length, 1, "hooked once pubsub exists");
  subscribers["cart-update"][0]();
  flush();
  assert.equal(activeMin(page.block), null);
  page.document.fire("click");
  flush();
  assert.equal(subscribers["cart-update"].length, 1, "never subscribed twice");
});

test("review 3: after zeroing, a fresh Liquid render of the block brings its own cart counts back", async () => {
  const page = horizonPage(globalSetData({ cart: { p: 2, s: 0 } }));
  const { flush } = await boot(page.document);
  page.document.fire("cart:update");
  flush();
  assert.equal(activeMin(page.block), null);
  const script = page.block.querySelector("[data-won-discounts-tiers-data]") as FakeElement;
  script.textContent = JSON.stringify(globalSetData({ cart: { p: 4, s: 0 } }));
  page.document.fire("shopify:section:load");
  flush();
  assert.equal(activeMin(page.block), "5");
});

// --- Feedback 3, bod 4: the table follows the cart without a page load -------------------------------------
// After a cart change the block asks Shopify for a fresh render of ITS OWN section (the same Liquid that counted
// the cart at page load: one source of truth) and takes only its data from it. No request at page load.

/** A fake `fetch` of the section render: records the URLs, answers when the test says so. */
function sectionFetch() {
  const calls: { url: string; init: unknown; answer: (data: BlockData | null, ok?: boolean) => Promise<void> }[] = [];
  const fetch = (url: string, init?: unknown) =>
    new Promise((resolve) => {
      calls.push({
        url,
        init,
        answer: async (data, ok = true) => {
          const html = data ? `<div data-won-discounts-tiers><script type="application/json" data-won-discounts-tiers-data>${JSON.stringify(data)}</script></div>` : "<div></div>";
          resolve({ ok, status: ok ? 200 : 500, text: async () => html });
          // Let the script's promise chain run.
          for (let i = 0; i < 6; i += 1) await Promise.resolve();
        },
      });
    });
  return { fetch, calls };
}
const productWindow = (fetch: unknown): Record<string, unknown> => ({ fetch, location: { pathname: "/products/mikina", search: "?variant=901" } });

test("bod 4: after a cart change the block re-reads its own section and counts the items now in the cart (no page load)", async () => {
  for (const signal of ["shopify:cart:lines-update", "cart:update"]) {
    const { fetch, calls } = sectionFetch();
    const page = horizonPage(globalSetData());
    const { flush, events } = await boot(page.document, { window: productWindow(fetch) });
    assert.equal(calls.length, 0, "no request at page load");
    assert.match(nextOf(page.block).textContent, /^Ještě\s2\sks\sa\szaplatíte\s9,00\sKč\/ks\.$/);

    // 2 pieces added from the product page: the theme says the cart changed.
    page.document.fire(signal);
    flush();
    assert.equal(calls.length, 1, signal);
    assert.equal(calls[0].url, "/products/mikina?section_id=template--main&variant=901", "its own section, the chosen variant");
    assert.equal(calls[0].init, undefined, "a plain GET");
    await calls[0].answer(globalSetData({ cart: { p: 2, s: 0 }, variants: [{ id: 901, p: 1000, m: 30, c: 2 }, { id: 902, p: 2000, m: 12.5, c: 0 }] }));
    flush();
    assert.equal(activeMin(page.block), "3", "1 chosen + 2 in the cart reach 'od 3 ks'");
    assert.match(liveOf(page.block).textContent, /Počítáme i 2/);
    assert.match(nextOf(page.block).textContent, /^Ještě\s2\sks\sa\szaplatíte\s8,50\sKč\/ks\.$/, "to the next tier, from the cart + the quantity field");
    assert.deepEqual(events().at(-1), { variantId: 901, quantity: 1, count: 3, min: 3, unitCents: 900 });
  }
});

test("bod 4: piece by piece — 1 in the cart says 'Ještě 1 ks', 2 in the cart make 'od 3 ks' active, an emptied cart goes back", async () => {
  const { fetch, calls } = sectionFetch();
  const page = horizonPage(globalSetData());
  const { flush } = await boot(page.document, { window: productWindow(fetch) });
  const withCart = (n: number) => globalSetData({ cart: { p: n, s: 0 }, variants: [{ id: 901, p: 1000, m: 30, c: n }, { id: 902, p: 2000, m: 12.5, c: 0 }] });
  page.document.fire("cart:update");
  flush();
  await calls[0].answer(withCart(1));
  flush();
  assert.equal(activeMin(page.block), null);
  assert.match(nextOf(page.block).textContent, /^Ještě\s1\sks\sa\szaplatíte\s9,00\sKč\/ks\.$/);
  page.document.fire("cart:update");
  flush();
  await calls[1].answer(withCart(2));
  flush();
  assert.equal(activeMin(page.block), "3");
  // Removed in the cart drawer: back to the quantity field alone.
  page.document.fire("cart:update");
  flush();
  await calls[2].answer(withCart(0));
  flush();
  assert.equal(activeMin(page.block), null);
  assert.match(liveOf(page.block).textContent, /^1\sks\sza\s10,00\sKč\s\(10,00\sKč\/ks\)$/);
});

test("bod 4: the theme's own cart request is awaited (event.promise); the old counts stay until the answer; only the latest answer counts", async () => {
  const { fetch, calls } = sectionFetch();
  const page = horizonPage(globalSetData({ cart: { p: 2, s: 0 }, variants: [{ id: 901, p: 1000, m: 30, c: 2 }, { id: 902, p: 2000, m: 12.5, c: 0 }] }));
  const { flush } = await boot(page.document, { window: productWindow(fetch) });
  assert.equal(activeMin(page.block), "3");
  let done: () => void = () => undefined;
  page.document.fire("shopify:cart:lines-update", { promise: new Promise<void>((resolve) => (done = resolve)) });
  flush();
  assert.equal(calls.length, 0, "not before the theme's cart request finished");
  assert.equal(activeMin(page.block), "3", "nothing flickers to a wrong state meanwhile");
  done();
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
  assert.equal(calls.length, 1);
  // A second change before the first answer: the first answer is stale and is dropped.
  page.document.fire("cart:update");
  flush();
  assert.equal(calls.length, 2);
  await calls[0].answer(globalSetData({ cart: { p: 9, s: 0 }, variants: [{ id: 901, p: 1000, m: 30, c: 9 }, { id: 902, p: 2000, m: 12.5, c: 0 }] }));
  flush();
  assert.equal(activeMin(page.block), "3", "a stale answer changes nothing");
  await calls[1].answer(globalSetData({ cart: { p: 4, s: 0 }, variants: [{ id: 901, p: 1000, m: 30, c: 4 }, { id: 902, p: 2000, m: 12.5, c: 0 }] }));
  flush();
  assert.equal(activeMin(page.block), "5");
});

test("bod 4: when the section cannot be read (a failed request, no section id, no fetch) the cart counts are zeroed — never more than checkout gives", async () => {
  const stored = () => globalSetData({ cart: { p: 2, s: 0 }, variants: [{ id: 901, p: 1000, m: 30, c: 2 }, { id: 902, p: 2000, m: 12.5, c: 0 }] });
  // A failed request.
  const { fetch, calls } = sectionFetch();
  const page = horizonPage(stored());
  const { flush } = await boot(page.document, { window: productWindow(fetch) });
  page.document.fire("cart:update");
  flush();
  await calls[0].answer(null, false);
  flush();
  assert.equal(activeMin(page.block), null);
  // The fresh render has no table for this product any more (the set was removed meanwhile).
  const gone = sectionFetch();
  const page2 = horizonPage(stored());
  const run2 = await boot(page2.document, { window: productWindow(gone.fetch) });
  page2.document.fire("cart:update");
  run2.flush();
  await gone.calls[0].answer(null);
  run2.flush();
  assert.equal(activeMin(page2.block), null);
  // Dawn-like page whose section has no id: nothing to ask for.
  const none = sectionFetch();
  const dawn = dawnPage(stored());
  const run3 = await boot(dawn.document, { window: productWindow(none.fetch) });
  dawn.document.fire("cart:update");
  run3.flush();
  assert.equal(none.calls.length, 0);
  assert.equal(activeMin(dawn.block), null);
});

test("bod 4: Dawn's pubsub cart-update re-reads the section too", async () => {
  const { fetch, calls } = sectionFetch();
  const subscribers: Record<string, Array<() => void>> = {};
  const window = { ...productWindow(fetch), subscribe: (name: string, cb: () => void) => (subscribers[name] ??= []).push(cb) };
  const page = horizonPage(globalSetData());
  const { flush } = await boot(page.document, { window });
  subscribers["cart-update"][0]();
  flush();
  assert.equal(calls.length, 1);
  await calls[0].answer(globalSetData({ cart: { p: 4, s: 0 }, variants: [{ id: 901, p: 1000, m: 30, c: 4 }, { id: 902, p: 2000, m: 12.5, c: 0 }] }));
  flush();
  assert.equal(activeMin(page.block), "5");
});

test("review 4: the live total rounds per line like the engine; the per-item figures never promise more", async () => {
  const data = globalSetData({ breaks: [{ min: 3, pct: 15 }], variants: [{ id: 901, p: 333, m: 100, c: 0 }] });
  const page = horizonPage(data);
  const { flush } = await boot(page.document);
  page.qty.value = "3";
  page.document.fire("input", { target: page.qty });
  flush();
  // round(999 × 15 %) = 150 → 8,49 Kč for 3; per item 333 − floor(150 / 3) = 283.
  assert.equal(liveOf(page.block).textContent, "3 ks za 8,49 Kč (2,83 Kč/ks)");
  assert.equal(liveOf(page.block).getAttribute("data-unit-cents"), "283");
  // The table's per-item figure: floor(333 × 15 %) = 49 → 2,84 Kč.
  assert.equal(rowsOf(page.block)[0].querySelector(".won-tiers__unit")?.textContent, "2,84 Kč/ks");
});

test("review 6: a click never shortens the pending rescan of a promise-less product:select", async () => {
  const page = horizonPage(globalSetData());
  const { timers, flushDue, flush, events } = await boot(page.document);
  const before = events().length;
  page.document.fire("shopify:product:select", {});
  page.document.fire("click");
  flushDue(0); // the click's moment: nothing may rescan yet
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 300);
  page.id.value = "902"; // the theme swaps the variant within the 300 ms
  flush();
  assert.equal(events().length, before + 1);
  assert.equal(events().at(-1)?.variantId, 902);
});

test("the two block scripts work whichever loads first (both are deferred)", async () => {
  for (const order of ["core-first", "main-first"] as const) {
    const page = horizonPage(globalSetData());
    const { api, events } = await boot(page.document, { order });
    assert.equal(typeof api?.compute, "function", `${order}: the API is there`);
    assert.equal(events().length, 1, `${order}: one initial render`);
    assert.equal(page.block.getAttribute("data-state"), "ready");
  }
  const liquid = await read(BLOCK);
  assert.match(liquid, /<script src="\{\{ 'won-discounts-tiers-core\.js' \| asset_url \}\}" defer><\/script>/);
});

// ================================================================================================
// Audit fix (audit-mvp3.md P1-1, P2-1, P3-7, P3-8, Open question 1; contract K4 v2)
// ================================================================================================

test("K4 v2: the script's currency exponents are core's (money.ts currencyExponent)", async () => {
  const { api } = await boot(new FakeDocument());
  const codes = "BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF BHD IQD JOD KWD LYD OMR TND CZK EUR USD HUF PLN GBP CHF SEK".split(" ");
  for (const code of codes) assert.equal(api.exp(code), currencyExponent(code), code);
  assert.equal(api.exp("jpy"), 0);
});

test("K4 v2: floorUnits — f as is in the shop currency; another currency: ceil(f × rate × 10^exp / 10^exp_shop) + 1 minor unit; no rate = nothing", async () => {
  const { api } = await boot(new FakeDocument());
  assert.equal(api.floorUnits(75000, "CZK", "CZK", null), 75000);
  assert.equal(api.floorUnits(875, "JPY", "JPY", null), 87500, "Liquid counts yen × 100");
  assert.equal(api.floorUnits(75000, "CZK", "EUR", 0.0415531865), Math.ceil(75000 * 0.0415531865) + 1);
  assert.equal(api.floorUnits(75000, "CZK", "JPY", 6.2), (Math.ceil((75000 * 6.2) / 100) + 1) * 100);
  assert.equal(api.floorUnits(75000, "CZK", "EUR", null), null, "no usable rate: nothing is promised");
  assert.equal(api.floorUnits(75000, "CZK", "EUR", 0), null);
  assert.equal(api.floorUnits(75000, "CZK", "EUR", Number.NaN), null);
  assert.equal(api.floorUnits(75000, null, "CZK", null), null, "a storefront config without margin.cur: nothing");
});

test("K4 v2: compute — floor path (price − floor), foreign currency with/without the rate, a cost without a usable pdp = no table", async () => {
  const { api } = await boot(new FakeDocument());
  const base = globalSetData({ sc: "CZK", variants: [{ id: 901, p: 1000, c: 0, f: 950 } as unknown as Variant] } as Partial<BlockData>);
  // Ceiling 50 per item: 10 % (100) is capped to 50 → the row says the 5 % it really gives.
  const st = api.compute(base, 901, 3);
  assert.deepEqual(plain(st?.rows.map((r) => [r.min, r.d, r.pct])), [[3, 50, 5], [5, 50, 5]]);
  assert.equal(st?.total, 3000 - 150, "line ceiling = qty × (price − floor)");
  // EUR market: the floor converts with Shopify's rate (here 1 CZK = 0.04 EUR): 950 × 0.04 → 38 + 1 = 39.
  const eur = { ...base, cur: "EUR", variants: [{ id: 901, p: 42, c: 0, f: 950 }] } as unknown as BlockData;
  assert.equal(api.compute(eur, 901, 3, 0.04)?.rows[0].d, 3, "42 − 39 = 3 per item");
  assert.equal(api.compute(eur, 901, 3, null), null, "no rate: nothing is promised");
  // A cost but no pdp of the current margin key: the Liquid gives the variant neither f nor m.
  const none = { ...base, variants: [{ id: 901, p: 1000, c: 0 }] } as unknown as BlockData;
  assert.equal(api.compute(none, 901, 3), null);
});

test("P2-1: the percent ceiling per LINE is qty × floor(price × max / 100) (the engine's floor is per item)", async () => {
  const { api } = await boot(new FakeDocument());
  const data = globalSetData({ breaks: [{ min: 3, pct: 20 }], variants: [{ id: 901, p: 999, m: 15, c: 0 }] });
  assert.equal(api.compute(data, 901, 3)?.total, 2997 - 447, "9,99 × 3 at max 15 %: 4,47 off like checkout (was 4,49)");
});

test("K4 v2 in the page: the script reads Shopify.currency for a floor in another currency; without it the block stays hidden", async () => {
  const data = globalSetData({ cur: "EUR", sc: "CZK", fmt: "€{{amount_with_comma_separator}}", variants: [{ id: 901, p: 4200, c: 0, f: 95000 }] } as unknown as Partial<BlockData>);
  const page = horizonPage(data);
  await boot(page.document, { window: { Shopify: { currency: { active: "EUR", rate: "0.04" } } } });
  assert.equal(page.block.getAttribute("data-state"), "ready");
  // Floor 95000 × 0.04 = 3800 + 1 = 3801 → ceiling 399 per item.
  assert.deepEqual(rowsOf(page.block).map((r) => r.querySelector(".won-tiers__save")?.textContent), ["−9,5 %", "−9,5 %"]);
  const noRate = horizonPage(data);
  await boot(noRate.document, { window: { Shopify: { currency: { active: "CZK", rate: "1.0" } } } });
  assert.equal(noRate.block.getAttribute("data-state"), "empty", "the active currency is not the cart's: no usable rate");
  assert.equal(noRate.block.hidden, true);
});

test("P3-7: the active row carries aria-current=\"true\" (Liquid and script), and only it", async () => {
  const liquid = await read(BLOCK);
  assert.match(liquid, /\{% if b\.min == act_min %\} aria-current="true"\{% endif %\}/);
  const page = horizonPage(globalSetData());
  const { flush } = await boot(page.document);
  page.qty.value = "3";
  page.document.fire("input", { target: page.qty });
  flush();
  assert.deepEqual(rowsOf(page.block).map((r) => r.getAttribute("aria-current")), ["true", null]);
  page.qty.value = "5";
  page.document.fire("input", { target: page.qty });
  flush();
  assert.deepEqual(rowsOf(page.block).map((r) => r.getAttribute("aria-current")), [null, "true"]);
});

test("P3-8: tierRef like the engine — absent = the global set; any string (\"\", \"~\") = that exact set or no table", async () => {
  const liquid = await read(BLOCK);
  assert.match(liquid, /assign set_id = pmf\.tierRef\s+if set_id == nil\s+assign set_id = cfg\.tiers\.global/);
  assert.match(liquid, /if cfg\.v != 1 or set_id == nil/);
  assert.doesNotMatch(liquid, /set_id == blank|tierRef\s*\|\s*default/, "never `blank` / `default` (they turn \"\" into the global set)");
  assert.match(liquid, /assign item_set = item\.product\.metafields\['\$app:won_discounts'\]\.product\.value\.tierRef\s+if item_set == nil/);
});

test("K4 v2 Liquid: in another currency nothing margin-dependent is printed; the data carries sc + the floor; the cost mirror is never printed", async () => {
  const liquid = await read(BLOCK);
  assert.match(liquid, /if cur == cfg\.margin\.cur[\s\S]*?else\s+assign path = 'defer'/);
  assert.match(liquid, /unless print_values\s+assign save_text = ''\s+assign unit_text = ''/);
  assert.match(liquid, /\{%- unless print_values -%\}[\s\S]*?assign live_text = ''/);
  assert.match(liquid, /if any_save and print_values/);
  assert.match(liquid, /assign sc_json = 'null'\s+if cfg\.margin\.cur != nil\s+assign sc_json = cfg\.margin\.cur \| json/);
  assert.match(liquid, /"sc":\{\{ sc_json \}\}/, "valid JSON even without margin.cur (an older config, margin off)");
  assert.match(liquid, /assign v_cap = ',"f":' \| append: vv_pdp\.f/);
  assert.match(liquid, /elsif vv_mf\.variant != nil\s+assign v_cap = ''/, "a cost without a usable pdp: neither f nor m");
});

test("Open question 1: money is formatted in the ACTIVE currency, read from Liquid's own `money` sample", async () => {
  const { api } = await boot(new FakeDocument());
  const cases: Array<[string, string, number, string]> = [
    ["1 234 567,89 Kč", "{{amount_with_space_separator}} Kč", 123450, "1 234,50 Kč"],
    ["€1.234.567,89", "€{{amount_with_comma_separator}}", 4200, "€42,00"],
    ["$1,234,567.89", "${{amount}}", 99, "$0.99"],
    ["¥1,234,568", "¥{{amount_no_decimals}}", 100000, "¥1,000"],
    ["1.234.568 Kč", "{{amount_no_decimals_with_comma_separator}} Kč", 123456700, "1.234.567 Kč"],
    ["1 234 568 Ft", "{{amount_no_decimals_with_space_separator}} Ft", 500000, "5 000 Ft"],
    ["CHF 1'234'567.89", "CHF {{amount_with_apostrophe_separator}}", 123450, "CHF 1'234.50"],
    ["1 234 567,89 Kč", "{{amount_with_space_separator}} Kč", 50, "0,50 Kč"],
  ];
  for (const [sample, format, cents, shown] of cases) {
    assert.equal(api.sampleFormat(sample), format, sample);
    assert.equal(api.money(cents, format), shown, sample);
  }
  for (const odd of ["", "free", "1234567,89 Kč", "12,34 €"]) assert.equal(api.sampleFormat(odd), null, `unusual sample: ${odd}`);
  // In the page: the EUR sample wins over a shop.money_format that is the shop currency's (CZK).
  const page = horizonPage(globalSetData({ cur: "EUR", ms: "€1.234.567,89", fmt: "{{amount_with_comma_separator}} Kč" } as unknown as Partial<BlockData>));
  await boot(page.document);
  assert.equal(liveOf(page.block).textContent, "1 ks za €10,00 (€10,00/ks)");
  const fallback = horizonPage(globalSetData({ ms: "" } as unknown as Partial<BlockData>));
  await boot(fallback.document);
  assert.equal(liveOf(fallback.block).textContent, "1 ks za 10,00 Kč (10,00 Kč/ks)", "no usable sample: shop.money_format");
  const liquid = await read(BLOCK);
  assert.match(liquid, /"ms":\{\{ 123456789 \| money \| strip_html \| json \}\}/);
});

test("drift guard (K4 v2): the builder's margin carries k + cur; a pdp of that key is the floor path, another key is not", async () => {
  const config = sanitizeConfig(SHOP_CONFIG).config;
  const sf = buildStorefrontConfig(gateConfigForPlan(config, "pro").config, { configVersion: CONFIG.cv, shopCurrency: "CZK" });
  assert.ok(sf.margin.on);
  assert.equal(sf.margin.cur, "CZK");
  assert.equal(sf.margin.k, marginKey(config.modules.margin, "CZK"));
  const pdp = pdpFloor({ unitCost: 6, costCurrency: "CZK", shopCurrency: "CZK", margin: config.modules.margin, collectionIds: [] });
  assert.ok(pdp && pdp.k === sf.margin.k, "the pdp the sync writes matches the storefront config's key");
});

// --- Property: PDP ≤ checkout (planCart) -------------------------------------------------------------

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}

const PROP_COLLECTIONS = ["gid://shopify/Collection/1", "gid://shopify/Collection/2", "gid://shopify/Collection/3"];

/** The block's per-variant ceiling exactly as quantity_tiers.liquid resolves it (K4 v2 + the margin percent ceiling). */
function liquidVariant(sf: StorefrontConfigV1, pdp: { f: number; k: string } | null, hasCost: boolean, marginRefs: readonly string[], p: number) {
  if (!sf.margin.on) return { id: 1, p, c: 0, m: 100 };
  if (pdp && pdp.k === sf.margin.k) return { id: 1, p, c: 0, f: pdp.f };
  if (hasCost) return { id: 1, p, c: 0 }; // fail closed
  let cap = sf.margin.max;
  const col = sf.margin.col ?? {};
  if (marginRefs.length > 4) for (const v of Object.values(col)) cap = Math.min(cap, v);
  else {
    const hits = marginRefs.filter((r) => r in col).map((r) => col[r]);
    if (hits.length > 0) cap = Math.min(...hits);
  }
  return { id: 1, p, c: 0, m: Math.max(0, Math.min(100, cap)) };
}

test("property: the PDP line discount (won-discounts-tiers-core.js) ≤ planCart's tier on the same line — equal when nothing is capped", async () => {
  const { api } = await boot(new FakeDocument());
  const r = rng(20261001);
  const CURRENCIES = ["CZK", "EUR", "HUF", "JPY"];
  let capped = 0, foreign = 0, costPath = 0, equal = 0;
  for (let n = 0; n < 1500; n++) {
    const shop = r.pick(CURRENCIES);
    const cart = r.chance(0.35) ? shop : r.pick(CURRENCIES);
    const rate = cart === shop ? 1 : Math.exp((r.next() - 0.5) * 10) * (1 + r.next());
    const qty = r.int(1, 9);
    const percent = r.chance(0.6);
    const breaks = percent
      ? [{ minQty: 1, percent: r.pick([5, 10, 12.5, 14.95, 20, 33.3, 50, 90]) }]
      : [{ minQty: 1, amountOff: { [cart]: r.int(1, 200_000) } }];
    const marginOn = r.chance(0.8);
    const margin = {
      enabled: marginOn,
      global: { ...(r.chance(0.7) ? { minMarginPercent: r.pick([0, 5, 12.5, 20, 33.3, 60]) } : {}), maxDiscountPercent: r.pick([0, 9.9, 12.5, 15, 37.5, 50, 100]) },
      perCollection: PROP_COLLECTIONS.filter(() => r.chance(0.3)).map((collectionId) => ({
        collectionId,
        ...(r.chance(0.6) ? { minMarginPercent: r.pick([0, 15, 25, 50]) } : {}),
        ...(r.chance(0.6) ? { maxDiscountPercent: r.pick([5, 12.5, 30, 90]) } : {}),
      })),
    };
    const config: WonDiscountsConfig = sanitizeConfig({
      modules: { margin, tiers: { sets: [{ id: "g", scope: "global", countAcross: "line", breaks }] } },
    }).config;
    const collectionIds = PROP_COLLECTIONS.filter(() => r.chance(0.4));
    const hasCost = marginOn && r.chance(0.6);
    const unitCost = hasCost ? r.int(1, 2_000_000) / 10 ** currencyExponent(shop) : undefined;
    const price = r.int(1, 3_000_000); // minor units of the cart currency: a market's own price (price list)
    const entry = productMetafieldValue(productRuleIndex(config, [{ productId: "gid://shopify/Product/1", variantIds: [], collectionIds }]).get("gid://shopify/Product/1")!);

    const plan = planCart(
      {
        currency: cart,
        shopToCartRate: rate,
        enteredCodes: [],
        today: "2026-10-01",
        lines: [
          {
            id: "L1",
            variantId: "gid://shopify/ProductVariant/1",
            productId: "gid://shopify/Product/1",
            quantity: qty,
            unitPrice: price,
            ruleIds: [],
            ...(entry.marginRefs ? { marginRefs: entry.marginRefs } : {}),
            ...(unitCost !== undefined ? { unitCost, unitCostCurrency: shop } : {}),
          },
        ],
      },
      buildShopFunctionConfig(config, { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague", shopCurrency: shop }).payload,
    );
    const checkout = plan.lines[0].product?.amount ?? 0;
    if (plan.lines[0].marginCapped) capped++;

    // The PDP: the storefront config + the variant's pdp as the sync writes them, the block's data, the script.
    const sf = buildStorefrontConfig(config, { configVersion: "v", shopCurrency: shop });
    const pdp = hasCost ? pdpFloor({ unitCost, costCurrency: shop, shopCurrency: shop, margin: config.modules.margin, collectionIds }) : null;
    const toLiquid = (minor: number) => (minor * 100) / 10 ** currencyExponent(cart);
    const p = toLiquid(price);
    const variant = liquidVariant(sf, pdp, hasCost, entry.marginRefs ?? [], p);
    if ("f" in variant) costPath++;
    if (cart !== shop) foreign++;
    const data = {
      count: "line",
      cur: cart,
      sc: sf.margin.on ? sf.margin.cur : null,
      breaks: sf.tiers.sets.g.breaks,
      cart: { p: 0, s: 0 },
      variants: [variant],
    } as unknown as BlockData;
    const st = api.compute(data, 1, qty, cart === shop ? null : rate);
    const promisedL = st ? p * qty - st.total : 0;
    const promised = (promisedL * 10 ** currencyExponent(cart)) / 100;
    const label = `case ${n}: ${shop}→${cart} ×${rate.toFixed(4)} price ${price} qty ${qty} ${JSON.stringify(breaks[0])} margin ${JSON.stringify(margin.global)} cost ${unitCost} f ${pdp?.f}`;
    assert.ok(promised <= checkout + 1e-9, `${label}: PDP ${promised} > checkout ${checkout}`);
    // Equal when nothing is capped on either side.
    if (st && !plan.lines[0].marginCapped) {
      const b0 = (sf.tiers.sets.g.breaks[0] ?? {}) as { pct?: number; off?: Record<string, number> };
      const uncapped = api.lineDiscount(b0.pct != null ? { pct: b0.pct } : { off: b0.off?.[cart] }, p, p, qty, currencyExponent(cart) === 0 ? 100 : 1);
      if (uncapped === promisedL) {
        assert.equal(promised, checkout, `${label}: uncapped, PDP ${promised} ≠ checkout ${checkout}`);
        equal++;
      }
    }
  }
  assert.ok(capped > 200 && foreign > 600 && costPath > 300 && equal > 300, `capped ${capped}, foreign ${foreign}, cost path ${costPath}, equal ${equal}`);
});

test("MVP 5 (contracts O6, O9): a sale variant (its metafield `outlet` = true) gets no table and no live tier price unless outlet combines with anything (`cfg.ow`)", async () => {
  const liquid = await read(BLOCK);
  assert.match(liquid, /if cfg\.ow == 1\s+assign no_outlet = false/);
  // The selected variant (server render) and every variant of the data JSON (the script) the same way.
  assert.match(liquid, /if no_outlet and variant\.metafields\['\$app:won_discounts'\]\.outlet\.value == true\s+assign path = 'none'/);
  assert.match(liquid, /if no_outlet and v\.metafields\['\$app:won_discounts'\]\.outlet\.value == true\s+assign v_cap = ''/);
});

// MVP 6.1 (plan docs/plans/2026-10-04-won-discounts-mvp6-1.md, L6): while a campaign's tier sets are on show the
// storefront config carries them as `tiers` and the base ones beside them (`bt`, with the campaign's id `tc`) for
// the SYNC to put back. The extension must read `tiers` alone — a block reading `bt` would show the base table
// in a campaign, one preferring `tc`-anything would outlive the sync's take-back.
test("MVP 6.1: no file of the theme extension reads the storefront config's `bt` or `tc` — `tiers` is what the page shows", async () => {
  const { readdir } = await import("node:fs/promises");
  const files: string[] = [];
  for (const dir of ["blocks", "snippets", "assets"]) {
    for (const name of await readdir(path.join(extensionRoot, dir)).catch(() => [] as string[])) {
      if (/\.(liquid|js)$/.test(name)) files.push(`${dir}/${name}`);
    }
  }
  assert.ok(files.includes(BLOCK) && files.includes(SCRIPT));
  for (const file of files) {
    const source = await read(file);
    assert.doesNotMatch(source, /\bcfg\.(bt|tc)\b|\.bt\.(sets|global)\b|\[["'](bt|tc)["']\]/, `${file} reads the base sets or the campaign id of the storefront config`);
  }
  assert.match(await read(BLOCK), /cfg\.tiers\.sets\[set_id\]/);
});
