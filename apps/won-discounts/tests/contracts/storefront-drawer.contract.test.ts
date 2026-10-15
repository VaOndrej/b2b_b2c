// Zásuvka košíku, varianta 1 (15 Oct 2026): in Horizon's and Dawn's cart drawer the Milestones panel goes ABOVE the
// main checkout button, in the spot the Won embed's setting picks (`drawer_position`: summary = right above the
// checkout button, top = above the products, off = none); a cart tag in the theme wins over both. Run in a real
// browser (Chromium) with the extension's own won-discounts.js, won-discounts-cart.js and stylesheet, on the drawer
// markup of the two themes — excerpts of Horizon's snippets/cart-drawer.liquid + cart-summary.liquid and Dawn's
// snippets/cart-drawer.liquid (b2b_b2c_themes, 15 Oct 2026): the same elements, classes and checkout button, Liquid
// left out. The cart and the app proxy are answered here, no network.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "../../extensions/won-discounts-storefront/assets");
const asset = (file: string) => readFile(path.join(ASSETS, file), "utf8");
const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");

let browser: import("playwright").Browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

const ITEMS = '<div class="cart-items"><div class="cart-item">Tričko × 1 <span>499 Kč</span></div></div>';

/** Horizon: cart-drawer-component › cart-drawer__content (scroll-hint) › items + summary (cart-summary with #checkout). */
const HORIZON = `<cart-drawer-component class="cart-drawer">
  <dialog class="cart-drawer__dialog" open>
    <div class="cart-drawer__inner">
      <div class="cart-drawer__header"><h2 class="theme-drawer__title">Košík</h2></div>
      <cart-items-component>
        <scroll-hint class="cart-drawer__content" aria-label="Košík">
          <scroll-hint class="cart-drawer__items">${ITEMS}</scroll-hint>
          <div class="cart-drawer__summary">
            <div class="cart-summary"><div class="cart-totals">Mezisoučet 499 Kč</div>
              <div class="cart__ctas"><button type="submit" id="checkout" class="cart__checkout-button button" name="checkout" form="cart-form">Pokladna</button></div>
            </div>
          </div>
        </scroll-hint>
      </cart-items-component>
    </div>
  </dialog>
</cart-drawer-component>`;

/** Dawn: #CartDrawer › drawer__inner › header, cart-drawer-items (the form), drawer__footer (totals, then cart__ctas). */
const DAWN = `<cart-drawer class="drawer active">
  <div id="CartDrawer" class="cart-drawer">
    <div class="drawer__inner">
      <div class="drawer__header"><h2 class="drawer__heading">Košík</h2></div>
      <cart-drawer-items>
        <form action="/cart" id="CartDrawer-Form" class="cart__contents cart-drawer__form" method="post">
          <div id="CartDrawer-CartItems" class="drawer__contents js-contents">${ITEMS}</div>
        </form>
      </cart-drawer-items>
      <div class="drawer__footer">
        <div class="cart-drawer__footer"><div class="totals" role="status"><h2 class="totals__total">Odhadovaný součet</h2><p class="totals__total-value">499 Kč</p></div></div>
        <div class="cart__ctas"><button type="submit" id="CartDrawer-Checkout" class="cart__checkout-button button" name="checkout" form="CartDrawer-Form">Pokladna</button></div>
      </div>
    </div>
  </div>
</cart-drawer>`;

const CART = { token: "t", currency: "CZK", item_count: 1, items: [{ key: "1:a", variant_id: 1, product_id: 1, quantity: 1, original_line_price: 49_900, final_line_price: 49_900, product_title: "Tričko", properties: {} }], total_price: 49_900, original_total_price: 49_900, items_subtotal_price: 49_900, discount_codes: [], attributes: {} };
const RW = { ship: { CZK: 100_000 }, gifts: [], other: false };
const TX = { ms_left: "Ještě {amount} do {reward}", ms_done: "{reward} je vaše", ms_from: "od {amount}", ms_ship: "doprava zdarma", ms_gift: "dárek", code_label: "Slevový kód", code_apply: "Použít", code_remove: "Odebrat" };

/** The page as the shop would serve it with the embed on: the drawer, the embed root, the cart data, the scripts. */
async function drawerPage(drawer: string, dp: string | null, extra = "") {
  const p = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const data = { on: true, ...(dp ? { dp } : {}), rw: RW, mk: "CZK@cz", exp: 2, lang: "cs", proxy: "/apps/won-discounts/cart-plan", g: {}, tx: TX };
  const html = `<!doctype html><html><head><style>${await asset("won-discounts.css")}</style></head><body>${drawer}${extra}
    <div data-won-discounts-embed data-won-discounts-status="loading"></div>
    <script type="application/json" id="won-discounts-cart-data">${JSON.stringify(data)}</script>
    <script>${await asset("won-discounts.js")}</script><script>${await asset("won-discounts-cart.js")}</script></body></html>`;
  await p.route("https://shop.test/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/cart.js") return route.fulfill({ contentType: "application/json", body: JSON.stringify(CART) });
    return route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await p.goto("https://shop.test/");
  return p;
}

/** Where the panel ended up, and whether it is above the main checkout button (in the page and on screen). */
async function placed(p: import("playwright").Page) {
  await p.waitForTimeout(400);
  return p.evaluate(() => {
    const panels = [...document.querySelectorAll("[data-won-discounts-cart]")];
    const cta = document.querySelector('button[name="checkout"]')!;
    return panels.map((panel) => {
      const a = panel.getBoundingClientRect();
      const b = cta.getBoundingClientRect();
      return {
        parent: (panel.parentElement!.className || panel.parentElement!.tagName.toLowerCase()).toString(),
        size: panel.className,
        before: Boolean(panel.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING),
        above: a.height > 0 && a.bottom <= b.top,
        text: panel.textContent!.includes("doprava zdarma"),
      };
    });
  });
}

for (const [theme, drawer, summary, top] of [
  ["Horizon", HORIZON, "cart-drawer__summary", "cart-drawer__content"],
  ["Dawn", DAWN, "drawer__footer", "cart-drawer-items"],
] as const) {
  test(`${theme}: the panel goes right above the checkout button by default (no setting, and "summary"), compact, with the ladder`, async () => {
    for (const dp of [null, "summary"]) {
      const p = await drawerPage(drawer, dp);
      const out = await placed(p);
      assert.equal(out.length, 1, `${dp}: one panel`);
      assert.deepEqual(out[0], { parent: summary, size: "won-cart won-cart--drawer", before: true, above: true, text: true }, `${dp ?? "no setting"}`);
      await p.close();
    }
  });

  test(`${theme}: "top" puts it above the products, still above the checkout button; "off" puts none`, async () => {
    const p = await drawerPage(drawer, "top");
    const out = await placed(p);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { parent: top, size: "won-cart won-cart--drawer", before: true, above: true, text: true });
    const itemsBelow = await p.evaluate(() => {
      const panel = document.querySelector("[data-won-discounts-cart]")!;
      return Boolean(panel.compareDocumentPosition(document.querySelector(".cart-items")!) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert.equal(itemsBelow, true, "above the products");
    await p.close();
    const off = await drawerPage(drawer, "off");
    assert.deepEqual(await placed(off), []);
    await off.close();
  });

  test(`${theme}: a cart tag in the theme wins — the panel only in the tag, none in the drawer's own spot`, async () => {
    const p = await drawerPage(drawer.replace('<div class="cart__ctas">', '<won-discounts show="cart"></won-discounts><div class="cart__ctas">'), "summary");
    const out = await placed(p);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.parent, "won-discounts");
    assert.equal(out[0]!.above, true);
    await p.close();
  });
}
