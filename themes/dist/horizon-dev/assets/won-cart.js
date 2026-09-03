/* won-cart.js — global quick-add for won product cards. Delegates clicks on any
   [data-won-add] button (card quick-add, sticky ATC) and on a stepper's "−",
   loaded once in <head> (wired by compose).

   Rewritten on the Therabeast model (assets/tb-cart-qty.js), because the old
   "await add, await cart, then repaint" flow felt stuck: every tap cost two
   SERIAL round trips before the number moved, and the button was disabled for
   the whole of it, so a shopper tapping "+" three times fast got one item and
   two swallowed taps.

   The three rules that make it feel instant:

     1. OPTIMISTIC. A tap writes the target into desiredQty and repaints at once;
        the network catches up afterwards. What is on screen is
        desiredQty ?? committedQty, never a value we guessed from the DOM.
     2. BATCHED ACROSS THE WHOLE CART, NEVER LOCKED. No tap is ever refused. Taps
        land in desiredQty and a short window collects them into ONE request —
        across products, not just across taps on one card. This is the part
        Therabeast does not do: its loop is per variant, and because Shopify
        serialises cart writes per session, six products tapped down a collection
        grid queued six round trips (measured: the last landed 2.4s after the
        tap). Batched, that burst is a single request.
     3. ONE IDEMPOTENT ENDPOINT, WITH ITS SECTIONS. /cart/update.js with ABSOLUTE
        quantities keyed by variant id. The old code needed /cart/add.js for "+"
        and /cart/change.js by line key for "−" — and the line key only existed
        after a full cart sync, so a "−" tapped too early silently did nothing.
        The request also asks for the cart sections, so Horizon's drawer morphs
        from our response instead of fetching a render of its own per tap.

   Plain (non-stepper) add buttons keep their one-shot "Added" confirmation:
   there is no quantity on screen to keep live, so there is nothing to be
   optimistic about. */
(function () {
  if (window.__wonCartBound) return;
  window.__wonCartBound = true;

  var SOURCE = 'won-card-quick-add';

  var qtyMap = new Map(); // variantId -> quantity the CART has confirmed
  var desiredQtyMap = new Map(); // variantId -> quantity the shopper has asked for
  var inFlight = new Set(); // variantIds inside the batch currently on the wire
  var flushing = false; // a batch loop is running
  var flushTimer = null;

  /* Cart writes are serialised per session by Shopify, so N products tapped in a
     row cost N round trips ONE AFTER ANOTHER, not N in parallel: measured at
     400ms latency, six cards took 2.4s for the last one to land. The window
     collects every tap that arrives while we are waiting and sends them as a
     single `updates` object — six taps become one request. It is short enough to
     stay under the ~100ms that reads as instant, and it delays nothing on
     screen: the count has already moved. */
  var BATCH_WINDOW_MS = 90;

  function stepperOf(el) { return el && el.closest('[data-won-stepper]'); }

  function variantIdOf(box) {
    var btn = box && box.querySelector('[data-won-add][data-variant-id]');
    var id = btn && Number(btn.getAttribute('data-variant-id'));
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  function displayedQty(variantId) {
    var desired = desiredQtyMap.get(variantId);
    if (Number.isFinite(desired) && desired >= 0) return desired;
    return qtyMap.get(variantId) || 0;
  }

  /* Replay the CTA sheen once the cart has answered. The plain "Add to cart"
     button gets its sweep from :hover, but a stepper's +/− are tapped while the
     pointer already sits on the pill — hover never re-enters, so without this the
     only mode that changes anything is the number. Restarting a CSS animation
     needs the class off, a forced reflow, then on; without the reflow the browser
     coalesces both writes and nothing replays. The class is removed on
     animationend (`won-sheen-replay`) so the next tap can fire it again. */
  function pulseSheen(el) {
    var box = el && el.closest('.won-fx');
    if (!box) return;
    box.classList.remove('is-sheening');
    void box.offsetWidth;
    box.classList.add('is-sheening');
  }
  document.addEventListener(
    'animationend',
    function (e) {
      if (e.animationName === 'won-sheen-replay' && e.target.classList) e.target.classList.remove('is-sheening');
    },
    true
  );

  /* The number moves before the cart has confirmed anything, so the tap needs an
     acknowledgement of its own: up and down read differently, which is the whole
     point on a control where both buttons sit a few pixels apart. */
  function bumpQty(out, previousQty, nextQty) {
    if (!out || previousQty === nextQty) return;
    var cls = nextQty > previousQty ? 'is-bump-up' : 'is-bump-down';
    out.classList.remove('is-bump-up', 'is-bump-down');
    void out.offsetWidth;
    out.classList.add(cls);
    setTimeout(function () {
      if (out.isConnected) out.classList.remove('is-bump-up', 'is-bump-down');
    }, 360);
  }

  /* Pin where the pill's trailing edge sits while it is still a plain
     "Add to cart" label, BEFORE it ever grows a − and a count.

     Without this the pill re-lays out around its own centre every time the count
     changes — worst with the `--add-center` alignment, where adding a − and a
     number shoves the whole control sideways under a pointer that has not moved.
     Pinned, the new parts grow to the leading side and the control stays put.

     (This once also froze the add button's WIDTH, so the "+" landed exactly where
     the label's centre had been and five taps without moving a finger all
     counted. It worked, and it made the pill 201px wide next to an 83px
     "Choose" — the wrong trade for a hand that can move a centimetre.) */
  function freezeGeometry(box) {
    if (box.dataset.wonFrozen === '1') return;
    var parent = box.offsetParent;
    if (!parent) return;
    var boxRect = box.getBoundingClientRect();
    if (boxRect.width <= 0) return; // not laid out yet (hidden card, display:none rail)

    var parentRect = parent.getBoundingClientRect();
    /* Logical, not left/right: on an RTL storefront the trailing edge is the one
       on the other side, and pinning a physical edge would mirror the problem. */
    var rtl = getComputedStyle(box).direction === 'rtl';
    var endGap = rtl ? boxRect.left - parentRect.left : parentRect.right - boxRect.right;

    box.style.setProperty('--won-pill-end', endGap + 'px');
    box.dataset.wonFrozen = '1';
  }

  function renderBox(box) {
    var out = box.querySelector('[data-won-qty]');
    var minus = box.querySelector('[data-won-step="-1"]');
    var variantId = variantIdOf(box);
    if (!out || !minus || !variantId) return;

    /* Must happen while the pill is still in its empty state — once the count is
       in the DOM there is nothing left to measure. */
    freezeGeometry(box);

    var qty = displayedQty(variantId);
    var previousRaw = box.dataset.wonRenderedQty;
    var previousQty = previousRaw === undefined || previousRaw === '' ? null : Number(previousRaw) || 0;

    if (qty > 0) {
      out.textContent = String(qty);
      out.hidden = false;
      minus.hidden = false;
      /* Drives the label→"+" swap in CSS, so the glyph can never disagree with
         the quantity it sits next to. */
      box.dataset.wonQtyValue = String(qty);
    } else {
      out.hidden = true;
      minus.hidden = true;
      delete box.dataset.wonQtyValue;
    }

    box.dataset.wonRenderedQty = String(qty);
    box.classList.toggle('is-syncing', inFlight.has(variantId));
    if (previousQty !== null) bumpQty(out, previousQty, qty);
  }

  /* Reflect the cart on EVERY stepper for this variant, not just the one that was
     clicked: the same product appears in several rails on the homepage, and
     leaving the other cards on "Add to cart" for something already in the cart
     is the same lie the header count used to tell. */
  function renderVariant(variantId) {
    document.querySelectorAll('[data-won-stepper]').forEach(function (box) {
      if (variantIdOf(box) === variantId) renderBox(box);
    });
  }

  function renderAll() {
    document.querySelectorAll('[data-won-stepper]').forEach(renderBox);
  }

  async function readCart() {
    var res = await fetch('/cart.js', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) throw new Error('cart read failed: ' + res.status);
    return res.json();
  }

  /* The cart sections that have to be repainted after a change. Horizon's
     cart-items-component re-renders itself from `detail.data.sections` when the
     event carries them and falls back to a section render of its OWN
     (component-cart-items.js, `sectionRenderer.renderSection`) when it does not —
     and the drawer lives in the header on every page, so without this every tap
     cost a second server render. Every native Horizon cart request bundles them;
     ours has to as well. */
  function cartSectionIds() {
    var ids = [];
    document.querySelectorAll('cart-items-component[data-section-id]').forEach(function (el) {
      var id = el.dataset.sectionId;
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    return ids;
  }

  /* Absolute quantities keyed by variant id: idempotent, so a retry or a doubled
     tap can never overshoot, and a line can go to zero — which /cart/add.js
     cannot do at all. Many variants per call, because the endpoint takes them and
     the session lock means the alternative is a queue of round trips. */
  async function updateVariants(updates) {
    var body = { updates: updates };
    var ids = cartSectionIds();
    if (ids.length) {
      body.sections = ids.join(',');
      /* Sections render in the context of a page; without this they are rendered
         against the Referer, which drops the locale prefix on a /fr/… storefront. */
      body.sections_url = window.location.pathname;
    }
    var res = await fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('update failed: ' + res.status);
    return res.json();
  }

  /* One announcement, two audiences: our own listeners and the host theme's.
     `itemCount` is the field Horizon's cart icon reads; without it the bubble
     falls back to 0 and visibly "empties" the cart. */
  function announce(cart) {
    document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true, detail: { cart: cart } }));
    document.dispatchEvent(
      new CustomEvent('cart:update', {
        bubbles: true,
        detail: {
          resource: cart,
          sourceId: SOURCE,
          data: {
            source: SOURCE,
            itemCount: cart && cart.item_count,
            /* The whole point of asking for them: with sections present Horizon
               morphs the drawer from this payload, without them it fetches. */
            sections: cart && cart.sections,
          },
        },
      })
    );
  }

  /* Adopt a cart payload as the committed truth. A desired quantity the cart has
     caught up with is dropped, so the next render falls back to the cart itself;
     one still in flight is kept, or an in-progress tap would visibly snap back. */
  function syncFromCart(cart) {
    qtyMap.clear();
    (cart && cart.items ? cart.items : []).forEach(function (item) {
      var id = Number(item.variant_id);
      if (!Number.isFinite(id) || id <= 0) return;
      qtyMap.set(id, (qtyMap.get(id) || 0) + (Number(item.quantity) || 0));
    });

    desiredQtyMap.forEach(function (desired, variantId) {
      if (!inFlight.has(variantId) && (qtyMap.get(variantId) || 0) === desired) {
        desiredQtyMap.delete(variantId);
      }
    });

    renderAll();
  }

  function queueQuantityChange(variantId, nextQty, box) {
    var target = Math.max(0, Number(nextQty) || 0);
    if (target === displayedQty(variantId)) return;

    desiredQtyMap.set(variantId, target);
    renderVariant(variantId);
    if (box) pulseSheen(box);
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushing || flushTimer !== null) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      void flush();
    }, BATCH_WINDOW_MS);
  }

  function adoptCart(cart) {
    qtyMap.clear();
    (cart && cart.items ? cart.items : []).forEach(function (item) {
      var id = Number(item.variant_id);
      if (Number.isFinite(id) && id > 0) qtyMap.set(id, (qtyMap.get(id) || 0) + (Number(item.quantity) || 0));
    });
  }

  /* Everything the shopper has asked for that the cart does not yet hold. */
  function pendingUpdates() {
    var updates = {};
    var variantIds = [];
    desiredQtyMap.forEach(function (desired, variantId) {
      if (desired !== (qtyMap.get(variantId) || 0)) {
        updates[String(variantId)] = desired;
        variantIds.push(variantId);
      }
    });
    return { updates: updates, variantIds: variantIds };
  }

  /* ONE loop for the whole cart, not one per variant. Per-variant loops were the
     Therabeast design and they are wrong here: Shopify serialises cart writes per
     session, so six products tapped in a row queued six round trips and the last
     one landed 2.4s after the tap. Batched, the same burst is one request. The
     loop re-reads the pending set after every response, so taps that arrive mid
     request join the NEXT batch instead of starting a race. */
  async function flush() {
    if (flushing) return;
    flushing = true;

    var cart = null;
    var failed = [];
    try {
      while (true) {
        var pending = pendingUpdates();
        if (pending.variantIds.length === 0) break;

        pending.variantIds.forEach(function (id) { inFlight.add(id); });
        pending.variantIds.forEach(renderVariant);
        try {
          cart = await updateVariants(pending.updates);
          adoptCart(cart);
        } finally {
          pending.variantIds.forEach(function (id) { inFlight.delete(id); });
        }
      }
    } catch (err) {
      /* The cart is the source of truth: drop every optimistic value we could not
         land rather than leave a number on screen we cannot back up. */
      failed = pendingUpdates().variantIds;
      failed.forEach(function (id) { desiredQtyMap.delete(id); });
      try { cart = await readCart(); } catch (e) { cart = null; }
      document.querySelectorAll('[data-won-stepper]').forEach(function (box) {
        if (failed.indexOf(variantIdOf(box)) !== -1) box.classList.add('is-error');
      });
      setTimeout(function () {
        document.querySelectorAll('[data-won-stepper].is-error').forEach(function (box) {
          box.classList.remove('is-error');
        });
      }, 1600);
    } finally {
      flushing = false;
      if (cart) {
        syncFromCart(cart);
        announce(cart);
        document.dispatchEvent(new CustomEvent('won:cart:added', { bubbles: true, detail: { cart: cart } }));
      } else {
        renderAll();
      }
      /* A tap that landed while we were finishing would otherwise sit unsent. */
      if (pendingUpdates().variantIds.length) scheduleFlush();
    }
  }

  function flashError(btn, label, original) {
    if (label) {
      label.textContent = '!';
      setTimeout(function () { label.textContent = original; }, 1600);
      return;
    }
    btn.classList.add('is-error');
    setTimeout(function () { btn.classList.remove('is-error'); }, 1600);
  }

  /* Plain add button (no stepper): one shot, one confirmation, no live count. */
  async function plainAdd(btn) {
    var id = Number(btn.getAttribute('data-variant-id'));
    if (!Number.isFinite(id) || id <= 0) return;
    var label = btn.querySelector('.won-pcard__add-label');
    var original = label ? label.textContent : '';
    btn.disabled = true;
    try {
      var addBody = { items: [{ id: id, quantity: 1 }] };
      var ids = cartSectionIds();
      if (ids.length) {
        addBody.sections = ids.join(',');
        addBody.sections_url = window.location.pathname;
      }
      var res = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(addBody),
      });
      if (!res.ok) throw new Error('add failed: ' + res.status);
      var item = await res.json();
      /* add.js answers with the LINE, not the cart, and Horizon's cart bubble
         needs item_count — so the read stays. The sections ride along on the add
         itself, which is what spares the drawer a render of its own. */
      var cart = await readCart();
      cart.sections = item.sections;
      syncFromCart(cart);
      announce(cart);
      document.dispatchEvent(new CustomEvent('won:cart:added', { bubbles: true, detail: { id: id, item: item } }));

      btn.classList.add('is-added');
      if (label && btn.dataset.addedLabel) label.textContent = btn.dataset.addedLabel;
      setTimeout(function () {
        btn.classList.remove('is-added');
        if (label) label.textContent = original;
        btn.disabled = false;
      }, 1600);
    } catch (err) {
      btn.disabled = false;
      flashError(btn, label, original);
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-won-add]');
    if (!btn) return;
    e.preventDefault();
    if (btn.disabled) return;

    var box = stepperOf(btn);
    if (!box) {
      void plainAdd(btn);
      return;
    }

    var variantId = variantIdOf(box);
    if (!variantId) return;
    queueQuantityChange(variantId, displayedQty(variantId) + 1, box);
  });

  document.addEventListener('click', function (e) {
    var minus = e.target.closest('[data-won-step="-1"]');
    if (!minus) return;
    e.preventDefault();
    var box = stepperOf(minus);
    if (!box) return;
    var variantId = variantIdOf(box);
    if (!variantId) return;
    var current = displayedQty(variantId);
    if (current > 0) queueQuantityChange(variantId, current - 1, box);
  });

  /* Reflect quantities already in the cart on load, so a returning shopper sees
     the stepper rather than a fresh "Add to cart" for something they have. */
  async function refresh() {
    if (!document.querySelector('[data-won-stepper]')) return;
    try { syncFromCart(await readCart()); } catch (err) { /* no cart, nothing to reflect */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
  document.addEventListener('shopify:section:load', refresh);

  /* Somebody else changed the cart (drawer, cart page, another component). The
     event already CARRIES the new cart, so read it from the payload — the old
     code answered every one of these with another /cart.js round trip. */
  document.addEventListener('cart:update', function (e) {
    if (e.detail && e.detail.sourceId === SOURCE) return;
    var cart = e.detail && e.detail.resource;
    if (cart && Array.isArray(cart.items)) syncFromCart(cart);
    else void refresh();
  });

  /* Steppers arrive after load too — rails paginate, sections re-render, the
     drawer morphs in recommendations — and they come back rendered at zero. */
  new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches('[data-won-stepper]')) renderBox(node);
        if (node.querySelectorAll) node.querySelectorAll('[data-won-stepper]').forEach(renderBox);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.WonCart = { renderAll: renderAll, refresh: refresh, syncFromCart: syncFromCart };
})();
