import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// MVP 4 contract R8 + SF-1: the cart panel (assets/won-discounts.js +
// won-discounts-cart.js) run against a small fake page. What it must do:
//   - never write to the cart on page load (only reads /cart.js and asks the proxy);
//   - after a CUSTOMER cart change: add the gift of a reached tier (line attributes
//     `_won_gift` + `_gift_progress`), remove the gift of a tier no longer reached;
//   - ignore the cart events its own writes cause;
//   - "Odmítnout" removes the gift and records the tier in `_won_gift_declined`,
//     keeping every other cart attribute; a gift the customer removed by hand is
//     declined the same way and never comes back;
//   - a code: applied through updateCart; not applicable → a warning; with
//     countOtherDiscounts and the gift lost → the choice keep / remove the code;
//   - writes at least 1.5 s apart (Cloudflare), only via Shopify.actions.updateCart.

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extensions/won-discounts-storefront/assets");
const SOURCES = ["won-discounts.js", "won-discounts-cart.js"].map((f) => readFileSync(path.join(ASSETS, f), "utf8"));

const TX = {
  ship_left: "Do dopravy zdarma zbývá {amount}.",
  ship_done: "Máte dopravu zdarma.",
  gift_left: "Do dárku zdarma zbývá {amount}.",
  gift_done: "Dárek zdarma je v košíku.",
  gift_decline: "Odmítnout",
  gift_declined: "Dárek zdarma jste odmítli.",
  gift_pick: "Vyberte si dárek zdarma:",
  gift_add: "Přidat dárek",
  gift_soldout: "Dárek je bohužel vyprodaný.",
  code_label: "Slevový kód",
  code_apply: "Použít",
  code_remove: "Odebrat",
  code_invalid: "Kód {code} se na tento košík nevztahuje.",
  code_loses_gift: "S kódem {code} ztratíte dárek.",
  keep_code: "Ponechat kód",
  drop_code: "Zrušit kód",
  saved: "Ušetříte {amount}.",
  hint: "Přidejte {n} ks {product} a dostanete {value}.",
  hint_capped: "Přidejte {n} ks {product} a dostanete nižší cenu.",
};

type Item = { key: string; variant_id: number; product_id: number; quantity: number; original_price: number; original_line_price: number; final_line_price: number; product_title: string; properties: Record<string, string> };
type Cart = { currency: string; items: Item[]; attributes: Record<string, string>; discount_codes: { code: string; applicable: boolean }[]; cart_level_discount_applications: { total_allocated_amount: number }[]; original_total_price: number; total_price: number };

const item = (key: string, variant: number, price: number, qty = 1, props: Record<string, string> = {}): Item => ({
  key,
  variant_id: variant,
  product_id: variant,
  quantity: qty,
  original_price: price,
  original_line_price: price * qty,
  final_line_price: price * qty,
  product_title: `P${variant}`,
  properties: props,
});
const cartOf = (items: Item[], extra: Partial<Cart> = {}): Cart => {
  const total = items.reduce((s, i) => s + i.final_line_price, 0);
  return { currency: "CZK", items, attributes: {}, discount_codes: [], cart_level_discount_applications: [], original_total_price: total, total_price: total, ...extra };
};

const REWARDS = { ship: { CZK: 100000 }, gifts: [{ id: "gift-1", t: { CZK: 150000 }, c: [{ v: 9001, h: "darek" }] }], other: false };

/** A fake page: one drawer slot, events, fetch (/cart.js + the proxy), Shopify.actions.updateCart as a spy. */
function page(t: TestContext, opts: { cart: Cart; rewards?: unknown; onUpdate?: (payload: Record<string, unknown>, cart: Cart) => Cart }) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  type El = { innerHTML: string; __won?: string; className: string; setAttribute: () => void };
  const slot: { children: El[]; querySelector: () => El | null; prepend: (el: El) => void } = {
    children: [],
    querySelector() {
      return this.children[0] ?? null;
    },
    prepend(el: El) {
      this.children.unshift(el);
    },
  };
  const state = { cart: opts.cart, updates: [] as { at: number; payload: Record<string, unknown> }[], proxy: [] as unknown[] };
  const document = {
    readyState: "complete",
    documentElement: { lang: "cs" },
    body: {},
    getElementById(id: string) {
      if (id === "won-discounts-config") return { textContent: "{}" };
      if (id === "won-discounts-cart-data") return { textContent: JSON.stringify({ on: true, rw: opts.rewards ?? REWARDS, exp: 2, lang: "cs", proxy: "/apps/won-discounts/cart-plan", g: { 9001: { t: "Dárek", a: true } }, tx: TX }) };
      return null;
    },
    querySelector(sel: string) {
      return sel === "[data-won-discounts-embed]" ? { setAttribute() {}, __wonDiscountsInit: false } : null;
    },
    querySelectorAll(sel: string) {
      return sel.includes("cart-drawer-component") ? [slot] : [];
    },
    createElement() {
      return { innerHTML: "", className: "", setAttribute() {} };
    },
    addEventListener(name: string, fn: (e: unknown) => void) {
      listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    },
    dispatchEvent() {},
  };
  const window: Record<string, unknown> = {
    document,
    Shopify: {
      currency: { rate: "1.0" },
      actions: {
        updateCart: async (payload: Record<string, unknown>) => {
          state.updates.push({ at: Date.now(), payload: JSON.parse(JSON.stringify(payload)) });
          if (opts.onUpdate) state.cart = opts.onUpdate(payload, state.cart);
          return { cart: {} };
        },
      },
    },
  };
  const context = vm.createContext({
    window,
    document,
    setTimeout,
    Date,
    Promise,
    JSON,
    Math,
    Number,
    String,
    Object,
    Intl,
    Set,
    console,
    CustomEvent: class {
      constructor(public type: string) {}
    },
    MutationObserver: class {
      observe() {}
    },
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    fetch: async (url: string, init?: { body?: string }) => {
      if (url === "/cart.js") return { ok: true, json: async () => JSON.parse(JSON.stringify(state.cart)) };
      state.proxy.push(JSON.parse(init?.body ?? "null"));
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  for (const src of SOURCES) vm.runInContext(src, context);
  const emit = (name: string, detail?: unknown) => (listeners.get(name) ?? []).forEach((fn) => fn({ type: name, detail, target: { closest: () => null } }));
  const settle = async (ms = 0) => {
    for (let i = 0; i < 40; i++) {
      await Promise.resolve();
      if (ms > 0) {
        t.mock.timers.tick(Math.min(ms, 100));
        ms -= Math.min(ms, 100);
      }
    }
  };
  const click = (attr: string, value: string) =>
    (listeners.get("click") ?? []).forEach((fn) =>
      fn({ target: { closest: () => ({ getAttribute: (name: string) => (name === attr ? value : null) }) } }),
    );
  const submit = (code: string) =>
    (listeners.get("submit") ?? []).forEach((fn) =>
      fn({ preventDefault() {}, target: { closest: () => ({ elements: { "won-code": { value: code } } }) } }),
    );
  return { state, slot, emit, settle, click, submit, panel: () => slot.children[0]?.innerHTML ?? "" };
}

const giftLine = (key = "g1") => item(key, 9001, 25000, 1, { _won_gift: "gift-1", _gift_progress: "1" });

test("SF-1: on page load the panel renders and nothing is written — even with a reached tier and no gift in the cart", async (t) => {
  const p = page(t, { cart: cartOf([item("a", 1, 160000)]) });
  await p.settle(1000);
  assert.deepEqual(p.state.updates, []);
  assert.match(p.panel(), /data-won-discounts-progress="shipping"/);
  assert.match(p.panel(), /Máte dopravu zdarma/);
  assert.match(p.panel(), /data-won-discounts-gift="gift-1" data-state="pick"/);
  assert.equal(p.state.proxy.length, 1, "the tier hint is asked (a read)");
});

test("a customer's change that reaches the threshold adds the gift (both attributes); our own events trigger nothing", async (t) => {
  const p = page(t, { cart: cartOf([item("a", 1, 160000)]), onUpdate: (_payload, cart) => cartOf([...cart.items, giftLine()]) });
  await p.settle(10);
  p.emit("shopify:cart:lines-update");
  await p.settle(2000);
  assert.equal(p.state.updates.length, 1);
  assert.deepEqual(p.state.updates[0]!.payload, {
    lines: [{ merchandiseId: "gid://shopify/ProductVariant/9001", quantity: 1, attributes: [{ key: "_won_gift", value: "gift-1" }, { key: "_gift_progress", value: "1" }] }],
  });
  p.emit("shopify:cart:lines-update", { won: true });
  await p.settle(2000);
  assert.equal(p.state.updates.length, 1, "our own write's event changes nothing");
  assert.match(p.panel(), /data-state="in"/);
});

test("a customer's change below the threshold removes the gift", async (t) => {
  const p = page(t, { cart: cartOf([item("a", 1, 100000), giftLine()]), onUpdate: () => cartOf([item("a", 1, 100000)]) });
  await p.settle(10);
  p.emit("shopify:cart:lines-update");
  await p.settle(2000);
  assert.deepEqual(p.state.updates.map((u) => u.payload), [{ lines: [{ id: "g1", quantity: 0 }] }]);
});

test("Odmítnout: the gift goes, the tier is declined, other cart attributes stay; it never comes back", async (t) => {
  let cart = cartOf([item("a", 1, 160000), giftLine()], { attributes: { note_x: "1" } });
  const p = page(t, {
    cart,
    onUpdate: (payload) => {
      const attrs = Object.fromEntries((payload.attributes as { key: string; value: string }[]).map((a) => [a.key, a.value]));
      cart = cartOf([item("a", 1, 160000)], { attributes: attrs });
      return cart;
    },
  });
  await p.settle(10);
  p.click("data-won-decline", "gift-1");
  await p.settle(2000);
  assert.deepEqual(p.state.updates[0]!.payload, {
    attributes: [{ key: "note_x", value: "1" }, { key: "_won_gift_declined", value: "gift-1" }],
    lines: [{ id: "g1", quantity: 0 }],
  });
  p.emit("shopify:cart:lines-update");
  await p.settle(3000);
  assert.equal(p.state.updates.length, 1, "a declined gift is not added again");
  assert.match(p.panel(), /data-state="declined"/);
});

test("a gift line whose variant the tier no longer offers is not 'your gift' (checkout charges it): a customer's change replaces it with the offered gift", async (t) => {
  const stale = item("old", 7777, 30000, 1, { _won_gift: "gift-1", _gift_progress: "1" });
  let cart = cartOf([item("a", 1, 160000), stale]);
  const p = page(t, {
    cart,
    onUpdate: (payload) => {
      const lines = payload.lines as { id?: string; quantity: number }[];
      cart = lines[0]!.id === "old" ? cartOf([item("a", 1, 160000)]) : cartOf([item("a", 1, 160000), giftLine()]);
      return cart;
    },
  });
  await p.settle(10);
  assert.doesNotMatch(p.panel(), /data-state="in"/, "never 'Váš dárek je v košíku' for a line checkout charges");
  assert.deepEqual(p.state.updates, [], "SF-1: nothing on load");
  p.emit("shopify:cart:lines-update");
  await p.settle(4000);
  assert.deepEqual(
    p.state.updates.map((u) => u.payload),
    [
      { lines: [{ id: "old", quantity: 0 }] },
      {
        lines: [{ merchandiseId: "gid://shopify/ProductVariant/9001", quantity: 1, attributes: [{ key: "_won_gift", value: "gift-1" }, { key: "_gift_progress", value: "1" }] }],
      },
    ],
  );
  assert.match(p.panel(), /data-state="in"/);
});

test("a gift the customer removed by hand is declined, not added back", async (t) => {
  const p = page(t, {
    cart: cartOf([item("a", 1, 160000), giftLine()]),
    onUpdate: () => cartOf([item("a", 1, 160000)], { attributes: { _won_gift_declined: "gift-1" } }),
  });
  await p.settle(10);
  p.state.cart = cartOf([item("a", 1, 160000)]);
  p.emit("shopify:cart:lines-update");
  await p.settle(2000);
  assert.deepEqual(p.state.updates.map((u) => u.payload), [{ attributes: [{ key: "_won_gift_declined", value: "gift-1" }] }]);
});

test("codes: a code that does not apply warns; with countOtherDiscounts a code that loses the gift offers keep / remove", async (t) => {
  const p = page(t, {
    cart: cartOf([item("a", 1, 160000), giftLine()]),
    rewards: { ...REWARDS, other: true },
    onUpdate: (payload) => {
      const codes = payload.discountCodes as string[];
      if (codes.includes("NIC")) return cartOf([item("a", 1, 160000), giftLine()], { discount_codes: [{ code: "NIC", applicable: false }] });
      return cartOf([{ ...item("a", 1, 160000), final_line_price: 128000 }, giftLine()], { discount_codes: [{ code: "SLEVA20", applicable: true }] });
    },
  });
  await p.settle(10);
  p.submit("NIC");
  await p.settle(2000);
  assert.deepEqual(p.state.updates[0]!.payload, { discountCodes: ["NIC"] });
  assert.match(p.panel(), /Kód NIC se na tento košík nevztahuje/);
  p.submit("SLEVA20");
  await p.settle(2000);
  assert.match(p.panel(), /data-won-discounts-code-warning/);
  assert.match(p.panel(), /S kódem SLEVA20 ztratíte dárek/);
  assert.deepEqual(p.state.updates[1]!.payload, { discountCodes: ["SLEVA20"] }, "a code that does not apply is not sent again");
  assert.match(p.panel(), /data-won-drop="SLEVA20"/);
});

test("countOtherDiscounts: 'Keep the code' removes the gift (the threshold counts after discounts), a later change does not add it back while the code keeps the order below", async (t) => {
  const discounted = (gift: boolean) =>
    cartOf([{ ...item("a", 1, 160000), final_line_price: 128000 }, ...(gift ? [giftLine()] : [])], { discount_codes: [{ code: "SLEVA20", applicable: true }] });
  let cart = cartOf([item("a", 1, 160000), giftLine()]);
  const p = page(t, {
    cart,
    rewards: { ...REWARDS, other: true },
    onUpdate: (payload) => {
      const codes = payload.discountCodes as string[] | undefined;
      if (codes?.includes("SLEVA20")) cart = discounted(true);
      else if (codes) cart = cartOf([item("a", 1, 160000), ...cart.items.filter((i) => i.properties._won_gift)]);
      else if ((payload.lines as { id?: string; quantity: number }[] | undefined)?.some((l) => l.id === "g1" && l.quantity === 0)) cart = discounted(false);
      return cart;
    },
  });
  await p.settle(10);
  p.submit("SLEVA20");
  await p.settle(2000);
  assert.match(p.panel(), /data-won-discounts-code-warning/);
  assert.equal(p.state.updates.length, 1, "the code only: the choice is the customer's");
  p.click("data-won-keep", "");
  await p.settle(2000);
  assert.deepEqual(p.state.updates[1]!.payload, { lines: [{ id: "g1", quantity: 0 }] }, "Keep the code (no gift): the gift goes");
  assert.doesNotMatch(p.panel(), /data-won-discounts-code-warning/);
  assert.match(p.panel(), /data-won-discounts-progress="gift"/, "the gift progress counts after discounts again");
  p.emit("shopify:cart:lines-update");
  await p.settle(3000);
  assert.equal(p.state.updates.length, 2, "below the threshold after discounts: not added back");
});

test("countOtherDiscounts: 'Remove the code' removes only the code; the gift stays", async (t) => {
  const discounted = () =>
    cartOf([{ ...item("a", 1, 160000), final_line_price: 128000 }, giftLine()], { discount_codes: [{ code: "SLEVA20", applicable: true }] });
  let cart = cartOf([item("a", 1, 160000), giftLine()]);
  const q = page(t, {
    cart,
    rewards: { ...REWARDS, other: true },
    onUpdate: (payload) => {
      const codes = payload.discountCodes as string[] | undefined;
      cart = codes?.includes("SLEVA20") ? discounted() : cartOf([item("a", 1, 160000), giftLine()]);
      return cart;
    },
  });
  await q.settle(10);
  q.submit("SLEVA20");
  await q.settle(2000);
  q.click("data-won-drop", "SLEVA20");
  await q.settle(2000);
  assert.deepEqual(q.state.updates.map((u) => u.payload), [{ discountCodes: ["SLEVA20"] }, { discountCodes: [] }]);
  assert.match(q.panel(), /data-state="in"/);
});

test("writes are at least 1.5 s apart and go only through Shopify.actions.updateCart (no /cart/*.js writes in the scripts)", async (t) => {
  const p = page(t, { cart: cartOf([item("a", 1, 160000)]), onUpdate: (_payload, cart) => cart });
  await p.settle(10);
  p.submit("A");
  p.submit("B");
  await p.settle(5000);
  assert.equal(p.state.updates.length, 2);
  assert.ok(p.state.updates[1]!.at - p.state.updates[0]!.at >= 1500, JSON.stringify(p.state.updates.map((u) => u.at)));
  for (const src of SOURCES) assert.doesNotMatch(src, /\/cart\/(add|change|update|clear)(\.js)?/);
});

test("customer text is escaped in the panel (a code is never HTML)", async (t) => {
  const p = page(t, {
    cart: cartOf([item("a", 1, 50000)]),
    onUpdate: () => cartOf([item("a", 1, 50000)], { discount_codes: [{ code: '<img src=x onerror=1>"', applicable: false }] }),
  });
  await p.settle(10);
  p.submit('<img src=x onerror=1>"');
  await p.settle(2000);
  assert.doesNotMatch(p.panel(), /<img/);
  assert.match(p.panel(), /&#60;img/);
});

// --- R1/R4: the panel's thresholds = the engine's (property) ------------------------------------

import { sanitizeConfig } from "@won/core/discounts/config";
import { buildShopFunctionConfig } from "@won/core/discounts/function-payload";
import { planCart } from "@won/core/discounts/plan";
import { buildStorefrontConfig } from "@won/core/discounts/storefront-config";

test("property: the panel's free-shipping and gift progress = planCart's (before and after discounts), 1 500 random carts", () => {
  // won-discounts.js booted on a stub page: its pure plan().
  const doc = { readyState: "complete", documentElement: { lang: "cs" }, getElementById: () => ({ textContent: "{}" }), querySelector: () => ({ setAttribute() {} }), addEventListener() {} };
  const run = vm.createContext({ window: {} as Record<string, unknown>, document: doc, Intl, JSON, Math });
  vm.runInContext(SOURCES[0]!, run);
  const wd = (run.window as { WonDiscounts: { plan: (cart: unknown, rw: unknown, facts: unknown) => { base: number; ship: unknown; tiers: { id: string; reached: boolean; remaining: number; lost: boolean }[] } } }).WonDiscounts;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)]!;
  for (let n = 0; n < 1500; n++) {
    const other = rnd() < 0.5;
    const { config } = sanitizeConfig({
      modules: {
        codes: { rules: [] },
        rewards: {
          freeShipping: { threshold: { CZK: pick([50000, 100000, 1]), ...(rnd() < 0.5 ? { EUR: 4000 } : {}) } },
          gifts: [
            { id: "g1", threshold: { CZK: pick([30000, 150000]), EUR: 6000 }, choices: ["gid://shopify/ProductVariant/9001"] },
            { id: "g2", threshold: { CZK: 300000 }, choices: ["gid://shopify/ProductVariant/9002"] },
          ],
          countOtherDiscounts: other,
        },
      },
    });
    const sf = buildStorefrontConfig(config, { configVersion: "x", variantHandles: { "gid://shopify/ProductVariant/9001": "a", "gid://shopify/ProductVariant/9002": "b" } });
    const payload = buildShopFunctionConfig(config, { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague" }).payload;
    const currency = pick(["CZK", "CZK", "EUR"]);
    const items = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) => {
      const gift = rnd() < 0.2 ? pick(["g1", "g2"]) : null;
      const price = pick([1000, 9990, 25000, 70000, 125000]);
      const qty = 1 + Math.floor(rnd() * 3);
      const off = gift ? 0 : pick([0, 0, Math.round(price * qty * 0.2)]);
      return { ...item(`k${i}`, gift ? (gift === "g1" ? 9001 : 9002) : 100 + i, price, qty, gift ? { _won_gift: gift } : {}), final_line_price: price * qty - off };
    });
    const orderOff = rnd() < 0.3 ? 5000 : 0;
    const cart = cartOf(items, { currency, cart_level_discount_applications: orderOff ? [{ total_allocated_amount: orderOff }] : [] });
    const js = JSON.parse(JSON.stringify(wd.plan(cart, sf.rewards, {}))) as ReturnType<typeof wd.plan>;
    const plan = planCart(
      {
        currency,
        enteredCodes: [],
        lines: items.map((it) => ({
          id: it.key,
          variantId: `gid://shopify/ProductVariant/${it.variant_id}`,
          productId: `gid://shopify/Product/${it.product_id}`,
          quantity: it.quantity,
          unitPrice: it.original_price,
          ruleIds: [],
          ...(it.properties._won_gift ? { giftTierId: it.properties._won_gift } : {}),
        })),
      },
      payload,
    );
    const ship = plan.progress.freeShipping ?? null;
    assert.deepEqual(js.ship, ship, `free shipping, case ${n}`);
    const engineTiers = (plan.progress.gifts ?? []).map((g) => ({ id: g.tierId, reached: g.reached, remaining: g.remaining }));
    assert.deepEqual(js.tiers.map((x) => ({ id: x.id, reached: x.reached, remaining: x.remaining })), engineTiers, `gift progress, case ${n}`);
    // After discounts (countOtherDiscounts): the engine's line discounts are 0 here, so the JS side
    // sees only the cart's own reductions — compare the rule itself: lost ⇔ reached && after < threshold.
    for (const x of js.tiers) {
      const threshold = (sf.rewards!.gifts.find((g) => g.id === x.id)!.t as Record<string, number>)[currency]!;
      const after = items.filter((i) => !i.properties._won_gift).reduce((s, i) => s + i.final_line_price, 0) - orderOff;
      assert.equal(x.lost, other && x.reached && after < threshold, `lost, case ${n}`);
    }
  }
});
