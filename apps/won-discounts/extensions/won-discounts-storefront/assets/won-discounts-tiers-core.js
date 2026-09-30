/*
 * Won Discounts quantity tiers: pure logic (MVP 3, contracts K2, K5, K6).
 * No DOM, no network: won-discounts-tiers.js renders with it. Split off so each
 * file stays under Theme Check's 10 000 B raw limit and readable (no build).
 * The block loads it with `defer`; whichever of the two files runs second
 * starts the block (window.__wonTiersBoot). Money = Liquid units (major x 100).
 */
(function (w) {
  "use strict";
  if (w.WonDiscountsTiersCore) return;

  var has = Object.prototype.hasOwnProperty;

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

  // K6 per item (the table): min(pct, max) % of the price or min(off, price x max / 100),
  // rounded DOWN and never above the price, so it never shows more than checkout
  // gives at any quantity.
  function discount(b, price, max) {
    var d = b.pct != null
      ? Math.floor((price * Math.min(b.pct, max)) / 100)
      : Math.min(b.off, Math.floor((price * max) / 100));
    return Math.max(0, Math.min(d, price));
  }

  // K6 per line, like the engine: a percent rounds once per line (capped by the
  // margin ceiling of the line); an amount is the per-item value x quantity.
  function lineDiscount(b, price, max, qty) {
    if (b.pct == null) return discount(b, price, max) * qty;
    var d = Math.round((price * qty * Math.min(b.pct, max)) / 100);
    return Math.max(0, Math.min(d, Math.floor((price * qty * max) / 100)));
  }

  // K6: the chosen quantity + the cart items counted toward the same tier.
  function countOf(mode, qty, inCart) {
    var extra = mode === "line" ? inCart.v : mode === "product" ? inCart.p : mode === "cart" ? inCart.s : 0;
    return qty + (extra > 0 ? extra : 0);
  }

  // The block's state for a variant and quantity. Tier = the highest min <= count
  // (K2); `total` = the line after the discount, `unit` = its per-item price
  // (floored discount); next = the nearest tier that lowers the per-item price.
  function compute(data, variantId, qty) {
    var v = (data.variants || []).filter(function (x) {
      return String(x.id) === String(variantId);
    })[0];
    if (!v) return null;
    var cart = data.cart || {};
    var count = countOf(data.count, qty, { v: v.c, p: cart.p, s: cart.s });
    var active = null;
    var next = null;
    var rows = offered(data.breaks, data.cur).map(function (b) {
      var d = discount(b, v.p, v.m);
      var r = { min: b.min, pct: b.pct != null ? Math.min(b.pct, v.m) : null, d: d, unit: v.p - d, b: b };
      if (r.min <= count && (!active || r.min > active.min)) active = r;
      return r;
    });
    var line = active ? lineDiscount(active.b, v.p, v.m, qty) : 0;
    var unit = v.p - Math.floor(line / qty);
    rows.forEach(function (r) {
      if (r.min > count && r.unit < unit && (!next || r.min < next.min)) next = r;
    });
    return {
      variantId: v.id,
      qty: qty,
      count: count,
      rows: rows,
      active: active,
      unit: unit,
      total: v.p * qty - line,
      next: next,
      empty: !rows.some(function (r) { return r.d > 0; })
    };
  }

  // The theme's money format (shop.money_format) like Liquid's money filter:
  // placeholder -> [thousands separator, decimal mark, decimals].
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

  // "{name}" placeholders of the locale files and merchant texts.
  function fill(template, vars) {
    return String(template == null ? "" : template).replace(/\{(\w+)\}/g, function (all, key) {
      return has.call(vars, key) ? String(vars[key]) : all;
    });
  }

  // A percent for display: one decimal at most, a decimal comma outside English.
  function pctText(n, lang) {
    var s = String(Math.round(n * 10) / 10);
    return lang === "en" ? s : s.replace(".", ",");
  }

  w.WonDiscountsTiersCore = {
    offered: offered,
    discount: discount,
    lineDiscount: lineDiscount,
    countOf: countOf,
    compute: compute,
    money: money,
    fill: fill,
    pctText: pctText
  };
  if (typeof w.__wonTiersBoot === "function") w.__wonTiersBoot();
})(window);
