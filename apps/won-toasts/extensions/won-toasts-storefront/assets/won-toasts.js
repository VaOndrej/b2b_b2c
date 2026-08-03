/*
 * Won Toasts — storefront runtime (MVP1: cart toasts).
 *
 * Pure notification surface: it observes cart mutations, diffs /cart.js
 * snapshots, and renders toasts inside a Shadow-DOM host. It NEVER rewrites
 * prices, never fabricates the merchant's product form, and never auto-adds a
 * product to grant a reward. The ONLY cart write it performs is a user-initiated
 * "Undo" that re-adds a line the shopper just removed.
 *
 * All behaviour comes from the admin config at /apps/won-toasts/config — no
 * behavioural constants are hardcoded here (the object below is only a safe
 * fallback if the config request fails). The diff mirrors
 * @won/core/toasts/cart-events (kept in lockstep by shared spec tests).
 */
(function () {
  "use strict";

  var EMBED_SELECTOR = "[data-won-toasts-embed]";
  var HOST_TAG = "won-toast-host";
  var CART_MUTATOR = /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/;

  var FALLBACK = {
    enabled: true,
    global: {
      position: "top-right",
      offsetTop: 16,
      offsetInline: 16,
      durationMs: 3500,
      autoDismiss: true,
      pauseOnHover: true,
      closeable: true,
      clickAction: "open-cart",
      maxVisible: 3,
      stackDirection: "newest-top",
    },
    theme: {
      accent: {
        added: "#1f8f5f",
        removed: "#c0392b",
        increased: "#1f8f5f",
        decreased: "#b7791f",
        info: "#4a5568",
      },
      colorBg: "#ffffff",
      colorText: "#1a1f24",
      cornerRadius: 12,
      width: 340,
      showImage: true,
      showDelta: true,
      showIcon: true,
    },
  };

  var cfg = FALLBACK;
  var lastCart = { items: [] };
  var host = null;
  var region = null;

  // ---- cart diff (mirror of @won/core/toasts/cart-events) ----
  function isGift(l) {
    return !!(
      l &&
      l.properties &&
      Object.prototype.hasOwnProperty.call(l.properties, "_gift_progress")
    );
  }
  function indexByKey(items) {
    var m = {};
    (items || []).forEach(function (l) {
      if (l && typeof l.key === "string" && !isGift(l)) m[l.key] = l;
    });
    return m;
  }
  function deriveEvents(before, after) {
    var b = indexByKey(before && before.items);
    var a = indexByKey(after && after.items);
    var ev = [];
    (after && after.items ? after.items : []).forEach(function (l) {
      if (!l || typeof l.key !== "string" || isGift(l)) return;
      var prev = b[l.key];
      var pq = prev ? prev.quantity : 0;
      var d = l.quantity - pq;
      if (d === 0) return;
      if (pq === 0)
        ev.push({ type: "added", key: l.key, delta: d, line: l });
      else
        ev.push({
          type: d > 0 ? "increased" : "decreased",
          key: l.key,
          delta: d,
          line: l,
        });
    });
    (before && before.items ? before.items : []).forEach(function (l) {
      if (!l || typeof l.key !== "string" || isGift(l)) return;
      if (a[l.key]) return;
      ev.push({ type: "removed", key: l.key, delta: -l.quantity, line: l });
    });
    return ev;
  }

  // ---- rendering ----
  function accentFor(type) {
    var a = cfg.theme.accent || FALLBACK.theme.accent;
    return a[type] || a.info || "#4a5568";
  }
  function labelFor(ev) {
    var name = ev.line.product_title || ev.line.title || "Item";
    if (ev.type === "added") return { title: "Added to cart", detail: name };
    if (ev.type === "removed") return { title: "Removed", detail: name };
    return { title: "Updated", detail: name };
  }
  function deltaText(ev) {
    if (!cfg.theme.showDelta || ev.type === "removed") return "";
    return (ev.delta > 0 ? "+" : "") + ev.delta;
  }

  function styleRegion() {
    if (!region) return;
    var g = cfg.global;
    var vert = g.position.indexOf("bottom") === 0 ? "bottom" : "top";
    var mid = g.position.indexOf("middle") === 0;
    var horiz =
      g.position.indexOf("left") >= 0
        ? "left"
        : g.position.indexOf("center") >= 0
          ? "center"
          : "right";
    var s = region.style;
    s.position = "fixed";
    s.display = "flex";
    s.flexDirection = "column";
    s.gap = (cfg.theme.gap || 10) + "px";
    s.zIndex = "2147483000";
    s.pointerEvents = "none";
    s.top = s.bottom = s.left = s.right = "auto";
    if (mid) {
      s.top = "50%";
      s.transform = "translateY(-50%)";
    } else {
      s[vert] = g.offsetTop + "px";
    }
    if (horiz === "center") {
      s.left = "50%";
      s.transform = (mid ? "translate(-50%,-50%)" : "translateX(-50%)");
    } else {
      s[horiz] = g.offsetInline + "px";
    }
  }

  function el(tag, css) {
    var e = document.createElement(tag);
    if (css) e.setAttribute("style", css);
    return e;
  }

  function renderToast(ev) {
    if (!region) return;
    var t = cfg.theme;
    var label = labelFor(ev);
    var card = el(
      "div",
      "pointer-events:auto;box-sizing:border-box;display:flex;gap:10px;align-items:center;" +
        "width:" +
        (t.width || 340) +
        "px;max-width:calc(100vw - 32px);padding:12px 14px;" +
        "background:" +
        (t.colorBg || "#fff") +
        ";color:" +
        (t.colorText || "#1a1f24") +
        ";border-radius:" +
        (t.cornerRadius || 12) +
        "px;border-left:4px solid " +
        accentFor(ev.type) +
        ";box-shadow:0 6px 24px rgba(0,0,0,.16);font:14px/1.35 system-ui,sans-serif;",
    );
    card.setAttribute("data-won-toast", "");
    card.setAttribute("data-type", ev.type);

    if (t.showImage && ev.line.image) {
      var img = el(
        "img",
        "width:40px;height:40px;border-radius:8px;object-fit:cover;flex:0 0 auto;",
      );
      img.src = ev.line.image;
      img.alt = "";
      card.appendChild(img);
    }

    var body = el("div", "flex:1 1 auto;min-width:0;");
    var title = el("div", "font-weight:700;");
    title.textContent = label.title;
    var detail = el(
      "div",
      "color:#5c6670;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
    );
    detail.textContent = label.detail;
    body.appendChild(title);
    body.appendChild(detail);
    card.appendChild(body);

    var dt = deltaText(ev);
    if (dt) {
      var badge = el(
        "div",
        "font-weight:800;flex:0 0 auto;color:" + accentFor(ev.type) + ";",
      );
      badge.textContent = dt;
      badge.setAttribute("data-won-toast-delta", "");
      card.appendChild(badge);
    }

    // Undo re-adds the just-removed line — the only user-initiated cart write.
    if (ev.type === "removed") {
      var undo = el(
        "button",
        "flex:0 0 auto;border:0;background:transparent;color:" +
          accentFor("info") +
          ";font:inherit;font-weight:700;cursor:pointer;text-decoration:underline;",
      );
      undo.type = "button";
      undo.textContent = "Undo";
      undo.setAttribute("data-won-toast-undo", "");
      undo.addEventListener("click", function (e) {
        e.stopPropagation();
        undo.disabled = true;
        window
          .fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: ev.line.id,
              quantity: Math.abs(ev.delta),
            }),
          })
          .then(function () {
            reconcile();
            dismiss(card);
          })
          .catch(function () {
            undo.disabled = false;
          });
      });
      card.appendChild(undo);
    }

    if (cfg.global.closeable) {
      var close = el(
        "button",
        "flex:0 0 auto;border:0;background:transparent;color:#9aa4ad;font:inherit;" +
          "font-size:18px;line-height:1;cursor:pointer;padding:0 2px;",
      );
      close.type = "button";
      close.setAttribute("aria-label", "Dismiss");
      close.setAttribute("data-won-toast-close", "");
      close.textContent = "×";
      close.addEventListener("click", function (e) {
        e.stopPropagation();
        dismiss(card);
      });
      card.appendChild(close);
    }

    if (cfg.global.clickAction === "open-cart") {
      card.style.cursor = "pointer";
      card.addEventListener("click", function () {
        window.location.href = "/cart";
      });
    }

    // stack placement
    if (cfg.global.stackDirection === "newest-top") {
      region.insertBefore(card, region.firstChild);
    } else {
      region.appendChild(card);
    }
    enforceMaxVisible();

    // auto-dismiss with pause-on-hover
    if (cfg.global.autoDismiss) {
      scheduleDismiss(card);
      if (cfg.global.pauseOnHover) {
        card.addEventListener("mouseenter", function () {
          clearTimeout(card.__wonTimer);
        });
        card.addEventListener("mouseleave", function () {
          scheduleDismiss(card);
        });
      }
    }
  }

  function scheduleDismiss(card) {
    clearTimeout(card.__wonTimer);
    card.__wonTimer = setTimeout(function () {
      dismiss(card);
    }, cfg.global.durationMs);
  }
  function dismiss(card) {
    clearTimeout(card.__wonTimer);
    if (card && card.parentNode) card.parentNode.removeChild(card);
  }
  function enforceMaxVisible() {
    if (!region) return;
    var max = cfg.global.maxVisible || 3;
    while (region.children.length > max) {
      // remove the oldest (opposite end from where new ones are inserted)
      var oldest =
        cfg.global.stackDirection === "newest-top"
          ? region.lastChild
          : region.firstChild;
      dismiss(oldest);
    }
  }

  // ---- cart observation ----
  var reconcileTimer = null;
  var reconciling = false;
  function reconcile() {
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(function () {
      if (reconciling) return;
      reconciling = true;
      window
        .fetch("/cart.js", { headers: { Accept: "application/json" } })
        .then(function (r) {
          return r.json();
        })
        .then(function (after) {
          if (cfg.enabled) {
            deriveEvents(lastCart, after).forEach(renderToast);
          }
          lastCart = after;
        })
        .catch(function () {})
        .then(function () {
          reconciling = false;
        });
    }, 150);
  }

  function isMutator(url) {
    return typeof url === "string" && CART_MUTATOR.test(url);
  }

  function wrapFetch() {
    if (!window.fetch || window.fetch.__wonWrapped) return;
    var orig = window.fetch;
    var wrapped = function (input) {
      var url = typeof input === "string" ? input : input && input.url;
      var p = orig.apply(this, arguments);
      if (isMutator(url)) {
        p.then(function () {
          reconcile();
        }).catch(function () {});
      }
      return p;
    };
    wrapped.__wonWrapped = true;
    window.fetch = wrapped;
  }

  function wrapXHR() {
    var proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (!proto || proto.__wonWrapped) return;
    var open = proto.open;
    proto.open = function (method, url) {
      this.__wonUrl = url;
      return open.apply(this, arguments);
    };
    var send = proto.send;
    proto.send = function () {
      var self = this;
      if (isMutator(self.__wonUrl)) {
        self.addEventListener("loadend", function () {
          reconcile();
        });
      }
      return send.apply(this, arguments);
    };
    proto.__wonWrapped = true;
  }

  // ---- boot ----
  function mountHost() {
    if (window.customElements && !window.customElements.get(HOST_TAG)) {
      window.customElements.define(
        HOST_TAG,
        class WonToastHost extends HTMLElement {
          connectedCallback() {
            if (this.__wonMounted) return;
            this.__wonMounted = true;
            var root = this.attachShadow({ mode: "open" });
            var r = document.createElement("div");
            r.setAttribute("data-won-toasts-region", "");
            r.setAttribute("role", "status");
            r.setAttribute("aria-live", "polite");
            r.setAttribute("aria-atomic", "false");
            root.appendChild(r);
            this.__region = r;
          }
        },
      );
    }
    var existing = document.querySelector(HOST_TAG + "[data-won-toasts-host]");
    if (existing) {
      host = existing;
    } else {
      host = document.createElement(HOST_TAG);
      host.setAttribute("data-won-toasts-host", "");
      document.body.appendChild(host);
    }
    region = host.shadowRoot
      ? host.shadowRoot.querySelector("[data-won-toasts-region]")
      : null;
  }

  function init(embed) {
    if (embed.__wonToastsInit) return;
    embed.__wonToastsInit = true;

    mountHost();
    styleRegion();
    wrapFetch();
    wrapXHR();

    document.addEventListener("cart:updated", function () {
      reconcile();
    });

    var endpoint = embed.getAttribute("data-won-toasts-endpoint");
    var ready = function () {
      styleRegion();
      // seed the baseline cart so the first mutation diffs correctly
      window
        .fetch("/cart.js", { headers: { Accept: "application/json" } })
        .then(function (r) {
          return r.json();
        })
        .then(function (c) {
          lastCart = c;
        })
        .catch(function () {})
        .then(function () {
          embed.setAttribute("data-won-toasts-status", "ready");
        });
    };

    if (endpoint && window.fetch) {
      window
        .fetch(endpoint, { headers: { Accept: "application/json" } })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (data && data.config) cfg = data.config;
        })
        .catch(function () {})
        .then(ready);
    } else {
      ready();
    }
  }

  function boot() {
    var embed = document.querySelector(EMBED_SELECTOR);
    if (embed) init(embed);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
