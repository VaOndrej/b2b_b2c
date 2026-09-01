/* won-quick-view — "Choose" on a product card opens a quick view instead of
   navigating to the product page.

   WHY IT IS THIS SMALL
   The dialog, its focus handling and its close button are Horizon's
   (`#quick-add-dialog`, already in layout/theme.liquid), and the fragment it shows
   is the same `[data-product-grid-content]` Horizon's own quick add uses — so the
   variant picker and buy buttons inside are real theme components that upgrade
   themselves the moment they are inserted. Horizon's `QuickAddComponent` could not
   be reused directly: it reads the product URL from `closest('product-card')`, and
   a won card is not that element. Rather than dress a won card up as one, only the
   TRIGGER is ours.

   The trigger stays a real <a href>: with no JS, a crawler, or a middle click it is
   still a link to the product page. Quick view is layered on top, never instead. */
(() => {
  if (window.__wonQuickView) return;
  window.__wonQuickView = true;

  const CONTENT_ID = 'quick-add-modal-content';
  const DIALOG_ID = 'quick-add-dialog';
  const cache = new Map();

  const dialogEl = () => document.getElementById(DIALOG_ID);

  async function fetchFragment(url) {
    if (cache.has(url)) return cache.get(url).cloneNode(true);
    const res = await fetch(url, { headers: { Accept: 'text/html' } });
    if (!res.ok) return null;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const grid = doc.querySelector('[data-product-grid-content]');
    if (!grid) return null;
    cache.set(url, grid.cloneNode(true));
    return grid.cloneNode(true);
  }

  async function open(url) {
    const host = dialogEl();
    const content = document.getElementById(CONTENT_ID);
    if (!host || !content) return false;
    const fragment = await fetchFragment(url);
    if (!fragment) return false;
    // Replace, don't append: reopening on another product must not stack two products.
    content.replaceChildren(fragment);
    if (typeof host.showDialog === 'function') host.showDialog();
    else host.querySelector('dialog')?.showModal();
    return true;
  }

  document.addEventListener(
    'click',
    async (event) => {
      const trigger = event.target instanceof Element ? event.target.closest('[data-won-quickview]') : null;
      if (!trigger) return;
      // Leave the browser's own gestures alone — a middle click or ⌘-click means
      // "open the product page", and that is exactly what the href already does.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = trigger.getAttribute('href');
      if (!url || !dialogEl()) return; // no dialog on this page: let the link navigate

      event.preventDefault();
      trigger.setAttribute('aria-busy', 'true');
      try {
        const opened = await open(url);
        // A failed fetch must not strand the shopper on a dead button.
        if (!opened) window.location.href = url;
      } catch {
        window.location.href = url;
      } finally {
        trigger.removeAttribute('aria-busy');
      }
    },
    { capture: false }
  );
})();
