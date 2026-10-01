/* Won Discounts — won-discounts-cart.js (cart panel, MVP 4). Notes: extensions/won-discounts-storefront/README.md */
((w, d) => {
  "use strict";
  const SLOT = "[data-won-discounts-cart-slot]";
  const DRAWERS = ["cart-drawer-component .cart-drawer__summary", "#CartDrawer .drawer__footer"];
  const PAGES = [".cart-page__summary", "#main-cart-footer .cart__footer"];
  const GAP_MS = 1500;
  let wd, data, tx, cart, view, hint, warn;
  let shown = "";
  let lastWrite = 0;
  let selfUntil = 0;
  let queue = Promise.resolve();

  const t = (key, values = {}) => wd.esc(wd.fill(tx[key] || key, values));
  const m = (cents) => wd.money(cents, cart.currency);
  const scale = () => 10 ** (data.exp ?? 2);
  const tierOf = (id) => view.tiers.find((x) => x.id === id);
  const codes = () => (cart.discount_codes || []).map((c) => c.code);

  const refresh = () =>
    fetch("/cart.js", { cache: "no-store", headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((c) => {
        cart = c;
        view = wd.plan(c, data.rw || {}, data.g || {});
        render();
      })
      .catch(() => {});

  const write = (payload) => {
    const actions = w.Shopify?.actions;
    if (typeof actions?.updateCart !== "function") return Promise.resolve();
    queue = queue
      .then(() => new Promise((ok) => setTimeout(ok, Math.max(0, lastWrite + GAP_MS - Date.now()))))
      .then(() => {
        selfUntil = Date.now() + 4000;
        lastWrite = Date.now();
        return actions.updateCart(payload, { event: { detail: { won: true } } }).catch(() => null);
      })
      .then(refresh);
    return queue;
  };

  const addGift = (tier, variant) =>
    write({
      lines: [
        {
          merchandiseId: `gid://shopify/ProductVariant/${variant}`,
          quantity: 1,
          attributes: [
            { key: wd.GIFT, value: tier },
            { key: "_gift_progress", value: "1" },
          ],
        },
      ],
    });

  const withDeclined = (list) => {
    const out = Object.entries(cart.attributes || {})
      .filter(([k, v]) => k !== wd.DECLINED && v != null)
      .map(([key, value]) => ({ key, value: String(value) }));
    if (list.length) out.push({ key: wd.DECLINED, value: list.join(",") });
    return out;
  };
  const declined = () => String(cart.attributes?.[wd.DECLINED] || "").split(",").filter(Boolean);

  const decline = (tier) => {
    const payload = { attributes: withDeclined([...new Set([...declined(), tier.id])]) };
    if (tier.line) payload.lines = [{ id: tier.line.key, quantity: 0 }];
    return write(payload);
  };
  const applyCode = (code) => {
    const kept = view.tiers.filter((x) => x.reached && !x.lost).map((x) => x.id);
    const valid = (cart.discount_codes || []).filter((c) => c.applicable).map((c) => c.code);
    return write({ discountCodes: [...valid, code] }).then(() => {
      const entry = (cart.discount_codes || []).find((c) => c.code.toUpperCase() === code.toUpperCase());
      warn = !entry?.applicable ? { invalid: code } : kept.some((id) => tierOf(id)?.lost) ? { loses: code } : null;
      render();
    });
  };
  const dropCode = (code) => {
    warn = null;
    return write({ discountCodes: codes().filter((c) => c !== code) });
  };

  const react = (before) => {
    const removed = (before?.tiers || []).find((x) => x.line && view.tiers.some((y) => y.id === x.id && y.due && !y.line && !y.declined));
    if (removed) return decline({ id: removed.id, line: null });
    if (view.remove.length) return write({ lines: view.remove.map((id) => ({ id, quantity: 0 })) }).then(() => view.add && addGift(view.add.tier, view.add.variant));
    if (view.add) return addGift(view.add.tier, view.add.variant);
  };

  const askHint = () => {
    hint = null;
    const lines = (cart.items || []).filter((item) => !wd.giftOf(item));
    if (!data.proxy || !lines.length || lines.length > 100) return;
    const rate = Number(w.Shopify?.currency?.rate);
    fetch(data.proxy, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        currency: cart.currency,
        country: w.Shopify?.country,
        rate: rate > 0 ? rate : undefined,
        locale: data.lang === "en" ? "en" : "cs",
        codes: codes(),
        lines: lines.map((item) => ({
          key: item.key,
          variantId: item.variant_id,
          productId: item.product_id,
          quantity: item.quantity,
          unitPrice: Math.round((item.original_price * scale()) / 100),
        })),
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => {
        const h = a?.ok && a.hint;
        const item = h && lines.find((x) => x.key === h.key);
        if (!item) return;
        const value = h.percent != null ? `−${h.percent} %` : h.amount != null ? `−${m((h.amount * 100) / scale())}` : "";
        hint = t(h.capped || !value ? "hint_capped" : "hint", { n: h.missing, product: item.product_title, value });
        render();
      })
      .catch(() => {});
  };

  const panels = () => {
    const slots = [...d.querySelectorAll([SLOT, ...DRAWERS].join(","))];
    if (!d.querySelector(SLOT)) slots.push(...d.querySelectorAll(PAGES.join(",")));
    return slots.map((slot) => {
      let p = slot.querySelector(":scope > [data-won-discounts-cart]");
      if (!p) {
        p = d.createElement("div");
        p.className = "won-cart";
        p.setAttribute("data-won-discounts-cart", "");
        slot.prepend(p);
      }
      return p;
    });
  };

  const render = () => {
    if (!view) return;
    const markup = wd.html({ view, cart, data, hint, warn });
    for (const p of panels()) {
      if (p.__won !== markup) {
        p.__won = markup;
        p.innerHTML = markup;
      }
    }
    if (shown !== markup) {
      shown = markup;
      d.dispatchEvent(new CustomEvent("won-discounts:cart:update", { detail: { base: view.base, shipping: view.ship, gifts: view.tiers } }));
    }
  };

  const onChange = (e) => {
    if (e?.detail?.won || Date.now() < selfUntil) return;
    const before = view;
    setTimeout(() => refresh().then(() => (askHint(), react(before))), 300);
  };

  const onClick = (e) => {
    const el = e.target.closest?.("[data-won-decline],[data-won-add],[data-won-drop],[data-won-keep]");
    if (!el || !view) return;
    const a = (name) => el.getAttribute(name);
    if (a("data-won-decline") !== null) decline(tierOf(a("data-won-decline")));
    else if (a("data-won-add") !== null) addGift(a("data-won-add"), Number(a("data-variant")));
    else if (a("data-won-drop") !== null) dropCode(a("data-won-drop"));
    else {
      warn = null;
      react(null);
    }
  };

  const onSubmit = (e) => {
    const form = e.target.closest?.("[data-won-discounts-code]");
    if (!form) return;
    e.preventDefault();
    const code = String(form.elements["won-code"].value || "").trim();
    if (code) applyCode(code);
  };

  const start = () => {
    wd = w.WonDiscounts;
    if (!wd?.ready || w.__wonCartStarted) return;
    w.__wonCartStarted = true;
    data = wd.cart || {};
    tx = data.tx || {};
    if (!data.on) return;
    for (const name of ["shopify:cart:lines-update", "shopify:cart:discount-update", "cart:update"]) d.addEventListener(name, onChange);
    if (typeof w.subscribe === "function") w.subscribe("cart-update", onChange);
    d.addEventListener("click", onClick);
    d.addEventListener("submit", onSubmit);
    let frame = 0;
    new MutationObserver(() => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        render();
      });
    }).observe(d.body, { childList: true, subtree: true });
    refresh().then(askHint);
  };

  w.__wonCartBoot = start;
  start();
})(window, document);
