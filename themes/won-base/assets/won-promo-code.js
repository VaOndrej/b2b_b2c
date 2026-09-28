/* won-promo-code.js — POC: the cart's existing "Discount code" field stops
   speaking Shopify's discount-code protocol and instead writes a private
   line-item property that an AUTOMATIC Shopify Discount Function matches on.

   Why not a second field: the Horizon markup for the field, its Apply button,
   its error region and its "applied" pills already exist in
   snippets/cart-summary.liquid — a vendor file this layer must never touch. So
   nothing here renders a control of its own; it takes over the BEHAVIOUR of the
   one that is already on screen and reuses its classes verbatim, which is also
   why removing this file leaves the native mechanism working exactly as before.

   How the takeover works, in two halves. compose.mjs stops emitting the
   <script> tag for assets/cart-discount.js, so the vendor component is never
   defined: no `/cart/update.js?discount=` call, no discount_codes parsing, no
   applicable/shipping error branches, nothing. That is the removal. What is
   left on the page is inert markup — <cart-discount-component> stays an unknown
   element, which no CSS keys off, so the field looks exactly as before.

   The second half is this file. A submit on a form nobody handles is a full
   page GET, so the capture-phase listener on `document` still has to be here to
   stop it; it also keeps the takeover intact if the vendor script is ever
   reintroduced, because the vendor bindings sit BELOW document in the tree and
   `stopImmediatePropagation()` retires them without patching anything
   vendor-side. The same listener pattern handles our pill's remove button.

   Native pills are stripped rather than left alone. cart-summary.liquid renders
   one <li> per `discount_code` application with a remove button bound to the
   component that no longer exists — a button that cannot work is worse than no
   button. The discount itself is untouched and still shows in the totals; only
   the dead control goes.

   The theme never decides the DISCOUNT. It writes an identifier and nothing
   else — `_promo_code=tomii_smolka_35`. How much that is worth is decided
   server-side by the Function; a browser that posts `_discount_percentage=90`
   gets a cart with a useless property in it. The allowlist below is UX (tell
   the shopper straight away that a typo is a typo), never a security boundary.

   Line identity: changing properties can move a line's key and its index, so
   the loop never trusts an index it read before the last write. It re-reads the
   cart that /cart/change.js hands back, finds the next line still missing the
   property, and writes that one. Quantity is passed through unchanged on every
   call, so the round trip cannot alter what is in the cart besides the
   property. */
(function () {
  if (window.__wonPromoBound) return;
  window.__wonPromoBound = true;

  var PROP = '_promo_code';
  var SOURCE = 'won-promo-code';

  /* A write cannot need more passes than the cart has lines; the ceiling only
     exists so a server that keeps answering "not yet" cannot spin forever. */
  var MAX_PASSES = 60;

  /** @type {object|null} the cart as we last saw it */
  var cartState = null;
  var busy = false;

  function config() {
    return document.querySelector('[data-won-promo]');
  }

  function canonicalCode() {
    var el = config();
    return (el && el.dataset.code) || '';
  }

  function text(name, fallback) {
    var el = config();
    return (el && el.dataset[name]) || fallback;
  }

  function route(name, fallback) {
    var routes = window.Theme && window.Theme.routes;
    return (routes && routes[name]) || fallback;
  }

  function normalize(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  /* The sections Horizon has to repaint. Same list the native cart requests
     build, for the same reason: with `sections` in the payload the drawer morphs
     from our response, without them cart-items-component fires a section render
     of its own on top of every write. */
  function cartSectionIds() {
    var ids = [];
    document.querySelectorAll('cart-items-component[data-section-id]').forEach(function (el) {
      var id = el.dataset.sectionId;
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    return ids;
  }

  function withSections(body) {
    var ids = cartSectionIds();
    if (ids.length) {
      body.sections = ids.join(',');
      /* Sections render against the Referer without this, which drops the locale
         prefix on a /cs/… storefront. */
      body.sections_url = window.location.pathname;
    }
    return body;
  }

  async function readCart() {
    var res = await fetch(route('cart_url', '/cart') + '.js', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('cart read failed: ' + res.status);
    return res.json();
  }

  async function changeLine(line, quantity, properties) {
    var res = await fetch(route('cart_change_url', '/cart/change') + '.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(withSections({ line: line, quantity: quantity, properties: properties })),
    });
    if (!res.ok) throw new Error('cart change failed: ' + res.status);
    return res.json();
  }

  function promoOn(item) {
    return item && item.properties ? item.properties[PROP] : undefined;
  }

  function cartHasPromo(cart) {
    var code = canonicalCode();
    if (!code) return false;
    var items = (cart && cart.items) || [];
    return items.some(function (item) {
      return promoOn(item) === code;
    });
  }

  /* Merchandise lines only, and only the ones not already in the target state.
     Gift cards and anything without a variant are skipped — the Function's line
     group would never match them and rewriting them would cost a round trip for
     nothing. */
  function nextLineToWrite(cart, value) {
    var items = (cart && cart.items) || [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item.variant_id) continue;
      var current = promoOn(item);
      var needsWrite = value ? current !== value : current !== undefined && current !== null && current !== '';
      if (needsWrite) return i;
    }
    return -1;
  }

  /* Walk the cart writing `value` onto every merchandise line, one supported
     /cart/change.js call at a time, re-reading the cart from each response.

     `value === null` removes the property: Shopify deletes a property whose
     value is the empty string, which is the only supported way to drop one — a
     properties object that simply omits the key REPLACES the line's properties
     and would silently take engraving, bundle metadata and every other
     property with it. Which is also why existing keys are copied across on
     every write rather than assumed absent. */
  async function writePromoToCart(value) {
    var cart = await readCart();
    var passes = 0;

    while (passes++ < MAX_PASSES) {
      var index = nextLineToWrite(cart, value);
      if (index === -1) break;

      var item = cart.items[index];
      var properties = {};
      Object.keys(item.properties || {}).forEach(function (key) {
        properties[key] = item.properties[key];
      });
      properties[PROP] = value === null ? '' : value;

      cart = await changeLine(index + 1, item.quantity, properties);
    }

    return cart;
  }

  /* One announcement, two audiences: Horizon's cart components and our own
     won-cart steppers. Shape copied from won-cart.js so both read it the same
     way — `data.sections` is what lets the drawer morph instead of re-fetching,
     `itemCount` is what the cart bubble reads. */
  function announce(cart) {
    cartState = cart;
    document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true, detail: { cart: cart } }));
    document.dispatchEvent(
      new CustomEvent('cart:update', {
        bubbles: true,
        detail: {
          resource: cart,
          sourceId: SOURCE,
          data: { source: SOURCE, itemCount: cart && cart.item_count, sections: cart && cart.sections },
        },
      })
    );
  }

  /* ---- UI, all of it inside the markup cart-summary.liquid already renders ---- */

  function errorRegion(scope) {
    return scope.querySelector('.cart-discount__error');
  }

  /* A native-discount error could be sitting in ANOTHER instance of the field —
     the drawer and the cart page both render one — so a successful write clears
     every one of them, not just the one that was submitted. */
  function clearAllErrors() {
    document.querySelectorAll('cart-discount-component').forEach(hideError);
  }

  function hideError(scope) {
    var region = errorRegion(scope);
    if (!region) return;
    region.classList.add('hidden');
    region.querySelectorAll('.cart-discount__error-text').forEach(function (el) {
      el.classList.add('hidden');
    });
  }

  function showError(scope, message) {
    var region = errorRegion(scope);
    if (!region) return;
    /* The first error slot is the discount-code one; the vendor markup renders
       it with a placeholder code baked in at render time, so the text is
       replaced rather than merely unhidden. */
    var slot = region.querySelector('.cart-discount__error-text');
    region.classList.remove('hidden');
    if (slot) {
      slot.textContent = message;
      slot.classList.remove('hidden');
    }
  }

  /* Our own pill, wearing the vendor pill's classes so it inherits the styling
     of a natively applied code and needs no CSS of its own. Marked with
     data-won-promo-pill so the click handler can tell it from a real one and so
     re-rendering it is idempotent across drawer morphs. */
  /* The disclosure starts collapsed unless Liquid found a native discount code,
     and it never will again — so an active promo would be hidden behind a closed
     "Discount code" toggle. Mirrors disclosure-custom.js's own toggle exactly
     rather than clicking the trigger, which would fight a shopper who just
     closed it. */
  function expandDisclosure(component) {
    var disclosure = component.closest('disclosure-custom');
    var trigger = disclosure && disclosure.querySelector('[ref="disclosureTrigger"]');
    var content = disclosure && disclosure.querySelector('[ref="disclosureContent"]');
    if (!trigger || !content || trigger.matches('[aria-expanded="true"]')) return;
    trigger.setAttribute('aria-expanded', 'true');
    if (trigger.dataset.disclosureClose) trigger.setAttribute('aria-label', trigger.dataset.disclosureClose);
    content.inert = false;
  }

  function renderPill(component) {
    var list = component.querySelector('.cart-discount__codes');
    if (!list) return;

    /* Every pill Liquid rendered belongs to the mechanism that is gone, and its
       remove button is bound to a component that is never defined. */
    list.querySelectorAll('.cart-discount__pill:not([data-won-promo-pill])').forEach(function (pill) {
      pill.remove();
    });

    var existing = list.querySelector('[data-won-promo-pill]');
    if (!cartHasPromo(cartState)) {
      if (existing) existing.remove();
      return;
    }
    expandDisclosure(component);
    if (existing) return;

    var code = canonicalCode();
    var pill = document.createElement('li');
    pill.className = 'cart-discount__pill';
    pill.setAttribute('data-won-promo-pill', '');
    pill.setAttribute('aria-label', text('applied', 'Promo applied') + ': ' + code);

    var label = document.createElement('p');
    label.className = 'cart-discount__pill-code';
    label.textContent = code;

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cart-discount__pill-remove svg-wrapper svg-wrapper--smaller button-unstyled';
    remove.setAttribute('data-won-promo-remove', '');
    remove.setAttribute('aria-label', text('remove', 'Remove discount'));
    remove.textContent = '✕';

    pill.append(label, remove);
    list.append(pill);
  }

  function renderAll() {
    document.querySelectorAll('cart-discount-component').forEach(renderPill);
  }

  function setBusy(component, value) {
    var button = component.querySelector('.cart-discount__button');
    var input = component.querySelector('.cart-discount__input');
    if (button) button.disabled = value;
    if (input) input.disabled = value;
    component.classList.toggle('is-loading', value);
  }

  /* ---- Behaviour takeover ---- */

  async function applyPromo(form) {
    var component = form.closest('cart-discount-component');
    if (!component || busy) return;

    var input = form.querySelector('input[name="discount"]');
    var entered = input ? input.value : '';
    var code = canonicalCode();

    hideError(component);

    if (!code || normalize(entered) !== normalize(code)) {
      showError(component, text('invalid', 'This discount code is not valid.'));
      return;
    }

    busy = true;
    setBusy(component, true);
    try {
      var cart = await writePromoToCart(code);
      if (input) input.value = '';
      clearAllErrors();
      announce(cart);
      renderAll();
    } catch (error) {
      /* Never leave the UI describing a cart that does not exist: say so, then
         re-read the real cart and repaint from that. */
      showError(component, text('failed', 'The discount could not be applied. Please try again.'));
      try {
        cartState = await readCart();
      } catch (readError) {
        cartState = null;
      }
      renderAll();
    } finally {
      busy = false;
      setBusy(component, false);
    }
  }

  async function removePromo(component) {
    if (!component || busy) return;

    busy = true;
    setBusy(component, true);
    hideError(component);
    try {
      var cart = await writePromoToCart(null);
      clearAllErrors();
      announce(cart);
      renderAll();
    } catch (error) {
      showError(component, text('failed', 'The discount could not be applied. Please try again.'));
      try {
        cartState = await readCart();
      } catch (readError) {
        cartState = null;
      }
      renderAll();
    } finally {
      busy = false;
      setBusy(component, false);
    }
  }

  /* Capture on document, so this runs before the vendor component's own
     submit binding and before the form's inline onsubmit — both of which sit
     lower in the tree. */
  document.addEventListener(
    'submit',
    function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      var form = target.closest('.cart-discount__form');
      if (!form || !config()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void applyPromo(form);
    },
    true
  );

  document.addEventListener(
    'click',
    function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      var button = target.closest('[data-won-promo-remove]');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void removePromo(button.closest('cart-discount-component'));
    },
    true
  );

  /* The cart is the source of truth for whether the promo is on, so the state
     survives a reload, a drawer that was closed and reopened, and navigation —
     nothing is kept in localStorage. */
  async function refresh() {
    if (!config()) return;
    try {
      cartState = await readCart();
    } catch (error) {
      cartState = null;
    }
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    void refresh();
  }

  document.addEventListener('cart:update', function (event) {
    var cart = event.detail && event.detail.resource;
    if (cart && Array.isArray(cart.items)) {
      cartState = cart;
      renderAll();
    } else {
      void refresh();
    }
  });

  /* A drawer morph replaces the whole cart section, pill included, and the
     drawer itself is only rendered once the shopper opens it. Both arrive as
     added nodes, so one observer covers both. */
  new MutationObserver(function (mutations) {
    var touched = false;
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1 || touched) return;
        if (node.matches && node.matches('cart-discount-component')) touched = true;
        else if (node.querySelector && node.querySelector('cart-discount-component')) touched = true;
      });
    });
    if (touched) renderAll();
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.WonPromoCode = { refresh: refresh, renderAll: renderAll };
})();
