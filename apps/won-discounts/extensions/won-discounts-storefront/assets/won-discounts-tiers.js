/* Won Discounts — won-discounts-tiers.js. Notes: extensions/won-discounts-storefront/README.md */
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
    var fmt = core.sampleFormat(data.ms) || data.fmt;
    var byMin = {};
    st.rows.forEach(function (r) { byMin[r.min] = r; });
    var rows = el.querySelectorAll("[data-won-discounts-tier-row]");
    for (var i = 0; i < rows.length; i++) {
      var li = rows[i];
      var r = byMin[li.getAttribute("data-min")];
      if (!r) continue;
      li.hidden = r.d <= 0;
      li.setAttribute("data-active", r === st.active ? "true" : "false");
      if (r === st.active) li.setAttribute("aria-current", "true");
      else li.removeAttribute("aria-current");
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
    var sc = w.Shopify && w.Shopify.currency;
    var rate = sc && sc.active === data.cur ? Number(sc.rate) : null;
    var key = id + "|" + qty + "|" + rate;
    if (key === el.__wonKey) return;
    el.__wonKey = key;
    var st = core.compute(data, id, qty, rate);
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

  // The cart changed: take the block's data from a fresh render of its own section (the Liquid that counts
  // the cart). Old counts stay until the answer; when it cannot be read, zero() (never more than checkout).
  var DATA = /<script type="application\/json" data-won-discounts-tiers-data>([\s\S]*?)<\/script>/g;
  var turn = 0;
  function refresh(event) {
    var n = ++turn;
    var wait = event && event.promise;
    if (wait && typeof wait.then === "function") wait.then(go, go);
    else go();
    function go() {
      if (n !== turn) return;
      var roots = doc.querySelectorAll(ROOT);
      var section = roots.length ? roots[0].closest(".shopify-section") : null;
      var id = section ? String(section.getAttribute("id") || "").replace("shopify-section-", "") : "";
      var loc = w.location;
      if (!id || !loc || typeof w.fetch !== "function") return zero();
      var variant = /[?&]variant=(\d+)/.exec(loc.search || "");
      w.fetch(loc.pathname + "?section_id=" + encodeURIComponent(id) + (variant ? "&variant=" + variant[1] : "")).then(function (res) {
        return res.ok ? res.text() : null;
      }).then(function (html) {
        if (n !== turn) return;
        var texts = [];
        var m;
        DATA.lastIndex = 0;
        while (html && (m = DATA.exec(html))) texts.push(m[1]);
        if (!texts.length) return zero();
        for (var i = 0; i < roots.length; i++) {
          var node = roots[i].querySelector("[data-won-discounts-tiers-data]");
          if (node && texts[i] != null) node.textContent = texts[i];
        }
        schedule(0);
      }).catch(function () {
        if (n === turn) zero();
      });
    }
  }

  var hooked = false;
  function hookDawn() {
    if (!hooked && typeof w.subscribe === "function") {
      hooked = true;
      w.subscribe("cart-update", function () { refresh(); });
    }
  }

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
    ["input", "change", "click", "quantity-selector:update", "shopify:section:load"].forEach(function (name) {
      doc.addEventListener(name, now, true);
    });
    ["shopify:cart:lines-update", "cart:update"].forEach(function (name) {
      doc.addEventListener(name, refresh, true);
    });
    doc.addEventListener("shopify:product:select", function (event) {
      if (event && event.promise && typeof event.promise.then === "function") event.promise.then(now, now);
      else schedule(300);
    }, true);

    w.WonDiscountsTiers = {
      version: "0.3.1-mvp3",
      exp: core.exp,
      floorUnits: core.floorUnits,
      sampleFormat: core.sampleFormat,
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
