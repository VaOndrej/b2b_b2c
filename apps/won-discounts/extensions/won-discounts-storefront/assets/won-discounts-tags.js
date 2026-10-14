/* Won Discounts — won-discounts-tags.js: the theme's <won-discounts show="…"> tags. Notes: extensions/won-discounts-storefront/README.md */
((w, d) => {
  "use strict";
  if (!w.customElements || w.customElements.get("won-discounts")) return;
  const tpl = (name) => d.querySelector(`template[data-won-tag="${name}"]`);
  const att = (el, name) => (el.getAttribute(name) || "").replace(/[^\w{} -]/g, "");
  const SIZES = ["bar", "compact", "full"];
  const json = (id) => {
    try {
      return JSON.parse(d.getElementById(id)?.textContent || "{}");
    } catch (err) {
      return {};
    }
  };

  const campaign = (el, t) => {
    const box = d.createElement("div");
    box.className = `won-campaign won-campaign--${att(el, "align") || "start"}`;
    box.setAttribute("data-won-discounts-campaign", "");
    box.setAttribute("data-text", el.getAttribute("text") || "{name}");
    for (const name of ["data-ends", "data-units", "data-sample"]) if (t.hasAttribute(name)) box.setAttribute(name, t.getAttribute(name));
    box.hidden = true;
    box.append(t.content.cloneNode(true));
    box.insertAdjacentHTML("beforeend", '<p class="won-campaign__title"></p><p class="won-campaign__time" aria-live="off"></p>');
    return box;
  };

  const fill = (el) => {
    if (el.childElementCount) return;
    const show = att(el, "show");
    let t = null;
    let out = null;
    if (show === "milestones") {
      const size = SIZES.includes(att(el, "size")) ? att(el, "size") : "compact";
      const real = tpl(`milestones-${size}`);
      t = real || tpl(`milestones-${size}-sample`);
      if (!t) return;
      out = d.createElement("div");
      out.className = `won-progress won-progress--${att(el, "align") || "start"}`;
      out.setAttribute("data-size", size);
      if (real) out.setAttribute("data-won-discounts-progress", "");
      out.append(t.content.cloneNode(true));
    } else if (show === "campaign") {
      t = tpl("campaign") || tpl("campaign-sample");
      if (t) out = campaign(el, t);
    } else if (show === "card-tier") {
      const handle = el.getAttribute("product") || "";
      const text = json("won-discounts-cards")[handle];
      if (typeof text === "string" && text) {
        out = d.createElement("p");
        out.className = "won-card-tier";
        out.setAttribute("data-won-discounts-card", handle);
        out.textContent = text;
      } else if ((t = tpl("card-tier-sample"))) out = t.content.cloneNode(true);
    } else if (show === "cart" && (t = tpl("cart-sample"))) out = t.content.cloneNode(true);
    if (out) el.append(out);
  };

  w.customElements.define(
    "won-discounts",
    class extends HTMLElement {
      connectedCallback() {
        fill(this);
      }
    },
  );
})(window, document);
