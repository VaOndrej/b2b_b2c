/*
 * Won Toasts — storefront runtime (MVP2: cart toasts + design studio theming).
 *
 * Pure notification surface: observes cart mutations, diffs /cart.js snapshots,
 * renders toasts inside a Shadow-DOM host. It NEVER rewrites prices, fabricates
 * the merchant's product form, or auto-adds a product to grant a reward. The
 * ONLY cart write is a user-initiated "Undo" that re-adds a just-removed line.
 *
 * All behaviour + look comes from the admin config at /apps/won-toasts/config
 * (no constants hardcoded; the object below is only a safe fallback). The diff
 * mirrors @won/core/toasts/cart-events and the style tokens mirror
 * @won/core/toasts/presentation — both kept in lockstep by shared spec tests.
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
      mode: "system",
      colorBg: "#ffffff",
      colorText: "#1a1f24",
      accent: {
        added: "#1f8f5f",
        removed: "#c0392b",
        increased: "#1f8f5f",
        decreased: "#b7791f",
        info: "#4a5568",
      },
      cornerRadius: 12,
      shadow: "md",
      border: false,
      borderColor: "#e2e6ea",
      backdropBlur: false,
      width: 340,
      minWidth: 260,
      maxWidth: 480,
      gap: 10,
      density: "comfortable",
      animationIn: "slide",
      animationMs: 220,
      showImage: true,
      showDelta: true,
      showIcon: true,
    },
  };

  var cfg = FALLBACK;
  var locale = "en";
  var active = true; // targeting: whether toasts run on this page
  var branding = false; // Free plan shows a subtle "Won" mark
  var lastMilestone = null; // last cart milestone state {subtotalCents,hasGiftLine}

  function pageType() {
    var p = location.pathname || "/";
    if (/\/products\//.test(p)) return "product";
    if (/\/collections\/[^/]+/.test(p)) return "collection";
    if (/\/cart/.test(p)) return "cart";
    if (/\/search/.test(p)) return "search";
    if (p === "/" || p === "") return "home";
    return "other";
  }
  function matchesTargeting(t) {
    if (!t) return true;
    var isMobile =
      window.matchMedia && window.matchMedia("(max-width: 749px)").matches;
    if (t.pages && t.pages.length && t.pages.indexOf(pageType()) < 0)
      return false;
    if (t.device === "mobile" && !isMobile) return false;
    if (t.device === "desktop" && isMobile) return false;
    // customerState is not reliably known on the storefront → ignored here.
    return true;
  }
  var lastCart = { items: [] };
  var host = null;
  var region = null;

  function normLocale(v) {
    v = String(v || "en").toLowerCase();
    if (v.indexOf("cs") === 0) return "cs";
    if (v.indexOf("sk") === 0) return "sk";
    return "en";
  }
  function messageFor(type, fallback) {
    var m = cfg.messages && cfg.messages[type];
    return (m && (m[locale] || m.en)) || fallback;
  }
  function renderTemplate(tpl, vars) {
    if (typeof tpl !== "string") return "";
    return tpl.replace(/\{(\w+)\}/g, function (_, k) {
      var val = vars[k];
      return val === undefined || val === null ? "" : String(val);
    });
  }

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
      if (pq === 0) ev.push({ type: "added", key: l.key, delta: d, line: l });
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

  // ---- presentation (mirror of @won/core/toasts/presentation) ----
  var TITLES = {
    added: "Added to cart",
    removed: "Removed",
    increased: "Updated",
    decreased: "Updated",
  };
  function accentFor(type) {
    var a = cfg.theme.accent || FALLBACK.theme.accent;
    return a[type] || a.info || "#4a5568";
  }
  function presentation(grp) {
    var ev = grp.rep;
    var semantic = grp.type === "mixed" ? "info" : grp.type;
    var name = ev.line.product_title || ev.line.title || "Item";
    if (grp.count > 1) name += " +" + (grp.count - 1) + " more";
    var showDelta =
      cfg.theme.showDelta && grp.type !== "removed" && grp.totalDelta !== 0;
    var tpl = messageFor(grp.type, TITLES[grp.type] || "Cart updated");
    return {
      type: semantic,
      title: renderTemplate(tpl, {
        qty: Math.abs(grp.totalDelta),
        delta: grp.totalDelta,
        product: ev.line.product_title || ev.line.title || "",
      }),
      detail: name,
      delta: showDelta ? (grp.totalDelta > 0 ? "+" : "") + grp.totalDelta : "",
      accent: accentFor(semantic),
      image: cfg.theme.showImage ? ev.line.image : null,
    };
  }

  // ---- grouping (mirror of @won/core/toasts/grouping) ----
  function groupKey(ev, mode) {
    if (mode === "by-type") return "type:" + ev.type;
    if (mode === "by-variant") return "variant:" + (ev.line.id || ev.line.key);
    if (mode === "by-product")
      return "product:" + (ev.line.product_id || ev.line.id || ev.line.key);
    return "";
  }
  function groupEvents(events, g) {
    if (g.mode === "off" || !g.mergeDeltas) {
      return events.map(function (e, i) {
        return { key: String(i), type: e.type, count: 1, totalDelta: e.delta, rep: e };
      });
    }
    var order = [];
    var map = {};
    events.forEach(function (e) {
      var k = groupKey(e, g.mode);
      var ex = map[k];
      if (!ex) {
        order.push(k);
        map[k] = { key: k, type: e.type, count: 1, totalDelta: e.delta, rep: e };
      } else {
        ex.count += 1;
        ex.totalDelta += e.delta;
        if (ex.type !== e.type) ex.type = "mixed";
      }
    });
    return order.map(function (k) {
      return map[k];
    });
  }

  // ---- rate-limit + dedupe (mirror of @won/core/toasts/rate-limit) ----
  var emitTimes = [];
  var lastSeen = {};
  function withinRateLimit(now, perMin) {
    if (!(perMin > 0)) return true;
    var start = now - 60000;
    var n = 0;
    emitTimes.forEach(function (t) {
      if (t >= start) n++;
    });
    return n < perMin;
  }
  function isDuplicate(key, now, win) {
    if (!(win > 0)) return false;
    var prev = lastSeen[key];
    return typeof prev === "number" && now - prev < win;
  }

  // ---- milestones (mirror of @won/core/toasts/milestone-rules) ----
  function subtotalCents(cart) {
    var t = 0;
    (cart && cart.items ? cart.items : []).forEach(function (l) {
      if (l && !isGift(l)) t += Number(l.final_line_price || l.linePrice || 0) || 0;
    });
    return t;
  }
  function hasGift(cart) {
    return (cart && cart.items ? cart.items : []).some(function (l) {
      return l && isGift(l);
    });
  }
  function cartMilestone(cart) {
    return { subtotalCents: subtotalCents(cart), hasGiftLine: hasGift(cart) };
  }
  function mState(prev, next, thr) {
    var t = thr > 0 ? thr : 1;
    var pr = prev >= t;
    var nx = next >= t;
    if (nx) return pr ? "reached" : "just_reached";
    if (pr) return "just_lost";
    if (next >= t * 0.8) return "approaching";
    return "unreached";
  }
  function announced(token, id, val) {
    var key = "won-toasts:" + token + ":" + id;
    try {
      if (val === undefined) return sessionStorage.getItem(key) === "1";
      if (val) sessionStorage.setItem(key, "1");
      else sessionStorage.removeItem(key);
    } catch (e) {
      /* private mode: fail open (no persistence) */
    }
    return false;
  }
  function evaluateMilestones(after) {
    var rules = cfg.milestones || [];
    if (!rules.length) return;
    var token = after.token || "cart";
    var prev = lastMilestone || cartMilestone(after);
    var next = cartMilestone(after);
    var rewards = [];
    rules.forEach(function (rule) {
      if (!rule.enabled) return;
      var state;
      if (rule.kind === "gift" && (prev.hasGiftLine || next.hasGiftLine)) {
        state = next.hasGiftLine
          ? prev.hasGiftLine
            ? "reached"
            : "just_reached"
          : prev.hasGiftLine
            ? "just_lost"
            : "unreached";
      } else {
        state = mState(prev.subtotalCents, next.subtotalCents, rule.thresholdCents);
      }
      if (state === "just_lost") {
        announced(token, rule.id, false);
      } else if (state === "just_reached" && !announced(token, rule.id)) {
        announced(token, rule.id, true);
        rewards.push(rule);
      }
    });
    lastMilestone = next;
    if (!rewards.length) return;
    if (cfg.global.summarizeConcurrent && rewards.length >= 2) {
      renderMilestoneToast(
        "shipping",
        "🎉 " +
          rewards
            .map(function (r) {
              return r.label;
            })
            .join(" + "),
      );
    } else {
      rewards.forEach(function (r) {
        var type = r.kind === "gift" ? "gift" : "shipping";
        renderMilestoneToast(type, messageFor(type, r.label));
      });
    }
  }

  // ---- style tokens (mirror of @won/core/toasts/presentation.styleTokensFor) ----
  var SHADOWS = {
    none: "none",
    sm: "0 2px 8px rgba(0,0,0,.12)",
    md: "0 6px 24px rgba(0,0,0,.16)",
    lg: "0 12px 40px rgba(0,0,0,.22)",
  };
  function styleTokens(t) {
    var isDark = t.mode === "dark";
    var bg = t.mode === "custom" ? t.colorBg : isDark ? "#1a1f24" : "#ffffff";
    var text =
      t.mode === "custom" ? t.colorText : isDark ? "#eef1f4" : "#1a1f24";
    return {
      "--won-bg": bg,
      "--won-text": text,
      "--won-radius": t.cornerRadius + "px",
      "--won-width": t.width + "px",
      "--won-min-width": t.minWidth + "px",
      "--won-max-width": t.maxWidth + "px",
      "--won-gap": t.gap + "px",
      "--won-shadow": SHADOWS[t.shadow] || SHADOWS.md,
      "--won-pad": t.density === "compact" ? "8px 12px" : "12px 14px",
      "--won-border": t.border ? "1px solid " + t.borderColor : "0",
      "--won-blur": t.backdropBlur ? "blur(8px)" : "none",
      "--won-anim-ms": t.animationMs + "ms",
    };
  }

  var SHADOW_CSS =
    "[data-won-toasts-region]{position:fixed;display:flex;flex-direction:column;" +
    "gap:var(--won-gap);z-index:2147483000;pointer-events:none;max-width:100vw;}" +
    "[data-won-toast]{pointer-events:auto;box-sizing:border-box;display:flex;gap:10px;" +
    "align-items:center;width:var(--won-width);min-width:var(--won-min-width);" +
    "max-width:min(var(--won-max-width),calc(100vw - 32px));padding:var(--won-pad);" +
    "background:var(--won-bg);color:var(--won-text);border-radius:var(--won-radius);" +
    "box-shadow:var(--won-shadow);border:var(--won-border);" +
    "-webkit-backdrop-filter:var(--won-blur);backdrop-filter:var(--won-blur);" +
    "font:14px/1.35 system-ui,-apple-system,sans-serif;" +
    "animation:won-in var(--won-anim-ms) ease both;}" +
    "[data-won-toast] img{width:40px;height:40px;border-radius:8px;object-fit:cover;flex:0 0 auto;}" +
    "[data-won-toast] .won-b{flex:1 1 auto;min-width:0;}" +
    "[data-won-toast] .won-t{font-weight:700;}" +
    "[data-won-toast] .won-d{color:#8892a0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
    "[data-won-toast-delta]{font-weight:800;flex:0 0 auto;}" +
    "[data-won-toast] button{border:0;background:transparent;font:inherit;cursor:pointer;flex:0 0 auto;}" +
    "[data-won-toast-undo]{font-weight:700;text-decoration:underline;}" +
    "[data-won-toast-close]{font-size:18px;line-height:1;color:#9aa4ad;padding:0 2px;}" +
    "@keyframes won-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}" +
    '[data-anim="fade"] [data-won-toast]{animation-name:won-fade}' +
    '[data-anim="pop"] [data-won-toast]{animation-name:won-pop}' +
    '[data-anim="slide-scale"] [data-won-toast]{animation-name:won-ss}' +
    "@keyframes won-fade{from{opacity:0}to{opacity:1}}" +
    "@keyframes won-pop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}" +
    "@keyframes won-ss{from{opacity:0;transform:translateY(-8px) scale(.96)}to{opacity:1;transform:none}}" +
    "@media (prefers-reduced-motion: reduce){[data-won-toast]{animation:none}}";

  var SYSTEM_DARK_CSS =
    "@media (prefers-color-scheme: dark){[data-won-toasts-region]{" +
    "--won-bg:#1a1f24;--won-text:#eef1f4;}}";

  // ---- rendering ----
  function applyTheme() {
    if (!region) return;
    var tokens = styleTokens(cfg.theme);
    Object.keys(tokens).forEach(function (k) {
      region.style.setProperty(k, tokens[k]);
    });
    region.setAttribute("data-anim", cfg.theme.animationIn || "slide");
    var styleEl = region.__wonStyle;
    if (styleEl) {
      styleEl.textContent =
        SHADOW_CSS +
        (cfg.theme.mode === "system" ? SYSTEM_DARK_CSS : "") +
        (cfg.theme.customCss || "");
    }
    positionRegion();
  }

  function positionRegion() {
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
    s.top = s.bottom = s.left = s.right = "auto";
    s.transform = "none";
    if (mid) {
      s.top = "50%";
      s.transform = "translateY(-50%)";
    } else {
      s[vert] = g.offsetTop + "px";
    }
    if (horiz === "center") {
      s.left = "50%";
      s.transform = mid ? "translate(-50%,-50%)" : "translateX(-50%)";
    } else {
      s[horiz] = g.offsetInline + "px";
    }
  }

  function elem(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function renderToast(grp) {
    if (!region) return;
    var ev = grp.rep;
    var p = presentation(grp);
    var card = elem("div");
    card.setAttribute("data-won-toast", "");
    card.setAttribute("data-type", grp.type);
    card.setAttribute("data-group-count", String(grp.count));
    card.style.borderLeft = "4px solid " + p.accent;

    if (p.image) {
      var img = elem("img");
      img.src = p.image;
      img.alt = "";
      card.appendChild(img);
    }

    var body = elem("div", "won-b");
    var title = elem("div", "won-t");
    title.textContent = p.title;
    var detail = elem("div", "won-d");
    detail.textContent = p.detail;
    body.appendChild(title);
    body.appendChild(detail);
    card.appendChild(body);

    if (p.delta) {
      var badge = elem("div");
      badge.setAttribute("data-won-toast-delta", "");
      badge.style.color = p.accent;
      badge.textContent = p.delta;
      card.appendChild(badge);
    }

    if (grp.type === "removed" && grp.count === 1) {
      var undo = elem("button");
      undo.type = "button";
      undo.setAttribute("data-won-toast-undo", "");
      undo.style.color = accentFor("info");
      undo.textContent = "Undo";
      undo.addEventListener("click", function (e) {
        e.stopPropagation();
        undo.disabled = true;
        window
          .fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: ev.line.id,
              quantity: Math.abs(grp.totalDelta),
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

    finalizeCard(card);
  }

  // Milestone toast (free shipping / gift) — a reward message with no line body.
  function renderMilestoneToast(type, text) {
    if (!region) return;
    var card = elem("div");
    card.setAttribute("data-won-toast", "");
    card.setAttribute("data-type", type);
    card.setAttribute("data-milestone", "");
    card.setAttribute("data-group-count", "1");
    card.style.borderLeft = "4px solid " + accentFor(type);
    var body = elem("div", "won-b");
    var title = elem("div", "won-t");
    title.textContent = text;
    body.appendChild(title);
    card.appendChild(body);
    finalizeCard(card);
  }

  // Shared: close button, click action, placement, overflow, auto-dismiss.
  function finalizeCard(card) {
    if (branding) {
      var mark = elem("span");
      mark.setAttribute("data-won-branding", "");
      mark.textContent = "Won";
      mark.style.cssText =
        "flex:0 0 auto;font-size:9px;letter-spacing:.08em;text-transform:uppercase;" +
        "opacity:.4;align-self:flex-start;";
      card.appendChild(mark);
    }
    if (cfg.global.closeable) {
      var close = elem("button");
      close.type = "button";
      close.setAttribute("data-won-toast-close", "");
      close.setAttribute("aria-label", "Dismiss");
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

    if (cfg.global.stackDirection === "newest-top") {
      region.insertBefore(card, region.firstChild);
    } else {
      region.appendChild(card);
    }
    enforceMaxVisible();

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
    if (!card) return;
    clearTimeout(card.__wonTimer);
    if (card.parentNode) card.parentNode.removeChild(card);
  }
  function enforceMaxVisible() {
    if (!region) return;
    var max = cfg.global.maxVisible || 3;
    var dropped = 0;
    while (region.querySelectorAll("[data-won-toast]").length > max) {
      var list = region.querySelectorAll("[data-won-toast]");
      dismiss(
        cfg.global.stackDirection === "newest-top"
          ? list[list.length - 1]
          : list[0],
      );
      dropped += 1;
    }
    if (cfg.global.overflowStrategy === "collapse" && dropped > 0) {
      bumpOverflow(dropped);
    }
  }

  function bumpOverflow(n) {
    var chip = region.querySelector("[data-won-toast-overflow]");
    if (!chip) {
      chip = elem("div");
      chip.setAttribute("data-won-toast-overflow", "");
      chip.__n = 0;
      chip.style.cssText =
        "pointer-events:auto;align-self:flex-end;font:12px system-ui;" +
        "background:#111;color:#fff;border-radius:999px;padding:2px 10px;opacity:.85;";
      region.appendChild(chip);
    }
    chip.__n += n;
    chip.textContent = "+" + chip.__n + " more";
    clearTimeout(chip.__t);
    chip.__t = setTimeout(function () {
      if (chip.parentNode) chip.parentNode.removeChild(chip);
    }, cfg.global.durationMs);
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
          if (cfg.enabled && active) {
            var g = cfg.global.grouping;
            var groups = groupEvents(deriveEvents(lastCart, after), g);
            var now = Date.now();
            emitTimes = emitTimes.filter(function (t) {
              return t >= now - 60000;
            });
            groups.forEach(function (grp) {
              if (g.mode !== "off" && isDuplicate(grp.key, now, g.dedupeWindowMs))
                return;
              if (!withinRateLimit(now, g.rateLimitPerMin)) return;
              emitTimes.push(now);
              lastSeen[grp.key] = now;
              renderToast(grp);
            });
            evaluateMilestones(after);
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
      if (isMutator(url)) p.then(function () {
        reconcile();
      }).catch(function () {});
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
      if (isMutator(self.__wonUrl))
        self.addEventListener("loadend", function () {
          reconcile();
        });
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
            var style = document.createElement("style");
            style.textContent = SHADOW_CSS;
            root.appendChild(style);
            var r = document.createElement("div");
            r.setAttribute("data-won-toasts-region", "");
            r.setAttribute("role", "status");
            r.setAttribute("aria-live", "polite");
            r.setAttribute("aria-atomic", "false");
            r.__wonStyle = style;
            root.appendChild(r);
            this.__region = r;
          }
        },
      );
    }
    var existing = document.querySelector(HOST_TAG + "[data-won-toasts-host]");
    if (existing) host = existing;
    else {
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
    applyTheme();
    wrapFetch();
    wrapXHR();
    document.addEventListener("cart:updated", function () {
      reconcile();
    });

    locale = normLocale(embed.getAttribute("data-won-toasts-locale"));
    var endpoint = embed.getAttribute("data-won-toasts-endpoint");
    var ready = function () {
      applyTheme();
      window
        .fetch("/cart.js", { headers: { Accept: "application/json" } })
        .then(function (r) {
          return r.json();
        })
        .then(function (c) {
          lastCart = c;
          lastMilestone = cartMilestone(c);
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
          active = matchesTargeting(cfg.targeting);
          branding = cfg.plan !== "pro";
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
