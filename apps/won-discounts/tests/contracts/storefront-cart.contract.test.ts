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
  ms_left: "Ještě {amount} a získáte: {reward}",
  ms_done: "Máte všechny odměny.",
  ms_from: "od {amount}",
  ms_ship: "Doprava zdarma",
  ms_gift: "Dárek zdarma",
  ms_gift_named: "Dárek: {name}",
  ms_disc: "Sleva {value}",
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
  const state = { cart: opts.cart, updates: [] as { at: number; payload: Record<string, unknown> }[], proxy: [] as unknown[], events: [] as { type: string; detail?: Record<string, unknown> }[] };
  let cached: string | undefined;
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
    dispatchEvent(event: { type: string; detail?: Record<string, unknown> }) {
      state.events.push(event);
    },
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
      detail?: unknown;
      constructor(
        public type: string,
        init?: { detail?: unknown },
      ) {
        this.detail = init?.detail;
      }
    },
    MutationObserver: class {
      observe() {}
    },
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    fetch: async (url: string, init?: { body?: string; cache?: string }) => {
      // Like the browser on a live store (E2E MVP 4): a /cart.js read the HTTP cache may answer gets the first
      // cart read; only `cache: "no-store"` sees the cart as it is now.
      if (url === "/cart.js") {
        if (init?.cache !== "no-store") cached ??= JSON.stringify(state.cart);
        return { ok: true, json: async () => JSON.parse(init?.cache === "no-store" ? JSON.stringify(state.cart) : cached!) };
      }
      state.proxy.push(JSON.parse(init?.body ?? "null"));
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  for (const src of SOURCES) vm.runInContext(src, context);
  const emit = (name: string, detail?: unknown, promise?: Promise<unknown>) =>
    (listeners.get(name) ?? []).forEach((fn) => fn({ type: name, detail, promise, target: { closest: () => null } }));
  // Advances the fake clock in 100 ms steps, draining the promise chains between steps and after the last one.
  const flush = async (n: number) => {
    for (let i = 0; i < n; i++) await Promise.resolve();
  };
  const settle = async (ms = 0) => {
    await flush(40);
    while (ms > 0) {
      t.mock.timers.tick(Math.min(ms, 100));
      ms -= Math.min(ms, 100);
      await flush(20);
    }
    await flush(40);
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
  // Milníky: the ladder — on the cart page every step, the reached ones marked.
  assert.match(p.panel(), /<div class="won-ms won-ms--full" data-won-ms="full">/);
  assert.match(p.panel(), /Máte všechny odměny\./);
  assert.deepEqual([...p.panel().matchAll(/<li data-won-ms-step="(\w)"( data-done)?>/g)].map((m) => `${m[1]}${m[2] ? "+" : "-"}`), ["s+", "g+"]);
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

test("a cart event fires as the change STARTS (Storefront Events): the panel waits for event.promise before it reads the cart", async (t) => {
  const p = page(t, { cart: cartOf([item("a", 1, 100000)]), onUpdate: (_payload, cart) => cartOf([...cart.items, giftLine()]) });
  await p.settle(10);
  let done!: () => void;
  const promise = new Promise<void>((ok) => (done = ok));
  p.emit("shopify:cart:lines-update", undefined, promise);
  await p.settle(2000);
  assert.equal(p.state.updates.length, 0, "the change is not in the cart yet: nothing to react to");
  p.state.cart = cartOf([item("a", 1, 160000)]);
  done();
  await p.settle(3000);
  assert.equal(p.state.updates.length, 1, "after the theme's change settled, the reached tier gets its gift");
  assert.match(p.panel(), /data-state="in"/);
});

test("one customer action, two cart events (Dawn's pubsub + the standard event): the gift is added once", async (t) => {
  const p = page(t, { cart: cartOf([item("a", 1, 160000)]), onUpdate: (_payload, cart) => cartOf([...cart.items, giftLine()]) });
  await p.settle(10);
  p.emit("shopify:cart:lines-update");
  p.emit("cart:update");
  await p.settle(5000);
  assert.equal(p.state.updates.length, 1, JSON.stringify(p.state.updates.map((u) => u.payload)));
});

test("a customer's change right after the panel's own write is not swallowed (no time window, only detail.won)", async (t) => {
  let cart = cartOf([item("a", 1, 160000)]);
  const p = page(t, {
    cart,
    onUpdate: (payload) => {
      const lines = (payload.lines as { id?: string; quantity: number }[] | undefined) ?? [];
      cart = lines.some((l) => l.id === "g1" && l.quantity === 0) ? cartOf(cart.items.filter((i) => i.key !== "g1")) : cartOf([...cart.items, giftLine()]);
      return cart;
    },
  });
  await p.settle(10);
  p.emit("shopify:cart:lines-update");
  await p.settle(2000);
  assert.equal(p.state.updates.length, 1, "the gift is added");
  // 1 s later the customer removes the product: below the threshold, the gift must go.
  p.state.cart = cart = cartOf([giftLine()]);
  p.emit("shopify:cart:lines-update");
  await p.settle(3000);
  assert.deepEqual(p.state.updates[1]?.payload, { lines: [{ id: "g1", quantity: 0 }] });
});

test("a rejected write (network, Cloudflare 429: updateCart rejects) is tried again, at most twice more", async (t) => {
  let calls = 0;
  const p = page(t, {
    cart: cartOf([item("a", 1, 160000)]),
    onUpdate: (_payload, cart) => {
      calls += 1;
      if (calls === 1) throw new Error("SFAPI 429 Too Many Requests");
      return cartOf([...cart.items, giftLine()]);
    },
  });
  await p.settle(10);
  p.emit("shopify:cart:lines-update");
  await p.settle(8000);
  assert.equal(p.state.updates.length, 2, "the same write, once more");
  assert.deepEqual(p.state.updates[1]!.payload, p.state.updates[0]!.payload);
  assert.match(p.panel(), /data-state="in"/);
});

test("a write that landed but answered with an error (lost response) is not sent again: the panel re-reads the cart, the gift is there once", async (t) => {
  let calls = 0;
  const p = page(t, {
    cart: cartOf([item("a", 1, 160000)]),
    onUpdate: () => {
      calls += 1;
      p.state.cart = cartOf([item("a", 1, 160000), giftLine()]);
      throw new Error("Failed to fetch");
    },
  });
  await p.settle(10);
  p.emit("shopify:cart:lines-update");
  await p.settle(12000);
  assert.equal(calls, 1, "one gift write");
  assert.match(p.panel(), /data-state="in"/);
});

test("below the threshold a gift line still in the cart (its removal pending or failed) is never 'your free gift' — checkout charges it", async (t) => {
  const p = page(t, { cart: cartOf([item("a", 1, 100000), giftLine()]) });
  await p.settle(1000);
  assert.doesNotMatch(p.panel(), /data-state="in"/);
  assert.match(p.panel(), /<li data-won-ms-step="g">/, "the gift step is ahead, not reached");
  assert.equal(p.state.updates.length, 0, "SF-1: on load nothing is written");
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
  assert.equal(p.state.updates.length, 0, "SF-1: nothing on load");
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
  assert.match(p.panel(), /<li data-won-ms-step="g">/, "the gift step counts after discounts again: not reached");
  p.emit("shopify:cart:lines-update");
  await p.settle(3000);
  assert.equal(p.state.updates.length, 2, "below the threshold after discounts: not added back");
});

test("countOtherDiscounts: while the code warning waits for the customer, a theme's own cart event does not take the gift (live E2E, Dawn)", async (t) => {
  const discounted = () =>
    cartOf([{ ...item("a", 1, 160000), final_line_price: 128000 }, giftLine()], { discount_codes: [{ code: "SLEVA20", applicable: true }] });
  let cart = cartOf([item("a", 1, 160000), giftLine()]);
  const p = page(t, {
    cart,
    rewards: { ...REWARDS, other: true },
    onUpdate: (payload) => {
      const codes = payload.discountCodes as string[] | undefined;
      if (codes) cart = codes.includes("SLEVA20") ? discounted() : cartOf([item("a", 1, 160000), giftLine()]);
      return cart;
    },
  });
  await p.settle(10);
  p.submit("SLEVA20");
  await p.settle(2000);
  assert.match(p.panel(), /data-won-discounts-code-warning/);
  p.emit("cart-update"); // the theme's event after the discount change, without detail.won
  p.emit("shopify:cart:discount-update");
  await p.settle(3000);
  assert.equal(p.state.updates.length, 1, `the choice is the customer's: ${JSON.stringify(p.state.updates.map((u) => u.payload))}`);
  p.click("data-won-drop", "SLEVA20");
  await p.settle(2000);
  assert.match(p.panel(), /data-state="in"/, "Remove the code: the gift stays");
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
  const wd = (run.window as { WonDiscounts: { plan: (cart: unknown, rw: unknown, facts: unknown, mk?: string) => { base: number; ship: unknown; tiers: { id: string; reached: boolean; remaining: number; lost: boolean }[]; steps: { k: string; at: number; done: boolean; pct?: number; off?: number }[] } } }).WonDiscounts;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)]!;
  for (let n = 0; n < 1500; n++) {
    const other = rnd() < 0.5;
    // Amounts per market (7 Oct 2026): sometimes Germany has its own threshold ("EUR@de") next to the euro one.
    const own = rnd() < 0.4;
    const { config } = sanitizeConfig({
      // …and sometimes a customer from a country in no market gets the lowest of the euro amounts (engine.unknownMarketLowest).
      ...(rnd() < 0.5 ? { engine: { unknownMarketLowest: true } } : {}),
      markets: [
        { handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] },
        { handle: "sk", currency: "EUR", enabled: true, countries: ["SK"] },
        { handle: "de", currency: "EUR", enabled: true, countries: ["DE"] },
      ],
      modules: {
        // Milníky: two discount steps — a percent and a fixed amount (sometimes without an amount for the euro, or with Germany's own).
        codes: {
          rules: [
            { id: "ms-pct", name: "", method: "automatic", value: { kind: "percentage", percent: 5 }, target: { kind: "order" }, minimum: { subtotal: { CZK: pick([20000, 120000]), ...(rnd() < 0.6 ? { EUR: 5000 } : {}), ...(own ? { "EUR@de": pick([500, 150000]) } : {}) }, scope: "cart" } },
            { id: "ms-fix", name: "", method: "automatic", value: { kind: "fixed", amount: { CZK: 10000, ...(rnd() < 0.5 ? { EUR: 400 } : {}) } }, target: { kind: "order" }, minimum: { subtotal: { CZK: pick([90000, 250000]), EUR: 8000 }, scope: "cart" } },
          ],
        },
        rewards: {
          freeShipping: { threshold: { CZK: pick([50000, 100000, 1]), ...(rnd() < 0.5 ? { EUR: 4000 } : {}), ...(own ? { "EUR@de": 9000 } : {}) } },
          gifts: [
            { id: "g1", threshold: { CZK: pick([30000, 150000]), EUR: 6000, ...(own ? { "EUR@de": pick([1000, 200000]) } : {}) }, choices: ["gid://shopify/ProductVariant/9001"] },
            { id: "g2", threshold: { CZK: 300000 }, choices: ["gid://shopify/ProductVariant/9002"] },
          ],
          countOtherDiscounts: other,
        },
      },
    });
    const sf = buildStorefrontConfig(config, { configVersion: "x", variantHandles: { "gid://shopify/ProductVariant/9001": "a", "gid://shopify/ProductVariant/9002": "b" } });
    const payload = buildShopFunctionConfig(config, { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague" }).payload;
    const currency = pick(["CZK", "CZK", "EUR"]);
    const country = currency === "CZK" ? "CZ" : pick(["SK", "DE", "FR"]);
    const market = { CZ: "cz", SK: "sk", DE: "de" }[country] ?? "";
    const items = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, i) => {
      const gift = rnd() < 0.2 ? pick(["g1", "g2"]) : null;
      const price = pick([1000, 9990, 25000, 70000, 125000]);
      const qty = 1 + Math.floor(rnd() * 3);
      const off = gift ? 0 : pick([0, 0, Math.round(price * qty * 0.2)]);
      return { ...item(`k${i}`, gift ? (gift === "g1" ? 9001 : 9002) : 100 + i, price, qty, gift ? { _won_gift: gift } : {}), final_line_price: price * qty - off };
    });
    const orderOff = rnd() < 0.3 ? 5000 : 0;
    const cart = cartOf(items, { currency, cart_level_discount_applications: orderOff ? [{ total_allocated_amount: orderOff }] : [] });
    const js = JSON.parse(JSON.stringify(wd.plan(cart, sf.rewards, {}, `${currency}@${market}`))) as ReturnType<typeof wd.plan>;
    const plan = planCart(
      {
        currency,
        countryCode: country,
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
      const t = sf.rewards!.gifts.find((g) => g.id === x.id)!.t as Record<string, number>;
      const own = t[`${currency}@${market}`];
      const threshold = own ?? t[currency]!;
      const after = items.filter((i) => !i.properties._won_gift).reduce((s, i) => s + i.final_line_price, 0) - orderOff;
      assert.equal(x.lost, other && x.reached && after < threshold, `lost, case ${n}`);
    }
    // Milníky: a discount step is on the ladder exactly where checkout offers it, and reached exactly when
    // checkout reaches its minimum (applied, or outranked by the higher step — never "below the minimum").
    const offered = plan.rules.filter((r) => r.ruleId.startsWith("ms-") && r.state !== "currency_missing");
    const discSteps = js.steps.filter((s) => s.k === "d");
    assert.equal(discSteps.length, offered.length, `discount steps offered, case ${n}`);
    assert.deepEqual(discSteps.map((s) => s.done).sort(), offered.map((r) => ["applied", "outranked", "combined"].includes(r.state)).sort(), `discount steps reached, case ${n}`);
    // The ladder is sorted by cart value and holds every kind once.
    assert.deepEqual(js.steps.map((s) => s.at), js.steps.map((s) => s.at).sort((a, b) => a - b), `ladder order, case ${n}`);
    assert.equal(js.steps.length, (js.ship ? 1 : 0) + js.tiers.length + discSteps.length, `ladder size, case ${n}`);
  }
});

test("tap targets: every panel button and the code input are at least 44 × 44 px, in px, not rem (Dawn's html is 62.5 %) — MVP 4 audit E3", () => {
  const css = readFileSync(path.join(ASSETS, "won-discounts.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `rule ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };
  assert.match(rule(".won-cart button"), /min-height: 44px;[\s\S]*min-width: 44px;/);
  assert.match(rule(".won-cart__code input"), /min-height: 44px;/);
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/\.won-cart\b/.test(selector!) && /button|input/.test(selector!)) {
      assert.doesNotMatch(body!, /min-(height|width): [\d.]+rem/, `no rem tap target: ${selector!.trim()}`);
    }
  }
});

// --- Vzhled žebříčku (feedback 2026-10-06, bod 13): what the ready-made looks need from the markup -----------

import { LOOK_PRESET_CSS, MILESTONE_BLINK_CSS } from "@won/core/discounts/looks";

/** won-discounts.js booted on a stub page: its pure plan() and ladder(). */
function bootLadder() {
  const doc = { readyState: "complete", documentElement: { lang: "cs" }, getElementById: () => ({ textContent: "{}" }), querySelector: () => ({ setAttribute() {} }), addEventListener() {} };
  const run = vm.createContext({ window: {} as Record<string, unknown>, document: doc, Intl, JSON, Math, Date });
  vm.runInContext(SOURCES[0]!, run);
  return (run.window as { WonDiscounts: { plan: (cart: unknown, rw: unknown, facts: unknown, mk?: string) => { hit: number; steps: { done: boolean }[] }; ladder: (view: unknown, size: string, data: unknown, cur: string) => string } }).WonDiscounts;
}
const LADDER_RW = { ship: { CZK: 100000 }, gifts: [], other: false, disc: [{ id: "ms-a", t: { CZK: 200000 }, pct: 5 }, { id: "ms-b", t: { CZK: 300000 }, pct: 10 }] };
const LADDER_TX = { tx: { ms_left: "Ještě {amount} a získáte: {reward}", ms_done: "Hotovo", ms_from: "od {amount}", ms_ship: "Doprava zdarma", ms_disc: "Sleva {value}", n: { "ms-b": "Věrnostní sleva {value}" } } };
const ladderCart = (kc: number) => ({ currency: "CZK", items: [{ original_line_price: kc * 100, final_line_price: kc * 100, properties: {} }], attributes: {}, cart_level_discount_applications: [] });

test("the ladder marks the step a cart change has just reached — never on the first look, never when the cart shrinks; the mark holds while its flash runs, then goes", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const wd = bootLadder();
  const hit = (kc: number) => wd.plan(ladderCart(kc), LADDER_RW, {}, "CZK@cz").hit;
  assert.equal(hit(1500), -1, "the first look at a cart flashes nothing, whatever it has reached");
  assert.equal(hit(1600), -1, "no new step");
  assert.equal(hit(2500), 1, "the second step was just reached");
  // A theme fires two cart events for one change, and the panel reads the cart again after its own write: the
  // same step is still the new one, so the markup stays as it is and the flash is not cut.
  t.mock.timers.tick(300);
  assert.equal(hit(2500), 1, "read again a moment later: the same mark");
  assert.equal(hit(2600), 1, "…also when the cart grew without reaching another step");
  t.mock.timers.tick(1_500);
  assert.equal(hit(2600), -1, "after the flash it is not new any more");
  assert.equal(hit(500), -1, "a smaller cart reaches nothing");
  assert.equal(hit(3500), 2, "three at once: the highest one is the new one");
  t.mock.timers.tick(300);
  assert.equal(hit(1500), -1, "the cart shrank during the flash: nothing is new");
});

test("the step just reached goes out with the cart event, so the Milestones block and the top bar mark it like the panel — once for a change a theme reports twice", async (t) => {
  // Free shipping from 1 000 Kč: the cart goes from 900 to 1 100 Kč.
  const p = page(t, { cart: cartOf([item("a", 1, 90000)]), rewards: { ship: { CZK: 100000 }, gifts: [], other: false } });
  await p.settle(1000);
  const sent = () => p.state.events.filter((e) => e.type === "won-discounts:cart:update").map((e) => e.detail?.hit);
  assert.deepEqual(sent(), [-1], "the first look: nothing is new");
  p.state.cart = cartOf([item("a", 1, 110000)]);
  // One customer action, two cart events (Dawn's pubsub and the standard event).
  p.emit("cart:update");
  p.emit("shopify:cart:lines-update");
  await p.settle(1000);
  assert.deepEqual(sent(), [-1, 0], "one event with the step, and no second one that would take the mark away");
  assert.match(p.panel(), /<li data-won-ms-step="s" data-done data-new>/);
});

test("the ladder's markup carries what every look needs: the track and the list of steps in compact and full, `data-new` on the step just reached, a step's own name", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const wd = bootLadder();
  wd.plan(ladderCart(500), LADDER_RW, {}, "CZK@cz");
  const view = wd.plan(ladderCart(1200), LADDER_RW, {}, "CZK@cz");
  assert.equal(view.hit, 0);
  for (const size of ["compact", "full"]) {
    const html = wd.ladder(view, size, LADDER_TX, "CZK");
    assert.match(html, new RegExp(`^<div class="won-ms won-ms--${size}" data-won-ms="${size}">`));
    assert.equal((html.match(/<i style=/g) ?? []).length, 3, `${size}: a mark per step`);
    assert.equal((html.match(/<li data-won-ms-step=/g) ?? []).length, 3, `${size}: a row per step`);
    assert.match(html, /<i style="left:33%" data-done data-new><\/i><i style="left:67%"><\/i>/);
    assert.match(html, /<li data-won-ms-step="s" data-done data-new><span>Doprava zdarma<\/span>/);
    assert.match(html, /<li data-won-ms-step="d"><span>Věrnostní sleva 10\u00a0%<\/span>/, "the merchant's own name of the step");
    assert.match(html, /<li data-won-ms-step="d"><span>Sleva 5\u00a0%<\/span>/, "a step without one says the discount");
  }
  const bar = wd.ladder(view, "bar", LADDER_TX, "CZK");
  assert.doesNotMatch(bar, /<i |<ol|data-new/, "the strip is a sentence and a thin track");
  // Nothing new once the flash is over: no mark.
  t.mock.timers.tick(1_600);
  assert.doesNotMatch(wd.ladder(wd.plan(ladderCart(1300), LADDER_RW, {}, "CZK@cz"), "compact", LADDER_TX, "CZK"), /data-new/);
});

test("Liquid renders the same ladder for the first paint; the stylesheet keeps today's look until a look's CSS says otherwise, and never flashes for a customer who reduces motion", () => {
  const snippet = readFileSync(path.join(ASSETS, "../snippets/won-milestones.liquid"), "utf8");
  assert.match(snippet, /\{%- unless size == 'bar' -%\}\s*<ol class="won-ms__list">/);
  assert.doesNotMatch(snippet, /data-new/, "a page load reaches nothing new");
  assert.match(snippet, /assign won_name_key = 'cart\.ms_name\.' \| append: won_d\.id/);
  const css = readFileSync(path.join(ASSETS, "won-discounts.css"), "utf8").replace(/\s+/g, " ");
  // Today's look: the product page and the drawer show the track, the cart page the list too.
  assert.match(css, /\.won-ms--compact \.won-ms__list \{ display: none; \}/);
  assert.doesNotMatch(css, /animation:(?! none)/, "no animation without a look that asks for it");
  assert.match(css, /@keyframes won-ms-new \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.won-ms \[data-new\] \{ animation: none !important; \}/);
  // The looks' own rules win over the base wherever the stylesheets land (the element's class twice), and use only the ladder's marks.
  assert.match(LOOK_PRESET_CSS.milestones.checklist!, /^:not\(\.won-topbar\)>\.won-progress>\.won-ms\.won-ms--compact \.won-ms__list\{display:grid\}/);
  assert.equal(MILESTONE_BLINK_CSS, ":not(.won-topbar)>.won-progress>.won-ms [data-new]{animation:won-ms-new .7s ease-out}");
  // The ladder has a look per place (7th round, bod 3): the cart script says on the panel whether it is the cart page or the drawer.
  assert.match(SOURCES[1]!, /p\.className = `won-cart won-cart--\$\{p\.__size === "full" \? "page" : "drawer"\}`/);
  assert.match(LOOK_PRESET_CSS.msCart.checklist!, /^\.won-cart--page \.won-ms\.won-ms--compact/);
  assert.match(LOOK_PRESET_CSS.msDrawer.sentence!, /^\.won-cart--drawer \.won-ms:not\(\.won-ms--bar\) \.won-ms__track,/);
  assert.equal(LOOK_PRESET_CSS.msBar.sentence, ".won-topbar .won-ms .won-ms__track{display:none}");
});

test("the campaign's countdown has ONE switch, the banner's look: the block offers no setting for it, the script always writes the time, the 'strip' look hides it", () => {
  const blocks = path.resolve(ASSETS, "../blocks");
  const banner = readFileSync(path.join(blocks, "campaign_banner.liquid"), "utf8");
  const schema = JSON.parse(/\{% schema %\}([\s\S]*)\{% endschema %\}/.exec(banner)![1]!) as { settings: { id: string }[] };
  assert.deepEqual(schema.settings.map((s) => s.id), ["text", "align"]);
  for (const file of ["campaign_banner.liquid", "won_discounts_embed.liquid", "outlet_badge.liquid"]) assert.doesNotMatch(readFileSync(path.join(blocks, file), "utf8"), /data-countdown|show_countdown/, file);
  assert.doesNotMatch(readFileSync(path.join(ASSETS, "won-discounts-blocks.js"), "utf8"), /data-countdown|time\.hidden/);
  assert.equal(LOOK_PRESET_CSS.campaign.strip, ".won-campaign .won-campaign__time{display:none}.won-campaign .won-campaign__title{color:var(--won-tiers-accent,inherit)}");
  assert.equal(LOOK_PRESET_CSS.campaign.countdown, "");
});
