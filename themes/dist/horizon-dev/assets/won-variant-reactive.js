/* won-variant-reactive — keeps a variant-dependent won block in sync with the
   selected variant.

   WHY THIS EXISTS
   Horizon does NOT re-render the product section on a variant change. It fetches
   the section HTML for the new variant into `event.detail.data.html` and lets each
   custom element pull its own updated markup out of that document (see Horizon's
   product-price.js / product-inventory.js). A plain Liquid block therefore keeps
   whatever the FIRST variant rendered — silently. That shipped a real price bug:
   won-price-per-unit stayed at "$54.99 / 100 g" while the price moved
   $549.95 → $1,899.95, i.e. a unit price wrong by 3.5x.

   USAGE — wrap the block root and give it a stable key:
     <won-variant-reactive data-won-vr="{{ block.id }}"> … </won-variant-reactive>
   Anything inside is replaced wholesale from the incoming HTML. If the block
   renders nothing for the new variant, the element empties itself, which is the
   correct outcome for a blank-safe block.

   Base-agnostic on purpose: it listens for the documented `variant:update` event
   by name and reads `detail.data.html`. No import from the vendor theme, so the
   same file works on Horizon and Skeleton. */
/* Two blocks on one page (price-per-unit + stock signal) each emit this script tag,
   and a classic script executes once per tag — a bare top-level `class` declaration
   therefore throws "Identifier has already been declared" and kills the module. The
   IIFE + early return makes a second execution a no-op. */
(() => {
  if (customElements.get('won-variant-reactive')) return;

  class WonVariantReactive extends HTMLElement {
    connectedCallback() {
      this.section = this.closest('.shopify-section, dialog');
      if (!this.section) return;
      this.section.addEventListener('variant:update', this.update);
    }
  
    disconnectedCallback() {
      this.section?.removeEventListener('variant:update', this.update);
    }
  
    update = (event) => {
      const html = event?.detail?.data?.html;
      const key = this.dataset.wonVr;
      if (!html || !key) return;
      const next = html.querySelector(`won-variant-reactive[data-won-vr="${CSS.escape(key)}"]`);
      // No counterpart in the new markup = the block renders nothing for this
      // variant. Emptying is right; leaving stale content would be a wrong number.
      this.replaceChildren(...(next ? Array.from(next.cloneNode(true).childNodes) : []));
    };
  }
  
  customElements.define('won-variant-reactive', WonVariantReactive);
})();
