/*
 * Won Discounts quantity tiers block (MVP 3, contracts K6 + K8). Liquid renders
 * the selected variant; this keeps the table live from the block's JSON, with
 * the pure logic of won-discounts-tiers-core.js (whichever file loads second
 * starts it). The buy form is found by our variant ids and `input.form`, never
 * by nesting (Horizon: block below the grid; Dawn: quantity input outside the
 * form). Never touches or reads the cart (SF-1): cart counts come from Liquid
 * and drop to 0 on the theme's cart-change signal. After every change it
 * dispatches `won-discounts:tiers:update` on document (K8).
 */
(function (w, doc) {
  "use strict";
  if (w.WonDiscountsTiers || w.__wonTiersBoot) return; // loaded twice: keep the first

  var ROOT = "[data-won-discounts-tiers]";
  var core = null;

  function qtyInput(form) {
    var inputs = doc.querySelectorAll('input[name="quantity"]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].form === form || form.contains(inputs[i])) return inputs[i];
    }
    return null;
  }

  // The buy form holds our variant id AND owns the quantity input or a submit
  // button: Dawn and Horizon also render an installment form holding the id in
  // the price block. In the block's own section a buy form wins even while its
  // id is empty (unavailable variant); elsewhere only forms holding our id count.
  function pickForm(root, data, strict) {
    var forms = root ? root.querySelectorAll('form[action*="/cart/add"]') : [];
    var best = null;
    var rank = 0;
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      var id = f.querySelector('[name="id"]');
      if (!id) continue;
      var ours = data.variants.some(function (v) { return String(v.id) === String(id.value); });
      if (strict && !ours) continue;
      var buys = qtyInput(f) || f.querySelector('[name="add"]') || f.querySelector('[type="submit"]');
      var r = 1 + (ours ? 1 : 0) + (buys ? 2 : 0);
      if (r > rank) {
        best = f;
        rank = r;
      }
    }
    return best;
  }

  function locate(el, data) {
    var form = el.__wonForm;
    if (!form || !form.isConnected) {
      form = el.__wonForm = pickForm(el.closest(".shopify-section"), data, false) || pickForm(doc, data, true);
    }
    return form ? { id: form.querySelector('[name="id"]'), qty: qtyInput(form) } : null;
  }

  function readData(el) {
    var node = el.querySelector("[data-won-discounts-tiers-data]");
    var text = node ? node.textContent : "";
    if (text !== el.__wonText) {
      el.__wonText = text;
      el.__wonKey = el.__wonForm = null;
      try {
        el.__wonData = JSON.parse(text);
      } catch (e) {
        el.__wonData = null; // broken JSON: keep the Liquid render
      }
    }
    var data = el.__wonData;
    return data && Array.isArray(data.variants) ? data : null;
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function render(el, data, st) {
    var empty = !st || st.empty;
    el.setAttribute("data-state", empty ? "empty" : "ready");
    el.hidden = empty;
    if (empty) return;
    var t = data.t || {};
    var fmt = data.fmt;
    var byMin = {};
    st.rows.forEach(function (r) { byMin[r.min] = r; });
    var rows = el.querySelectorAll("[data-won-discounts-tier-row]");
    for (var i = 0; i < rows.length; i++) {
      var li = rows[i];
      var r = byMin[li.getAttribute("data-min")];
      if (!r) continue;
      li.hidden = r.d <= 0;
      li.setAttribute("data-active", r === st.active ? "true" : "false");
      setText(li.querySelector(".won-tiers__save"), r.pct != null
        ? core.fill(t.save_pct, { pct: core.pctText(r.pct, data.lang) })
        : core.fill(t.save_off, { amount: core.money(r.d, fmt) }));
      setText(li.querySelector(".won-tiers__unit"), core.fill(t.unit, { price: core.money(r.unit, fmt) }));
    }
    var live = el.querySelector("[data-won-discounts-live-price]");
    if (live) {
      var inCart = st.count - st.qty;
      live.setAttribute("data-unit-cents", String(st.unit));
      setText(live, core.fill(inCart > 0 ? t.live_cart : t.live, {
        qty: st.qty, total: core.money(st.total, fmt), price: core.money(st.unit, fmt), cart: inCart
      }));
    }
    var next = el.querySelector("[data-won-discounts-tier-next]");
    if (next) {
      next.hidden = !st.next;
      if (st.next) {
        setText(next, core.fill(t.next, { count: st.next.min - st.count, price: core.money(st.next.unit, fmt) }));
      }
    }
  }

  function update(el) {
    var data = readData(el);
    if (!data) return;
    var loc = locate(el, data);
    var id = loc && loc.id ? loc.id.value : data.sel;
    var qty = loc && loc.qty ? parseInt(loc.qty.value, 10) : 1;
    if (!(qty > 0)) qty = 1;
    var key = id + "|" + qty;
    if (key === el.__wonKey) return;
    el.__wonKey = key;
    var st = core.compute(data, id, qty);
    render(el, data, st);
    doc.dispatchEvent(new CustomEvent("won-discounts:tiers:update", {
      detail: {
        variantId: st ? st.variantId : Number(id) || null,
        quantity: qty,
        count: st ? st.count : qty,
        min: st && st.active ? st.active.min : 0,
        unitCents: st ? st.unit : null
      }
    }));
  }

  function scan() {
    hookDawn();
    var roots = doc.querySelectorAll(ROOT);
    for (var i = 0; i < roots.length; i++) update(roots[i]);
  }

  // K6 (amended): a cart change zeroes the counts that came from the cart; they
  // are never re-read (0 only ever under-promises). A new Liquid render of the
  // block brings fresh ones (its JSON text changes, so readData parses it again).
  function zero() {
    var roots = doc.querySelectorAll(ROOT);
    for (var i = 0; i < roots.length; i++) {
      var data = readData(roots[i]);
      if (!data) continue;
      data.cart = { p: 0, s: 0 };
      data.variants.forEach(function (v) { v.c = 0; });
      roots[i].__wonKey = null;
    }
    schedule(0);
  }

  // Dawn's cart signal is its pubsub global `subscribe` (deferred pubsub.js may run after us).
  var hooked = false;
  function hookDawn() {
    if (!hooked && typeof w.subscribe === "function") {
      hooked = true;
      w.subscribe("cart-update", zero);
    }
  }

  // A debounce that never shortens a pending later rescan: a click right after a
  // promise-less product:select must not rescan before the theme swapped the variant.
  var timer = null;
  var due = 0;
  function schedule(delay) {
    var at = Date.now() + delay;
    if (timer !== null && due >= at) return;
    clearTimeout(timer);
    due = at;
    timer = setTimeout(function () {
      timer = null;
      scan();
    }, delay);
  }
  function now() {
    schedule(0);
  }

  function boot() {
    if (core) return;
    core = w.WonDiscountsTiersCore;
    // Capture phase: also events a theme stops. "click" = steppers without events;
    // "quantity-selector:update" = Horizon's plus/minus.
    ["input", "change", "click", "quantity-selector:update", "shopify:section:load"].forEach(function (name) {
      doc.addEventListener(name, now, true);
    });
    // Cart changes: Horizon's standard storefront event (older Horizon: cart:update).
    ["shopify:cart:lines-update", "cart:update"].forEach(function (name) {
      doc.addEventListener(name, zero, true);
    });
    // Horizon morphs the form and sets input[name=id] without a change event.
    doc.addEventListener("shopify:product:select", function (event) {
      if (event && event.promise && typeof event.promise.then === "function") event.promise.then(now, now);
      else schedule(300);
    }, true);

    w.WonDiscountsTiers = {
      version: "0.3.1-mvp3",
      offered: core.offered,
      discount: core.discount,
      lineDiscount: core.lineDiscount,
      countOf: core.countOf,
      compute: core.compute,
      money: core.money,
      fill: core.fill,
      scan: scan
    };

    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", scan);
    } else {
      scan();
      doc.addEventListener("DOMContentLoaded", hookDawn);
    }
  }

  if (w.WonDiscountsTiersCore) boot();
  else w.__wonTiersBoot = boot;
})(window, document);
