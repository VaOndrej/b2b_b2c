/*
 * Won Discounts storefront foundation (MVP0).
 *
 * This is deliberately minimal: it proves the app embed loads and flips the
 * root marker from the Liquid-rendered "loading" to "ready" once
 * window.WonDiscounts exists (so "ready" proves this script ran). It never
 * mutates the cart (doctrine SF-1) and
 * stays well under the gzip perf budget (doctrine SF-2). Later MVPs build
 * the discount UI on top of this foundation.
 */
(function () {
  "use strict";

  var ROOT_SELECTOR = "[data-won-discounts-embed]";
  var CONFIG_SCRIPT_ID = "won-discounts-config";
  var VERSION = "0.0.0-mvp0";

  function readConfig() {
    var node = document.getElementById(CONFIG_SCRIPT_ID);
    if (!node) {
      return {};
    }
    try {
      var parsed = JSON.parse(node.textContent || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      // Defensive: a malformed config must never break the storefront.
      return {};
    }
  }

  function init(root) {
    if (root.__wonDiscountsInit) {
      return;
    }
    root.__wonDiscountsInit = true;

    var config = readConfig();

    window.WonDiscounts = {
      version: VERSION,
      config: config,
      ready: true
    };

    // Last step: "ready" only once everything above has run.
    root.setAttribute("data-won-discounts-status", "ready");
  }

  function boot() {
    var root = document.querySelector(ROOT_SELECTOR);
    if (root) {
      init(root);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
