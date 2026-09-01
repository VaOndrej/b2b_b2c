/* won-cart.js — global quick-add for won product cards. Delegates clicks on any
   [data-won-add] button (card quick-add) and adds the variant via AJAX.  Loaded
   once in <head> (wired by compose).

   The add itself always worked; what was missing was TELLING THE HOST THEME.
   We only fired our own `cart:refresh`, which nothing in Horizon listens to, so
   the header count stayed at 0 and the drawer kept its old contents — from the
   shopper's side "quick add does nothing". We now also fire Horizon's
   `cart:update` (assets/events.js, ThemeEvents.cartUpdate) carrying the fresh
   cart and its item count, which is what cart-icon / cart-items / cart-drawer
   re-render from. `cart:refresh` stays for base-agnostic hosts. */
(function () {
  if (window.__wonCartBound) return;
  window.__wonCartBound = true;

  var SOURCE = 'won-card-quick-add';

  function stepperOf(el) { return el && el.closest('[data-won-stepper]'); }

  async function readCart() {
    var res = await fetch('/cart.js', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('cart read failed: ' + res.status);
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
          data: { source: SOURCE, itemCount: cart && cart.item_count },
        },
      })
    );
  }

  /* Reflect the cart on EVERY stepper on the page, not just the one that was
     clicked: the same product appears in several rails on the homepage, and
     leaving the other cards on "Add to cart" for something already in the cart
     is the same lie the header count was telling. */
  function syncSteppers(cart) {
    var byVariant = {};
    (cart && cart.items ? cart.items : []).forEach(function (i) {
      /* First line wins: that is the line this card can address. A variant on
         several lines (properties, selling plans) is not a card's business. */
      if (!byVariant[String(i.variant_id)]) byVariant[String(i.variant_id)] = i;
    });
    document.querySelectorAll('[data-won-stepper]').forEach(function (box) {
      var btn = box.querySelector('[data-won-add]');
      if (!btn) return;
      var line = byVariant[String(btn.getAttribute('data-variant-id'))];
      if (line) {
        box.dataset.wonLineKey = line.key;
      } else {
        delete box.dataset.wonLineKey;
      }
      showQty(box, line ? line.quantity : 0);
    });
  }

  function showQty(box, qty) {
    if (!box) return;
    var out = box.querySelector('[data-won-qty]');
    var minus = box.querySelector('[data-won-step="-1"]');
    if (!out || !minus) return;
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
  }

  function flashError(btn, label, original) {
    if (label && !stepperOf(btn)) {
      label.textContent = '!';
      setTimeout(function () { label.textContent = original; }, 1600);
      return;
    }
    btn.classList.add('is-error');
    setTimeout(function () { btn.classList.remove('is-error'); }, 1600);
  }

  document.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-won-add]');
    if (!btn) return;
    e.preventDefault();
    if (btn.disabled) return;
    var id = btn.getAttribute('data-variant-id');
    if (!id) return;
    var box = stepperOf(btn);
    var label = btn.querySelector('.won-pcard__add-label');
    var original = label ? label.textContent : '';
    btn.disabled = true;
    try {
      var res = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [{ id: Number(id), quantity: 1 }] }),
      });
      if (!res.ok) throw new Error('add failed: ' + res.status);
      var data = await res.json();
      /* Quantity comes from the CART, never from a guess: a second tap must
         show 2, and the shopper may already have had this line. */
      var cart = await readCart();
      syncSteppers(cart);
      announce(cart);
      document.dispatchEvent(new CustomEvent('won:cart:added', { bubbles: true, detail: { id: id, item: data } }));

      if (box) {
        /* In stepper mode the button IS the "+". Locking it behind a 1.6s
           "Added" confirmation would make a second tap silently do nothing. */
        btn.disabled = false;
      } else {
        btn.classList.add('is-added');
        if (label && btn.dataset.addedLabel) label.textContent = btn.dataset.addedLabel;
        setTimeout(function () {
          btn.classList.remove('is-added');
          if (label) label.textContent = original;
          btn.disabled = false;
        }, 1600);
      }
    } catch (err) {
      btn.disabled = false;
      flashError(btn, label, original);
    }
  });

  /* Stepper mode (won_card_add_mode = stepper). The "+" IS the quick-add button
     above, so the first tap stays a plain add and this only owns the "−".
     Quantity is nudged with /cart/change.js by line key, which is the only
     endpoint that can take a line back to zero. */
  async function changeLine(key, quantity) {
    var res = await fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: key, quantity: quantity }),
    });
    if (!res.ok) throw new Error('change failed: ' + res.status);
    return res.json();
  }

  document.addEventListener('click', async function (e) {
    var minus = e.target.closest('[data-won-step="-1"]');
    if (!minus) return;
    e.preventDefault();
    var box = stepperOf(minus);
    if (!box || minus.disabled) return;
    /* The line KEY is the only stable handle for /cart/change.js — a variant id
       is ambiguous once the same variant appears on several lines, and passing
       it silently changes the wrong one. */
    var key = box.dataset.wonLineKey;
    if (!key) return;
    var next = Math.max(0, Number(box.dataset.wonQtyValue || 0) - 1);
    minus.disabled = true;
    try {
      var cart = await changeLine(key, next);
      syncSteppers(cart);
      announce(cart);
    } catch (err) {
      /* leave the shown quantity as-is; the cart is the source of truth */
    } finally {
      minus.disabled = false;
    }
  });

  /* Reflect quantities already in the cart on load, so a returning shopper sees
     the stepper rather than a fresh "Add to cart" for something they have. */
  async function reflectOnLoad() {
    if (!document.querySelector('[data-won-stepper]')) return;
    try {
      syncSteppers(await readCart());
    } catch (err) { /* no cart, nothing to reflect */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reflectOnLoad);
  } else {
    reflectOnLoad();
  }
  /* Sections re-render on their own (theme editor, cart drawer morphs, section
     rendering API) and come back with fresh, empty steppers. */
  document.addEventListener('shopify:section:load', reflectOnLoad);
  document.addEventListener('cart:update', function (e) {
    if (e.detail && e.detail.sourceId === SOURCE) return;
    reflectOnLoad();
  });
})();
