"use strict";

/*
 * Won Quantity — storefront enhancer.
 *
 * Served directly as a theme app-extension asset (no build step / bundler), so
 * this file is the source: keep it readable. It progressively enhances the
 * native product-form quantity input to honour the shop's min / step / max
 * rules fetched from the app proxy, without replacing the theme's own markup.
 *
 * Theme-agnostic by design (Horizon + Dawn): it never assumes the quantity
 * input is a DOM descendant of the <form action="/cart/add"> — Dawn associates
 * the input via the `form` attribute and keeps the stepper buttons outside the
 * form, so all form lookups go through `input.form` (the `x` guard), not DOM
 * nesting.
 */

(() => {
  // Idempotency guard: the asset can be injected more than once (app embed +
  // section reloads); only the first load wires everything up.
  if (window.WonQuantityStorefront) return;

  const EMBED_SELECTOR = "[data-won-quantity-embed]";
  const QUANTITY_INPUT_SELECTOR = "input[name='quantity']";
  const CART_FORM_SELECTOR = "form[action*='/cart/add']";
  // Placeholder in the localized notice templates, replaced with the number.
  const MESSAGE_TOKEN = "__WON_QUANTITY__";

  // Per-input bookkeeping: the theme's native min/step/max ("native"), the
  // values we last wrote ("applied"), the notice node, and the in-flight
  // request key used to drop stale async results.
  const inputState = new WeakMap();
  // Config responses cached by `${productId}:${variantId}:${locale}`.
  const configCache = new Map();
  let scanTimer = null;

  // Coerce to a positive integer (>= 1), else fall back.
  function coercePositiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
  }

  // Parse an optional positive integer; null when absent/blank/invalid.
  function parseOptionalPositiveInt(value) {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
  }

  function gcd(a, b) {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y) {
      const remainder = x % y;
      x = y;
      y = remainder;
    }
    return x || 1;
  }

  function lcm(a, b) {
    return Math.abs(a * b) / gcd(a, b);
  }

  function getAttr(element, name) {
    return element.hasAttribute(name) ? element.getAttribute(name) : null;
  }

  // Set an attribute, or remove it when the value is null/empty.
  function setOrRemoveAttr(element, name, value) {
    if (value == null || value === "") {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, String(value));
    }
  }

  // Undo our previous override so a re-scan reads the theme's fresh native
  // values. Only restore attributes still holding the value we applied (i.e.
  // the theme hasn't changed them since), then clear the applied marker.
  function restoreNativeAttributes(input, state) {
    if (!state?.applied || !state.native) return;
    for (const name of ["min", "step", "max"]) {
      if (getAttr(input, name) === state.applied[name]) {
        setOrRemoveAttr(input, name, state.native[name]);
      }
    }
    state.applied = null;
  }

  // Get-or-create the input's state, restore any prior override, then capture
  // the current (native) min/step/max as the baseline to reconcile against.
  function ensureState(input) {
    let state = inputState.get(input);
    if (!state) {
      state = { native: null, applied: null, notice: null, requestKey: null };
      inputState.set(input, state);
    }
    restoreNativeAttributes(input, state);
    state.native = {
      min: getAttr(input, "min"),
      step: getAttr(input, "step"),
      max: getAttr(input, "max"),
    };
    return state;
  }

  // True only for a quantity input whose associated form posts to /cart/add.
  // Uses `input.form` first so it works whether the input is nested in the form
  // (Horizon) or linked via the `form` attribute (Dawn).
  function isCartQuantityInput(node) {
    if (!(node instanceof HTMLInputElement) || !node.matches(QUANTITY_INPUT_SELECTOR)) {
      return false;
    }
    const form = node.form || node.closest(CART_FORM_SELECTOR);
    return (
      form instanceof HTMLFormElement &&
      /\/cart\/add(?:[/?#]|$)/i.test(form.getAttribute("action") || "")
    );
  }

  // Trailing digits of a value, e.g. a numeric id or the tail of a GID.
  function trailingDigits(value) {
    const match = String(value || "").match(/(\d+)$/);
    return match ? match[1] : "";
  }

  // Resolve the product/variant ids for this input. Product id comes from the
  // nearest [data-product-id] (falling back to the embed's server-rendered id);
  // variant id from the form's id field (falling back to data-variant-id / the
  // embed). trailingDigits normalizes numeric ids and GIDs alike.
  function resolveIds(input, embed) {
    const form = input.form || input.closest(CART_FORM_SELECTOR);
    const productScope =
      input.closest("[data-product-id]") ||
      form?.closest("[data-product-id]") ||
      form;
    const productId = trailingDigits(
      productScope?.getAttribute?.("data-product-id") ||
        embed.dataset.wonQuantityProductId,
    );
    const idField = form?.querySelector("input[name='id'], select[name='id']");
    const variantId = trailingDigits(
      idField?.value ||
        productScope?.getAttribute?.("data-variant-id") ||
        embed.dataset.wonQuantityVariantId,
    );
    return { productId, variantId };
  }

  // Reconcile the theme's native min/step/max with the shop's configured rule.
  // Returns the effective { minimum, step, maximum } or null when the two are
  // incompatible (e.g. no common step grid within a sane bound).
  function reconcileConstraints(input, config) {
    const nativeMin = coercePositiveInt(input.min, 1);
    const nativeStep = coercePositiveInt(input.step, 1);
    const nativeMax = parseOptionalPositiveInt(input.max);
    const configMin = coercePositiveInt(config.minimum, 1);
    const configStep = coercePositiveInt(config.step, 1);
    const configMax = parseOptionalPositiveInt(config.maximum);

    const stepGcd = gcd(nativeStep, configStep);
    // The native minimum must sit on the native step grid for a combined step
    // to line up at all.
    if (nativeMin % stepGcd !== 0) return null;

    const combinedStep = lcm(nativeStep, configStep);
    if (!Number.isSafeInteger(combinedStep) || combinedStep > 1e5) return null;

    const floor = Math.max(nativeMin, configMin);
    // Snap the minimum up to the first value that lands on BOTH step grids
    // (native, measured from nativeMin; and the config step, from 0).
    let minimum = floor;
    const searchLimit = floor + combinedStep;
    while (
      minimum <= searchLimit &&
      ((minimum - nativeMin) % nativeStep !== 0 || minimum % configStep !== 0)
    ) {
      minimum += 1;
    }
    if (minimum > searchLimit) return null;

    let maximum = nativeMax;
    if (configMax !== null) {
      maximum = maximum === null ? configMax : Math.min(maximum, configMax);
    }
    if (maximum !== null && maximum < minimum) return null;
    return { minimum, step: combinedStep, maximum };
  }

  // Snap an arbitrary value onto the constraint grid: floor to the nearest
  // valid step at/above the minimum, then clamp to the maximum's last valid step.
  function normalizeQuantity(value, constraints) {
    const numeric = Number(value);
    const base = Number.isFinite(numeric) ? Math.floor(numeric) : constraints.minimum;
    let normalized =
      base <= constraints.minimum
        ? constraints.minimum
        : constraints.minimum +
          Math.ceil((base - constraints.minimum) / constraints.step) * constraints.step;
    if (constraints.maximum !== null && normalized > constraints.maximum) {
      normalized =
        constraints.minimum +
        Math.floor((constraints.maximum - constraints.minimum) / constraints.step) *
          constraints.step;
    }
    return Math.max(constraints.minimum, normalized);
  }

  // Dispatch input+change so the theme's own quantity component reacts. Tagged
  // with `wonQuantity` so our own change listener ignores these synthetic events.
  function dispatchSyntheticInputChange(input) {
    const inputEvent = new Event("input", { bubbles: true });
    const changeEvent = new Event("change", { bubbles: true });
    inputEvent.wonQuantity = true;
    changeEvent.wonQuantity = true;
    input.dispatchEvent(inputEvent);
    input.dispatchEvent(changeEvent);
  }

  // Clamp the input's current value onto the constraints, notifying the theme
  // only when the value actually changed.
  function clampToConstraints(input, constraints) {
    const normalized = normalizeQuantity(input.value, constraints);
    if (String(normalized) !== String(input.value)) {
      input.value = String(normalized);
      dispatchSyntheticInputChange(input);
    }
  }

  // Fill the numeric placeholder in a localized message template.
  function fillMessageToken(template, value) {
    return String(template || "").replace(MESSAGE_TOKEN, String(value));
  }

  function removeNotice(state) {
    state?.notice?.remove();
    if (state) state.notice = null;
  }

  // Render (or re-render) the assistive notice describing the active rule.
  function renderNotice(input, state, embed, constraints) {
    removeNotice(state);
    const parts = [];
    if (constraints.minimum > 1) {
      parts.push(fillMessageToken(embed.dataset.wonQuantityMessageMinimum, constraints.minimum));
    }
    if (constraints.step > 1) {
      parts.push(fillMessageToken(embed.dataset.wonQuantityMessageStep, constraints.step));
    }
    if (constraints.maximum !== null) {
      parts.push(fillMessageToken(embed.dataset.wonQuantityMessageMaximum, constraints.maximum));
    }
    if (!parts.length || input.type === "hidden") return;

    const notice = document.createElement("p");
    notice.setAttribute("data-won-quantity-notice", "");
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.textContent = parts.filter(Boolean).join(" · ");
    (
      input.closest("quantity-input, quantity-selector-component, .quantity") || input
    ).insertAdjacentElement("afterend", notice);
    state.notice = notice;
  }

  // Revert the input to its native state and drop our readiness markers.
  function resetInput(input, state) {
    restoreNativeAttributes(input, state);
    removeNotice(state);
    input.removeAttribute("data-won-quantity-ready");
    input.removeAttribute("data-won-quantity-status");
  }

  // Apply a resolved config to the input: disabled/incompatible configs reset
  // it; a valid one writes min/step/max, snaps the value, and shows the notice.
  function applyConfig(input, embed, config) {
    const state = ensureState(input);
    if (!config?.enabled) {
      resetInput(input, state);
      return;
    }
    const constraints = reconcileConstraints(input, config);
    if (!constraints) {
      resetInput(input, state);
      input.setAttribute("data-won-quantity-status", "incompatible");
      return;
    }
    setOrRemoveAttr(input, "min", constraints.minimum);
    setOrRemoveAttr(input, "step", constraints.step);
    setOrRemoveAttr(input, "max", constraints.maximum);
    state.applied = {
      min: getAttr(input, "min"),
      step: getAttr(input, "step"),
      max: getAttr(input, "max"),
    };
    input.setAttribute("data-won-quantity-ready", "");
    input.setAttribute("data-won-quantity-status", "ready");
    clampToConstraints(input, constraints);
    renderNotice(input, state, embed, constraints);
  }

  // Fetch (and cache) the shop's quantity config for a product/variant/locale.
  // Network/HTTP failures resolve to a disabled config so the input is left
  // untouched rather than throwing.
  async function fetchConfig(embed, ids) {
    const locale = embed.dataset.wonQuantityLocale || "en";
    const cacheKey = `${ids.productId}:${ids.variantId}:${locale}`;
    if (configCache.has(cacheKey)) return configCache.get(cacheKey);

    const endpoint = new URL(
      embed.dataset.wonQuantityEndpoint || "/apps/won-quantity/config",
      window.location.origin,
    );
    if (ids.productId) endpoint.searchParams.set("product_id", ids.productId);
    if (ids.variantId) endpoint.searchParams.set("variant_id", ids.variantId);
    endpoint.searchParams.set("locale", locale);

    const request = fetch(endpoint, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Won Quantity config ${response.status}`);
        return response.json();
      })
      .catch(() => ({ enabled: false }));

    configCache.set(cacheKey, request);
    return request;
  }

  // Enhance a single quantity input: resolve its ids, fetch config, then apply
  // — but only if this is still the newest request for the input and it's still
  // in the DOM (guards against variant switches racing each other).
  async function enhanceInput(input, embed) {
    if (!isCartQuantityInput(input)) return;
    const ids = resolveIds(input, embed);
    const requestKey = `${ids.productId}:${ids.variantId}`;
    const state = inputState.get(input) || ensureState(input);
    state.requestKey = requestKey;
    const config = await fetchConfig(embed, ids);
    if (!input.isConnected || state.requestKey !== requestKey) return;
    applyConfig(input, embed, config);
  }

  // Enhance every quantity input on the page (no-op without the app embed).
  function scan() {
    const embed = document.querySelector(EMBED_SELECTOR);
    if (!(embed instanceof HTMLElement)) return;
    for (const input of Array.from(document.querySelectorAll(QUANTITY_INPUT_SELECTOR))) {
      if (input instanceof HTMLInputElement) enhanceInput(input, embed);
    }
  }

  // Debounced scan so bursts of DOM mutations collapse into a single pass.
  function scheduleScan(delay = 0) {
    if (scanTimer !== null) window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      scanTimer = null;
      scan();
    }, delay);
  }

  // Re-clamp on genuine user edits (ignoring our own synthetic events), then
  // schedule a scan to pick up any variant/section change the edit accompanied.
  document.addEventListener(
    "change",
    (event) => {
      if (event.wonQuantity) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement &&
        isCartQuantityInput(target) &&
        inputState.get(target)?.applied
      ) {
        clampToConstraints(target, {
          minimum: coercePositiveInt(target.min, 1),
          step: coercePositiveInt(target.step, 1),
          maximum: parseOptionalPositiveInt(target.max),
        });
      }
      scheduleScan(40);
    },
    true,
  );

  // Section reloads (theme editor) re-render markup — rescan immediately.
  document.addEventListener("shopify:section:load", () => scheduleScan(0));

  // Variant selection. Horizon morphs the product form IN PLACE after fetching
  // the new section, updating the variant id via a property assignment and the
  // native min/step via attribute writes — neither of which fires a `change`
  // event or a childList mutation our observer would catch. So the only reliable
  // signal that the morph has settled is this standard event's promise (Horizon
  // resolves it once the fetched HTML is applied); rescan after it so we read
  // the fresh variant id. Themes without the promise fall back to a debounced
  // rescan.
  document.addEventListener(
    "shopify:product:select",
    (event) => {
      const promise = event && event.promise;
      if (promise && typeof promise.then === "function") {
        promise.then(() => scheduleScan(40), () => scheduleScan(40));
      } else {
        scheduleScan(40);
      }
    },
    true,
  );

  // Catch dynamically injected product markup (quick-add, recommendations,
  // client-rendered sections) that doesn't fire the events above.
  new MutationObserver((mutations) => {
    const touchesProductMarkup = mutations.some((mutation) =>
      Array.from(mutation.addedNodes).some(
        (node) =>
          node instanceof Element &&
          (node.matches(`${CART_FORM_SELECTOR}, ${QUANTITY_INPUT_SELECTOR}, [data-product-id]`) ||
            node.querySelector(`${CART_FORM_SELECTOR}, ${QUANTITY_INPUT_SELECTOR}, [data-product-id]`)),
      ),
    );
    if (touchesProductMarkup) scheduleScan(40);
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.WonQuantityStorefront = { scan, scheduleScan };
  scheduleScan(0);
})();
