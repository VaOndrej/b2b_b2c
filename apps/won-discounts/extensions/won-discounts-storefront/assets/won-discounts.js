/* Won Discounts — won-discounts.js (app embed). Notes: extensions/won-discounts-storefront/README.md */
((w) => {
  "use strict";
  if (w.WonDiscounts && w.WonDiscounts.ready) return;
  const GIFT = "_won_gift";
  const DECLINED = "_won_gift_declined";

  const readJson = (id) => {
    try {
      const v = JSON.parse(document.getElementById(id)?.textContent || "{}");
      return v && typeof v === "object" ? v : {};
    } catch (err) {
      return {};
    }
  };
  const giftOf = (item) => {
    const v = item?.properties?.[GIFT];
    return typeof v === "string" && v !== "" ? v : null;
  };
  const declinedOf = (cart) => String(cart.attributes?.[DECLINED] || "").split(",").filter(Boolean);
  const plain = (cart) => (cart.items || []).filter((item) => !giftOf(item));
  const base = (cart) => plain(cart).reduce((s, item) => s + (item.original_line_price || 0), 0);
  const afterBase = (cart) =>
    plain(cart).reduce((s, item) => s + (item.final_line_price || 0), 0) -
    (cart.cart_level_discount_applications || []).reduce((s, a) => s + (a.total_allocated_amount || 0), 0);

  const plan = (cart, rw, facts, mk) => {
    const cur = cart.currency;
    // A threshold of the cart's own market ("EUR@sk", `mk`) first, then its currency's.
    const at = (m) => (m && typeof m[mk] === "number" ? m[mk] : m?.[cur]);
    const b = base(cart);
    const after = afterBase(cart);
    const declined = declinedOf(cart);
    const out = { base: b, ship: null, tiers: [], add: null, remove: [] };
    const ship = at(rw.ship);
    if (typeof ship === "number") out.ship = { threshold: ship, remaining: Math.max(0, ship - b), reached: b >= ship };
    const ok = (o) => o && facts[o.v]?.a !== false;
    for (const g of rw.gifts || []) {
      const threshold = at(g.t);
      const offered = [...(g.c || []), g.f].filter(Boolean).map((o) => o.v);
      const tagged = (cart.items || []).filter((item) => giftOf(item) === g.id);
      const mine = tagged.filter((item) => offered.includes(item.variant_id));
      const reached = typeof threshold === "number" && b >= threshold;
      const lost = !!rw.other && reached && after < threshold;
      const due = reached && !lost;
      out.remove.push(...(due ? tagged.filter((item) => !mine.includes(item)) : tagged).map((item) => item.key));
      if (typeof threshold !== "number") continue;
      let options = (g.c || []).filter(ok);
      if (!options.length && ok(g.f)) options = [g.f];
      const tier = {
        id: g.id,
        threshold,
        remaining: Math.max(0, threshold - b),
        reached,
        lost,
        due,
        left: Math.max(0, threshold - (rw.other ? after : b)),
        line: mine[0] || null,
        options,
        declined: declined.includes(g.id),
        soldOut: !options.length,
      };
      out.tiers.push(tier);
      if (due && !tier.line && !tier.declined && options.length === 1 && !out.add) out.add = { tier: g.id, variant: options[0].v };
    }
    return out;
  };

  const money = (cents, cur) => {
    try {
      return new Intl.NumberFormat(document.documentElement.lang || "cs", { style: "currency", currency: cur, minimumFractionDigits: 0 }).format(cents / 100);
    } catch (err) {
      return `${cents / 100} ${cur}`;
    }
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const fill = (text, values) => String(text || "").replace(/\{(\w+)\}/g, (m, k) => (values[k] === undefined ? m : String(values[k])));

  const bar = (left, threshold) => {
    const pct = threshold > 0 ? Math.min(100, Math.round(((threshold - left) * 100) / threshold)) : 100;
    return `<div class="won-cart__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>`;
  };

  const giftRow = (x, data, t) => {
    const head = `<div class="won-cart__row" data-won-discounts-gift="${esc(x.id)}" data-state=`;
    if (x.line) return `${head}"in"><p>${t("gift_done")} <button type="button" data-won-decline="${esc(x.id)}">${t("gift_decline")}</button></p></div>`;
    if (x.declined) return `${head}"declined"><p>${t("gift_declined")}</p></div>`;
    if (x.soldOut) return `${head}"soldout"><p>${t("gift_soldout")}</p></div>`;
    const buttons = x.options.map((o) => `<button type="button" data-won-add="${esc(x.id)}" data-variant="${o.v}">${esc(data.g?.[o.v]?.t || data.tx?.gift_add)}</button>`);
    return `${head}"pick"><p>${t("gift_pick")}</p>${buttons.join(" ")}</div>`;
  };

  const html = ({ view, cart, data, hint, warn }) => {
    const t = (key, values = {}) => esc(fill(data.tx?.[key] || key, values));
    const m = (cents) => money(cents, cart.currency);
    const codes = (cart.discount_codes || []).map((c) => c.code);
    let out = "";
    const s = view.ship;
    if (s) out += `<div class="won-cart__row" data-won-discounts-progress="shipping"><p>${s.reached ? t("ship_done") : t("ship_left", { amount: m(s.remaining) })}</p>${bar(s.remaining, s.threshold)}</div>`;
    const shown = (x) => x.due || (x.line && x.reached);
    out += view.tiers.filter(shown).map((x) => giftRow(x, data, t)).join("");
    const next = view.tiers.find((x) => !shown(x));
    if (next) out += `<div class="won-cart__row" data-won-discounts-progress="gift"><p>${t("gift_left", { amount: m(next.left) })}</p>${bar(next.left, next.threshold)}</div>`;
    if (hint) out += `<p class="won-cart__hint" data-won-discounts-hint>${hint}</p>`;
    out += `<form class="won-cart__code" data-won-discounts-code><label>${t("code_label")} <input name="won-code" autocomplete="off" maxlength="255"></label><button type="submit">${t("code_apply")}</button></form>`;
    out += codes.map((c) => `<p class="won-cart__applied">${esc(c)} <button type="button" data-won-drop="${esc(c)}">${t("code_remove")}</button></p>`).join("");
    if (warn?.invalid) out += `<p class="won-cart__warn" role="alert">${t("code_invalid", { code: warn.invalid })}</p>`;
    if (warn?.loses) {
      out += `<div class="won-cart__warn" role="alert" data-won-discounts-code-warning><p>${t("code_loses_gift", { code: warn.loses })}</p><button type="button" data-won-keep>${t("keep_code")}</button> <button type="button" data-won-drop="${esc(warn.loses)}">${t("drop_code")}</button></div>`;
    }
    const saved = (cart.original_total_price || 0) - (cart.total_price || 0);
    if (saved > 0) out += `<p class="won-cart__saved" data-won-discounts-saved>${t("saved", { amount: m(saved) })}</p>`;
    return out;
  };

  const boot = () => {
    const root = document.querySelector("[data-won-discounts-embed]");
    if (!root || root.__wonDiscountsInit) return;
    root.__wonDiscountsInit = true;
    window.WonDiscounts = {
      version: "4",
      config: readJson("won-discounts-config"),
      cart: readJson("won-discounts-cart-data"),
      giftOf,
      base,
      afterBase,
      plan,
      money,
      fill,
      esc,
      html,
      GIFT,
      DECLINED,
      ready: true,
    };
    root.setAttribute("data-won-discounts-status", "ready");
    if (typeof w.__wonCartBoot === "function") w.__wonCartBoot();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
