/*
 * Won Discounts quantity tiers block (MVP 3, contracts K6 + K8). Liquid renders
 * the selected variant; this keeps the table live from the block's JSON. The
 * product form is found by our variant ids and `input.form`, never by nesting
 * (Horizon: block below the grid; Dawn: quantity input outside the form). On
 * `shopify:product:select` it waits for `event.promise`, then rescans. Never
 * touches the cart (SF-1); cart quantities come from Liquid. Dispatches
 * `won-discounts:tiers:update` after every change. Money = Liquid units (x100).
 */
(function (w, doc) {
  "use strict";
  if (w.WonDiscountsTiers) return; // loaded twice: keep the first

  var has = Object.prototype.hasOwnProperty;

  /* pure logic (node tests run this file in a vm) */

  // K5 breaks for the cart currency; an amount without a value there is not offered (MKT-1).
  function offered(breaks, cur) {
    var out = [];
    (Array.isArray(breaks) ? breaks : []).forEach(function (b) {
      if (!b || !(b.min > 0)) return;
      if (typeof b.pct === "number") out.push({ min: b.min, pct: b.pct });
      else if (b.off && typeof b.off[cur] === "number") out.push({ min: b.min, off: b.off[cur] });
    });
    return out;
  }

  // K6 per item: min(pct, max) % of the price, or min(off, price x max / 100); <= price.
  function discount(b, price, max) {
    var cap = Math.floor((price * max) / 100);
    var d = b.pct != null ? Math.round((price * Math.min(b.pct, max)) / 100) : b.off;
    return Math.max(0, Math.min(d, cap, price));
  }

  // K6: the chosen quantity + cart items counted toward the same tier.
  function countOf(mode, qty, inCart) {
    var extra = mode === "line" ? inCart.v : mode === "product" ? inCart.p : mode === "cart" ? inCart.s : 0;
    return qty + (extra > 0 ? extra : 0);
  }

  // Tier = highest min <= count (K2); next = the nearest one that lowers the price.
  function compute(data, variantId, qty) {
    var v = null;
    (data.variants || []).forEach(function (x) {
      if (String(x.id) === String(variantId)) v = x;
    });
    if (!v) return null;
    var cart = data.cart || {};
    var count = countOf(data.count, qty, { v: v.c, p: cart.p, s: cart.s });
    var active = null;
    var next = null;
    var rows = offered(data.breaks, data.cur).map(function (b) {
      var d = discount(b, v.p, v.m);
      var r = { min: b.min, pct: b.pct != null ? Math.min(b.pct, v.m) : null, d: d, unit: v.p - d };
      if (r.min <= count && (!active || r.min > active.min)) active = r;
      return r;
    });
    var unit = active ? active.unit : v.p;
    rows.forEach(function (r) {
      if (r.min > count && r.unit < unit && (!next || r.min < next.min)) next = r;
    });
    var empty = !rows.some(function (r) {
      return r.d > 0;
    });
    return { variantId: v.id, qty: qty, count: count, rows: rows, active: active, unit: unit, next: next, empty: empty };
  }

  // shop.money_format like Liquid's money filter: [thousands, decimal mark, decimals].
  var FORMATS = {
    amount: [",", ".", 2],
    amount_no_decimals: [",", ".", 0],
    amount_with_comma_separator: [".", ",", 2],
    amount_no_decimals_with_comma_separator: [".", ",", 0],
    amount_with_space_separator: [" ", ",", 2],
    amount_no_decimals_with_space_separator: [" ", ".", 0],
    amount_with_period_and_space_separator: [" ", ".", 2],
    amount_with_apostrophe_separator: ["'", ".", 2]
  };
  function money(cents, fmt) {
    return String(fmt || "{{amount}}").replace(/\{\{\s*(\w+)\s*\}\}/g, function (all, key) {
      if (!has.call(FORMATS, key)) return all;
      var f = FORMATS[key];
      var parts = (Math.round(cents) / 100).toFixed(f[2]).split(".");
      return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, f[0]) + (f[2] ? f[1] + parts[1] : "");
    });
  }

  // "{name}" placeholders of the locale and merchant texts.
  function fill(template, vars) {
    return String(template == null ? "" : template).replace(/\{(\w+)\}/g, function (all, key) {
      return has.call(vars, key) ? String(vars[key]) : all;
    });
  }

  function pctText(n, lang) {
    var s = String(Math.round(n * 10) / 10);
    return lang === "en" ? s : s.replace(".", ",");
  }

  /* DOM */

  // The section's /cart/add form holding our variant id (else its first one,
  // e.g. while the id is empty); else any form on the page holding ours.
  function pickForm(root, data, strict) {
    if (!root) return null;
    var forms = root.querySelectorAll('form[action*="/cart/add"]');
    var loose = null;
    for (var i = 0; i < forms.length; i++) {
      var id = forms[i].querySelector('[name="id"]');
      if (!id) continue;
      if (data.variants.some(function (v) { return String(v.id) === String(id.value); })) return forms[i];
      if (!loose) loose = forms[i];
    }
    return strict ? null : loose;
  }

  function locate(el, data) {
    var form = el.__wonForm;
    if (!form || !form.isConnected) {
      form = pickForm(el.closest(".shopify-section"), data, false) || pickForm(doc, data, true);
      el.__wonForm = form;
    }
    if (!form) return null;
    var inputs = doc.querySelectorAll('input[name="quantity"]');
    var qty = null;
    for (var i = 0; i < inputs.length && !qty; i++) {
      if (inputs[i].form === form || form.contains(inputs[i])) qty = inputs[i];
    }
    return { id: form.querySelector('[name="id"]'), qty: qty };
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
    var rows = el.querySelectorAll("[data-won-discounts-tier-row]");
    for (var i = 0; i < rows.length; i++) {
      var li = rows[i];
      var r = null;
      st.rows.forEach(function (x) {
        if (String(x.min) === li.getAttribute("data-min")) r = x;
      });
      if (!r) continue;
      li.hidden = r.d <= 0;
      li.setAttribute("data-active", r === st.active ? "true" : "false");
      setText(li.querySelector(".won-tiers__save"), r.pct != null
        ? fill(t.save_pct, { pct: pctText(r.pct, data.lang) })
        : fill(t.save_off, { amount: money(r.d, fmt) }));
      setText(li.querySelector(".won-tiers__unit"), fill(t.unit, { price: money(r.unit, fmt) }));
    }
    var live = el.querySelector("[data-won-discounts-live-price]");
    if (live) {
      var inCart = st.count - st.qty;
      live.setAttribute("data-unit-cents", String(st.unit));
      setText(live, fill(inCart > 0 ? t.live_cart : t.live, {
        qty: st.qty, total: money(st.unit * st.qty, fmt), price: money(st.unit, fmt), cart: inCart
      }));
    }
    var next = el.querySelector("[data-won-discounts-tier-next]");
    if (next) {
      next.hidden = !st.next;
      if (st.next) setText(next, fill(t.next, { count: st.next.min - st.count, price: money(st.next.unit, fmt) }));
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
    var st = compute(data, id, qty);
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
    var roots = doc.querySelectorAll("[data-won-discounts-tiers]");
    for (var i = 0; i < roots.length; i++) update(roots[i]);
  }

  var timer = null;
  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(scan, delay || 0);
  }
  function now() {
    schedule(0);
  }

  // Capture: also events a theme stops. "click" = steppers without events;
  // "quantity-selector:update" = Horizon's plus/minus.
  ["input", "change", "click", "quantity-selector:update", "shopify:section:load"].forEach(function (name) {
    doc.addEventListener(name, now, true);
  });
  doc.addEventListener("shopify:product:select", function (event) {
    if (event && event.promise && typeof event.promise.then === "function") event.promise.then(now, now);
    else schedule(300);
  }, true);

  w.WonDiscountsTiers = {
    version: "0.3.0-mvp3",
    offered: offered,
    discount: discount,
    countOf: countOf,
    compute: compute,
    money: money,
    fill: fill,
    scan: scan
  };

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", scan);
  else scan();
})(window, document);
