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
    // A negative one = this market is left without a threshold (not the currency's fallback).
    const at = (m) => {
      const v = m && typeof m[mk] === "number" ? m[mk] : m?.[cur];
      return v > 0 ? v : undefined;
    };
    const b = base(cart);
    const after = afterBase(cart);
    const declined = declinedOf(cart);
    const out = { base: b, ship: null, tiers: [], add: null, remove: [], steps: [] };
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
    /* Milníky: one ladder — free shipping, the gifts and the order-discount steps (rw.disc), lowest cart value first. */
    const s = out.steps;
    if (out.ship) s.push({ k: "s", at: ship, left: out.ship.remaining, done: out.ship.reached });
    for (const x of out.tiers) s.push({ k: "g", at: x.threshold, left: x.left, done: x.due, v: x.options.length === 1 ? x.options[0].v : 0 });
    for (const d of rw.disc || []) {
      const a = at(d.t);
      const off = d.off ? at(d.off) : 0;
      if (a && (d.pct || off)) s.push({ k: "d", id: d.id, at: a, left: Math.max(0, a - b), done: b >= a, pct: d.pct, off });
    }
    s.sort((x, y) => x.at - y.at);
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

  /* The ladder in one of three sizes: "bar" (a sentence + a thin track), "compact" (+ a mark per step), "full" (+ every step, the reached ones ticked). */
  const ladder = (view, size, data, cur) => {
    const steps = view.steps || [];
    if (!steps.length) return "";
    const tx = data.tx || {};
    const name = (x) => {
      const gift = x.k === "g" && data.g?.[x.v]?.t;
      return x.k === "s" ? tx.ms_ship : x.k === "d" ? fill(tx.n?.[x.id] || tx.ms_disc, { value: x.pct ? `${x.pct}\u00a0%` : money(x.off, cur) }) : gift ? fill(tx.ms_gift_named, { name: gift }) : tx.ms_gift;
    };
    const top = steps[steps.length - 1].at;
    const pct = (n) => Math.max(0, Math.min(100, Math.round((n * 100) / top)));
    const next = steps.find((x) => !x.done);
    const now = next ? pct(next.at - next.left) : 100;
    let out = `<div class="won-ms won-ms--${size}" data-won-ms="${size}"><p class="won-ms__text">${esc(next ? fill(tx.ms_left, { amount: money(next.left, cur), reward: name(next) }) : tx.ms_done)}</p>`;
    out += `<div class="won-ms__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${now}"><span style="width:${now}%"></span>`;
    if (size !== "bar") out += steps.map((x) => `<i style="left:${pct(x.at)}%"${x.done ? " data-done" : ""}></i>`).join("");
    out += "</div>";
    if (size === "full") out += `<ol class="won-ms__list">${steps.map((x) => `<li data-won-ms-step="${x.k}"${x.done ? " data-done" : ""}><span>${esc(name(x))}</span><span>${esc(fill(tx.ms_from, { amount: money(x.at, cur) }))}</span></li>`).join("")}</ol>`;
    return `${out}</div>`;
  };

  const giftRow = (x, data, t) => {
    const head = `<div class="won-cart__row" data-won-discounts-gift="${esc(x.id)}" data-state=`;
    if (x.line) return `${head}"in"><p>${t("gift_done")} <button type="button" data-won-decline="${esc(x.id)}">${t("gift_decline")}</button></p></div>`;
    if (x.declined) return `${head}"declined"><p>${t("gift_declined")}</p></div>`;
    if (x.soldOut) return `${head}"soldout"><p>${t("gift_soldout")}</p></div>`;
    const buttons = x.options.map((o) => `<button type="button" data-won-add="${esc(x.id)}" data-variant="${o.v}">${esc(data.g?.[o.v]?.t || data.tx?.gift_add)}</button>`);
    return `${head}"pick"><p>${t("gift_pick")}</p>${buttons.join(" ")}</div>`;
  };

  const html = ({ view, cart, data, hint, warn, size }) => {
    const t = (key, values = {}) => esc(fill(data.tx?.[key] || key, values));
    const m = (cents) => money(cents, cart.currency);
    const codes = (cart.discount_codes || []).map((c) => c.code);
    let out = ladder(view, size || "compact", data, cart.currency);
    const shown = (x) => x.due || (x.line && x.reached);
    out += view.tiers.filter(shown).map((x) => giftRow(x, data, t)).join("");
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
      version: "5",
      config: readJson("won-discounts-config"),
      cart: readJson("won-discounts-cart-data"),
      giftOf,
      base,
      afterBase,
      plan,
      ladder,
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
