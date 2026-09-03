/* won-toast — a cart message, and nothing else.
 *
 * Three rules hold this file together:
 *
 * 1. THE CART IS THE TRUTH. The type of a message is never inferred from which
 *    button someone pressed; it is derived from the difference between the cart
 *    we last saw and the cart that just arrived. A tap that failed produces no
 *    message, a change made in another tab produces the right one, and the
 *    toast can never disagree with the cart badge next to it.
 *
 * 2. ONE MESSAGE PER VARIANT. Five taps on one card are one fact — "there are
 *    now five of these" — so they are one card whose text is rewritten and
 *    whose timer restarts. Toasts count changes only across *different*
 *    variants.
 *
 * 3. IT LISTENS, IT IS NOT CALLED. Nothing imports this file and nothing calls
 *    into it. A variant picker, a sticky add-to-cart or a future PDP widget
 *    gets toasts by dispatching the same `cart:refresh` the cart already
 *    dispatches — with no knowledge that toasts exist.
 */
(function () {
  'use strict';

  var region = document.querySelector('[data-won-toast]');
  /* No region means the merchant turned toasts off. Not hidden — absent. So we
     never attach a listener, never keep a cart snapshot, and cost nothing. */
  if (!region) return;

  var DURATION = (parseInt(region.dataset.duration, 10) || 4) * 1000;
  var MAX = parseInt(region.dataset.max, 10) || 3;
  var WANT_MEDIA = region.dataset.media === '1';
  var EXIT_MS = 220;

  /* A key a merchant never filled in, or a language file that hasn't caught up,
     must not put "translation missing: cs.won.toast.added" in front of a
     shopper. No text, no toast. */
  function template(type) {
    var raw = region.dataset['text' + type.charAt(0).toUpperCase() + type.slice(1)];
    if (!raw || raw.indexOf('translation missing') !== -1) return null;
    return raw;
  }

  function fill(tpl, product, quantity) {
    return tpl.replace(/\{\{\s*product\s*\}\}/g, product).replace(/\{\{\s*quantity\s*\}\}/g, quantity);
  }

  /* ---------------------------------------------------------------- state -- */

  /* variant id -> { qty, title, image }. Seeded from the page's own render so
     the first change of the visit is already a diff and not a guess. */
  var seen = Object.create(null);

  (region.dataset.initial || '')
    .split(',')
    .filter(Boolean)
    .forEach(function (pair) {
      var parts = pair.split(':');
      seen[parts[0]] = { qty: parseInt(parts[1], 10) || 0, title: '', image: '' };
    });

  /* variant id -> live toast element, so a repeat tap finds its own card. */
  var open = Object.create(null);

  /* ----------------------------------------------------------- rendering -- */

  function thumb(url) {
    if (!WANT_MEDIA || !url) return '';
    var sized = url.indexOf('?') === -1 ? url + '?width=96' : url + '&width=96';
    return '<img class="won-toast__media" src="' + sized + '" alt="" width="48" height="48" loading="lazy">';
  }

  function dismiss(id) {
    var el = open[id];
    if (!el) return;
    delete open[id];
    clearTimeout(el._wonTimer);
    el.classList.add('is-leaving');
    /* Let the exit animation run, but never let a stuck transition leak an
       element: the timeout removes it either way. */
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, EXIT_MS);
  }

  function trim() {
    var ids = Object.keys(open);
    /* Object key order is insertion order for string keys that aren't array
       indices — variant ids are numeric strings, so they ARE array indices and
       would sort numerically. Hence the explicit stamp below. */
    ids.sort(function (a, b) {
      return open[a]._wonStamp - open[b]._wonStamp;
    });
    while (ids.length > MAX) dismiss(ids.shift());
  }

  function show(id, type, text, image) {
    var el = open[id];

    /* A toast can be torn out from under us — a section morph replaces the
       region, or something else clears the DOM. A stale reference would then
       silently swallow every later message for that variant, so an element that
       is no longer in the document is treated as gone. */
    if (el && !region.contains(el)) {
      clearTimeout(el._wonTimer);
      delete open[id];
      el = null;
    }

    if (!el) {
      el = document.createElement('div');
      el.className = 'won-toast';
      el.setAttribute('data-won-toast-item', '');
      region.appendChild(el);
      open[id] = el;
      /* Force a frame so the entry transition has a "from" state to leave. */
      requestAnimationFrame(function () {
        el.classList.add('is-in');
      });
    }

    el._wonStamp = Date.now();
    el.dataset.type = type;
    el.innerHTML =
      thumb(image) +
      '<span class="won-toast__text"></span>' +
      '<button class="won-toast__close" type="button" aria-label="' +
      (region.dataset.dismiss || '') +
      '">&times;</button>';
    el.querySelector('.won-toast__text').textContent = text;
    el.querySelector('.won-toast__close').addEventListener('click', function () {
      dismiss(id);
    });

    clearTimeout(el._wonTimer);
    el._wonTimer = setTimeout(function () {
      dismiss(id);
    }, DURATION);

    trim();
  }

  /* ---------------------------------------------------------------- diff -- */

  function classify(before, after) {
    if (after > 0 && before === 0) return 'added';
    if (after > before) return 'increased';
    if (after === 0 && before > 0) return 'removed';
    if (after < before) return 'decreased';
    return null;
  }

  function apply(cart) {
    if (!cart || !Array.isArray(cart.items)) return;

    var next = Object.create(null);
    var changes = [];

    cart.items.forEach(function (line) {
      var id = String(line.variant_id);
      var title = line.product_title || line.title || '';
      var image = line.featured_image ? line.featured_image.url : line.image || '';
      next[id] = { qty: line.quantity, title: title, image: image };

      var before = seen[id] ? seen[id].qty : 0;
      var type = classify(before, line.quantity);
      if (type) changes.push({ id: id, type: type, title: title, image: image, qty: line.quantity });
    });

    /* Lines that vanished from the payload are removals — the only place where
       the old snapshot, not the new cart, is the source of the product name. */
    Object.keys(seen).forEach(function (id) {
      if (next[id]) return;
      if (!seen[id].qty) return;
      changes.push({ id: id, type: 'removed', title: seen[id].title, image: seen[id].image, qty: 0 });
    });

    seen = next;

    changes.forEach(function (c) {
      /* Taps are batched, so a first appearance can land as five at once. Saying
         only "added to cart" would then under-report what just happened — the
         quantity wording is the honest one whenever more than one arrived. */
      var type = c.type === 'added' && c.qty > 1 ? 'increased' : c.type;
      var tpl = template(type);
      /* A change whose text the merchant removed is silently skipped; the rest
         of the batch still speaks. */
      if (!tpl) return;
      if (!c.title) return;
      show(c.id, type, fill(tpl, c.title, c.qty), c.image);
    });
  }

  /* ------------------------------------------------------------ anchoring -- */

  /* A top-anchored toast must sit under the header, not over it: the cart badge
     is the first thing a shopper looks at after adding something. The header's
     height cannot be hardcoded — an announcement bar, a sticky header or a
     scrolled page all move it — so it is measured from the live layout, and
     re-measured while any toast is on screen. */
  var TOP = region.className.indexOf('--top') !== -1;

  function anchor() {
    if (!TOP) return;
    /* The header group is several sections — announcement bar, header, whatever a
       merchant added — so the lowest edge of the group is the header's bottom,
       not the first section's. */
    var parts = document.querySelectorAll('.shopify-section-group-header-group, header.header-section, .header');
    var bottom = 0;
    for (var i = 0; i < parts.length; i++) {
      var edge = parts[i].getBoundingClientRect().bottom;
      if (edge > bottom) bottom = edge;
    }
    region.style.setProperty('--won-toast-top', Math.round(Math.max(bottom, 0)) + 'px');
  }

  anchor();
  addEventListener('resize', anchor, { passive: true });
  addEventListener('scroll', anchor, { passive: true });

  document.addEventListener('cart:refresh', function (e) {
    anchor();
    apply(e && e.detail && e.detail.cart);
  });

  /* ------------------------------------------------------------- drawer -- */

  /* Two things claiming the screen after one tap is one too many. When toasts
     are on, the drawer stops opening by itself — the shopper keeps browsing and
     opens the cart when they mean to. Done by dropping the attribute rather
     than by editing the vendor snippet that writes it: the merchant's own
     "open drawer automatically" setting stays untouched and comes back the
     moment toasts are switched off. */
  function releaseDrawer() {
    var drawers = document.querySelectorAll('cart-drawer-component[auto-open]');
    for (var i = 0; i < drawers.length; i++) drawers[i].removeAttribute('auto-open');
  }

  releaseDrawer();
  /* The drawer can be re-rendered by a section morph long after load, so watch
     for it coming back rather than assuming one pass is enough. */
  new MutationObserver(releaseDrawer).observe(document.documentElement, { childList: true, subtree: true });
})();
