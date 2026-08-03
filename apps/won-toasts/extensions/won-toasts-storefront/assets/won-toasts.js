/*
 * Won Toasts — storefront runtime (MVP0 skeleton).
 *
 * Contract: this file is a PURE notification surface. It never touches prices,
 * never creates a product/cart <form>, and never mutates the cart. It mounts a
 * Shadow-DOM host so the theme's CSS cannot leak in and the app owns 100% of
 * the toast look. Everything it does is driven by the admin config fetched from
 * /apps/won-toasts/config — no behavioural constants live here.
 *
 * MVP0 responsibilities only:
 *   - define the <won-toast-host> custom element (Shadow DOM + live region),
 *   - mount one host and expose a stable [data-won-toasts-region],
 *   - flip data-won-toasts-status="ready" so E2E can anchor on it.
 * Cart diffing + rendering arrive in MVP1.
 */
(function () {
  "use strict";

  var EMBED_SELECTOR = "[data-won-toasts-embed]";
  var HOST_TAG = "won-toast-host";

  if (window.customElements && !window.customElements.get(HOST_TAG)) {
    window.customElements.define(
      HOST_TAG,
      class WonToastHost extends HTMLElement {
        connectedCallback() {
          if (this.__wonMounted) {
            return;
          }
          this.__wonMounted = true;
          var root = this.attachShadow({ mode: "open" });
          var region = document.createElement("div");
          region.setAttribute("data-won-toasts-region", "");
          // Accessibility: announce politely, never steal focus. MVP3 lets the
          // admin choose polite/assertive per rule.
          region.setAttribute("role", "status");
          region.setAttribute("aria-live", "polite");
          region.setAttribute("aria-atomic", "false");
          root.appendChild(region);
          this.__region = region;
        }
      },
    );
  }

  function mountHost() {
    var existing = document.querySelector(HOST_TAG + "[data-won-toasts-host]");
    if (existing) {
      return existing;
    }
    var host = document.createElement(HOST_TAG);
    host.setAttribute("data-won-toasts-host", "");
    document.body.appendChild(host);
    return host;
  }

  function init(embed) {
    if (embed.__wonToastsInit) {
      return;
    }
    embed.__wonToastsInit = true;

    mountHost();

    // MVP0 proves the wiring only: fetch config, render nothing yet. The
    // endpoint is the single source of truth for later MVPs.
    var endpoint = embed.getAttribute("data-won-toasts-endpoint");
    if (endpoint && window.fetch) {
      window
        .fetch(endpoint, { headers: { Accept: "application/json" } })
        .catch(function () {
          /* storefront must never throw if config is unavailable */
        });
    }

    embed.setAttribute("data-won-toasts-status", "ready");
  }

  function boot() {
    var embed = document.querySelector(EMBED_SELECTOR);
    if (embed) {
      init(embed);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
