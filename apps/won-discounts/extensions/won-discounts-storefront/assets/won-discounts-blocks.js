/* Won Discounts — won-discounts-blocks.js: the "Rewards progress" and "Campaign banner" blocks and the embed's top bar. Notes: extensions/won-discounts-storefront/README.md */
((w, d) => {
  "use strict";
  if (w.__wonBlocks) return;
  w.__wonBlocks = true;
  const all = (sel) => [...d.querySelectorAll(sel)];

  /* Rewards progress: the cart script's numbers (won-discounts:cart:update) replace what Liquid rendered. */
  const row = (kind, text, pct, bar) =>
    `<div class="won-progress__row" data-won-progress-row="${kind}"><p class="won-progress__text">${text}</p>${
      bar ? `<div class="won-progress__track" aria-hidden="true"><span style="width: ${pct}%"></span></div>` : ""
    }</div>`;
  const pctOf = (left, threshold) => (threshold > 0 ? Math.max(0, Math.min(100, Math.round(((threshold - left) * 100) / threshold))) : 100);
  const progress = (e) => {
    const wd = w.WonDiscounts;
    const tx = wd?.cart?.tx;
    const v = e.detail;
    if (!tx || !v) return;
    const cur = d.querySelector("[data-won-discounts-embed]")?.getAttribute("data-won-discounts-currency") || "";
    const say = (key, cents) => wd.esc(wd.fill(tx[key] || "", { amount: wd.money(cents, cur) }));
    for (const el of all("[data-won-discounts-progress]")) {
      const bar = el.getAttribute("data-bar") !== "false";
      let out = "";
      const s = v.shipping;
      if (s && el.getAttribute("data-ship") !== "false") out += row("ship", s.reached ? wd.esc(tx.ship_done) : say("ship_left", s.remaining), pctOf(s.remaining, s.threshold), bar);
      const gifts = v.gifts || [];
      if (gifts.length && el.getAttribute("data-gift") !== "false") {
        const next = gifts.find((g) => !g.due);
        out += next ? row("gift", say("gift_left", next.left), pctOf(next.left, next.threshold), bar) : row("gift", wd.esc(tx.gift_done), 100, bar);
      }
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
      const show = el.getAttribute("data-countdown") !== "false";
      time.hidden = !show;
      if (show) time.textContent = (el.getAttribute("data-ends") || "{time}").replace("{time}", left(run.e - now, units));
      if (!soonest || run.e < soonest) soonest = run.e;
    }
    /* Seconds only in the last hour; otherwise once a minute is enough. */
    const wait = soonest && soonest - now <= 3600 ? 1000 : 30000;
    clearTimeout(timer);
    if (all("[data-won-discounts-campaign]").length) timer = setTimeout(start, wait);
  };

  /* The embed's top bar is printed at the end of <body>: it belongs at the top of the page, and only with something to say. */
  const topbar = () => {
    const bar = d.querySelector("[data-won-discounts-topbar]");
    if (!bar) return;
    if (d.body.firstElementChild !== bar) d.body.prepend(bar);
    bar.hidden = !bar.querySelector(".won-progress__row, [data-won-discounts-campaign]:not([hidden])");
  };
  const start = () => {
    campaigns();
    topbar();
  };
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", start);
  else start();
  d.addEventListener("shopify:section:load", start);
})(window, document);
