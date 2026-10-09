/* Won Discounts — won-discounts-blocks.js: the "Milestones", "Campaign banner" and "Top bar" blocks and the embed's fallback top bar. Notes: extensions/won-discounts-storefront/README.md */
((w, d) => {
  "use strict";
  if (w.__wonBlocks) return;
  w.__wonBlocks = true;
  const all = (sel) => [...d.querySelectorAll(sel)];

  /* Milestones: the cart script's ladder (won-discounts:cart:update) replaces what Liquid rendered, in the element's size. */
  const progress = (e) => {
    const wd = w.WonDiscounts;
    const v = e.detail;
    if (!wd?.cart?.tx || !v?.steps) return;
    const cur = d.querySelector("[data-won-discounts-embed]")?.getAttribute("data-won-discounts-currency") || "";
    for (const el of all("[data-won-discounts-progress]")) {
      const out = wd.ladder(v, el.getAttribute("data-size") || "compact", wd.cart, cur);
      if (el.__won !== out) {
        el.__won = out;
        el.innerHTML = out;
      }
    }
    topbar();
  };
  d.addEventListener("won-discounts:cart:update", progress);

  /* Campaign banner: which campaign runs is decided here (pages are cached), with a countdown to its end. */
  let timer = 0;
  const two = (n) => String(n).padStart(2, "0");
  const left = (sec, units) => {
    const [ud, uh, um, us] = units;
    const days = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (days > 0) return `${days} ${ud} ${h} ${uh}`;
    if (h > 0) return `${h} ${uh} ${two(m)} ${um}`;
    return `${m} ${um} ${two(sec % 60)} ${us}`;
  };
  const campaigns = () => {
    const now = Math.floor(Date.now() / 1000);
    let soonest = 0;
    for (const el of all("[data-won-discounts-campaign]")) {
      let list = [];
      try {
        list = JSON.parse(el.querySelector("script")?.textContent || "[]");
      } catch (err) {
        list = [];
      }
      let run = (Array.isArray(list) ? list : []).filter((c) => c && c.s <= now && now < c.e).sort((a, b) => a.e - b.e)[0];
      const sample = el.getAttribute("data-sample");
      if (!run && sample) run = { n: sample, e: now + 187200 };
      el.hidden = !run;
      if (!run) continue;
      const units = (el.getAttribute("data-units") || "d,h,min,s").split(",");
      el.querySelector(".won-campaign__title").textContent = (el.getAttribute("data-text") || "{name}").replace("{name}", run.n);
      const time = el.querySelector(".won-campaign__time");
      time.textContent = (el.getAttribute("data-ends") || "{time}").replace("{time}", left(run.e - now, units));
      if (!soonest || run.e < soonest) soonest = run.e;
    }
    /* Seconds only in the last hour; otherwise once a minute is enough. */
    const wait = soonest && soonest - now <= 3600 ? 1000 : 30000;
    clearTimeout(timer);
    if (all("[data-won-discounts-campaign]").length) timer = setTimeout(start, wait);
  };

  /* The embed's top bar is printed at the end of <body>: it belongs at the top of the page, and only with something to say. */
  const says = (bar) => !!bar.querySelector(".won-ms, [data-won-discounts-campaign]:not([hidden]), .won-topbar__empty");
  const topbar = () => {
    /* The "Top bar" block stays where the merchant put it; it only hides while it has nothing to say. */
    const blocks = all("[data-won-discounts-topbar-block]");
    for (const el of blocks) el.hidden = !says(el);
    const bar = d.querySelector("[data-won-discounts-topbar]");
    if (!bar) return;
    /* With a block on the page the embed's strip is not shown a second time. */
    if (blocks.length) {
      bar.hidden = true;
      return;
    }
    if (d.body.firstElementChild !== bar) d.body.prepend(bar);
    bar.hidden = !says(bar);
  };
  /* Sale badge: only the row of the variant the shopper has picked (the product form's `id`, else the address). */
  const outlet = () => {
    for (const box of all("[data-won-discounts-outlet]")) {
      const rows = [...box.querySelectorAll("[data-won-discounts-outlet-variant]")];
      const scope = box.closest(".shopify-section") || d;
      const id = scope.querySelector('form[action*="/cart/add"] [name="id"]')?.value || new URLSearchParams(w.location.search).get("variant");
      if (!id) continue;
      for (const row of rows) row.hidden = row.getAttribute("data-won-discounts-outlet-variant") !== String(id);
    }
  };
  /* Themes set the form's `id` after their own work (some after a fetch): look again shortly after a change. */
  d.addEventListener("change", () => [0, 200, 800, 1600].forEach((ms) => setTimeout(outlet, ms)));
  const start = () => {
    campaigns();
    topbar();
    outlet();
  };
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", start);
  else start();
  d.addEventListener("shopify:section:load", start);
})(window, document);
