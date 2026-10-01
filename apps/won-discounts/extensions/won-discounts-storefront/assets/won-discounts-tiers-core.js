/*
 * Won Discounts quantity tiers: pure logic (MVP 3, contracts K2, K4 v2, K5, K6).
 * No DOM, no network: won-discounts-tiers.js renders with it. Split off so each
 * file stays under Theme Check's 10 000 B raw limit and readable (no build).
 * The block loads it with `defer`; whichever of the two files runs second
 * starts the block (window.__wonTiersBoot). Money = Liquid units (major x 100).
 */
(function (w) {
  "use strict";
  if (w.WonDiscountsTiersCore) return;

  var has = Object.prototype.hasOwnProperty;

  // ISO 4217 minor digits other than 2 (= core money.ts MINOR_DIGITS).
  var EXP0 = " BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF ";
  var EXP3 = " BHD IQD JOD KWD LYD OMR TND ";
  function exp(cur) {
    var c = " " + String(cur).toUpperCase() + " ";
    return EXP0.indexOf(c) >= 0 ? 0 : EXP3.indexOf(c) >= 0 ? 3 : 2;
  }

  // K4 v2: the item's floor in Liquid units of the cart currency. `f` = minor units
  // of the shop currency `sc`; another currency converts with the shop -> cart
  // rate, rounded up + 1 minor unit; no usable rate = null (nothing is promised).
  function floorUnits(f, sc, cur, rate) {
    var minor;
    if (!sc || !(f >= 0)) return null;
    if (cur === sc) minor = f;
    else if (rate > 0 && isFinite(rate)) minor = Math.ceil((f * rate * Math.pow(10, exp(cur))) / Math.pow(10, exp(sc))) + 1;
    else return null;
    return Math.ceil((minor * 100) / Math.pow(10, exp(cur)));
  }

  // The per-item discount ceiling of a variant (K4 v2 / K6): `f` = price - floor;
  // `m` = price x m / 100 rounded down to a minor unit (g), the percent ceiling of a
  // variant without a cost; neither (a cost without a matching floor) = null: no
  // table for it (fail closed).
  function capOf(v, data, rate, g) {
    if (v.f != null) {
      var fl = floorUnits(v.f, data.sc, data.cur, rate);
      return fl === null ? null : Math.max(0, v.p - fl);
    }
    return v.m != null ? Math.floor((v.p * v.m) / 100 / g) * g : null;
  }

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

  // Per item (the table): the percent rounded DOWN, or the amount; never above the
  // ceiling `cap` or the price, so never more than checkout gives at any quantity.
  // `g` = Liquid units per minor unit (100 for JPY & co.: Liquid counts yen x 100).
  function discount(b, price, cap, g) {
    g = g || 1;
    var d = b.pct != null ? Math.floor((price * b.pct) / 100 / g) * g : b.off;
    return Math.max(0, Math.min(d, cap, price));
  }

  // Per line, like the engine: a percent rounds once per line (in minor units); the
  // margin allows quantity x the per-item ceiling (P2-1: the engine's floor is per item).
  function lineDiscount(b, price, cap, qty, g) {
    g = g || 1;
    if (b.pct == null) return discount(b, price, cap, g) * qty;
    return Math.max(0, Math.min(Math.round((price * qty * b.pct) / 100 / g) * g, cap * qty, price * qty));
  }

  // K6: the chosen quantity + the cart items counted toward the same tier.
  function countOf(mode, qty, inCart) {
    var extra = mode === "line" ? inCart.v : mode === "product" ? inCart.p : mode === "cart" ? inCart.s : 0;
    return qty + (extra > 0 ? extra : 0);
  }

  // The block's state for a variant, quantity and shop -> cart rate. Tier = the
  // highest min <= count (K2); `total` = the line after the discount, `unit` = its
  // per-item price; next = the nearest tier that lowers the per-item price. A row
  // capped by the margin says the percent it really gives (floored to 0.1).
  function compute(data, variantId, qty, rate) {
    var v = (data.variants || []).filter(function (x) {
      return String(x.id) === String(variantId);
    })[0];
    var g = exp(data.cur) === 0 ? 100 : 1;
    var cap = v ? capOf(v, data, rate, g) : null;
    if (cap === null) return null;
    var cart = data.cart || {};
    var count = countOf(data.count, qty, { v: v.c, p: cart.p, s: cart.s });
    var active = null;
    var next = null;
    var rows = offered(data.breaks, data.cur).map(function (b) {
      var d = discount(b, v.p, cap, g);
      var pct = null;
      if (b.pct != null) {
        var full = discount(b, v.p, v.p, g);
        pct = d >= full ? b.pct : v.m != null ? Math.min(b.pct, v.m) : v.p > 0 ? Math.floor((d * 1000) / v.p) / 10 : 0;
      }
      var r = { min: b.min, pct: pct, d: d, unit: v.p - d, b: b };
      if (r.min <= count && (!active || r.min > active.min)) active = r;
      return r;
    });
    var line = active ? lineDiscount(active.b, v.p, cap, qty, g) : 0;
    var unit = v.p - Math.floor(line / qty / g) * g;
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

  // The theme's money format like Liquid's money filter:
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

  // The ACTIVE currency's money format, read back from Liquid's own rendering of
  // 1 234 567,89 (`{{ 123456789 | money }}`): shop.money_format can be the shop
  // currency's. Returns a format for money(), or null when the sample is unusual.
  function sampleFormat(sample) {
    var m = /\d[\d.,'\s\u00a0\u202f]*\d/.exec(String(sample || ""));
    if (!m) return null;
    var digits = m[0].replace(/\D/g, "");
    var seps = (m[0].match(/\D+/g) || []).map(function (s) { return /^\s+$/.test(s) ? " " : s; });
    var dec = digits === "1234568" ? 0 : digits.indexOf("123456789") === 0 ? 2 : -1;
    if (dec < 0 || seps.length > (dec ? 3 : 2)) return null;
    var th = seps.length > (dec ? 1 : 0) ? seps[0] : ",";
    var mark = dec ? seps[seps.length - 1] : ".";
    for (var key in FORMATS) {
      var f = FORMATS[key];
      if (f[0] === th && f[2] === dec && (!dec || f[1] === mark)) {
        return String(sample).slice(0, m.index) + "{{" + key + "}}" + String(sample).slice(m.index + m[0].length);
      }
    }
    return null;
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
    exp: exp,
    floorUnits: floorUnits,
    offered: offered,
    discount: discount,
    lineDiscount: lineDiscount,
    countOf: countOf,
    compute: compute,
    money: money,
    sampleFormat: sampleFormat,
    fill: fill,
    pctText: pctText
  };
  if (typeof w.__wonTiersBoot === "function") w.__wonTiersBoot();
})(window);
