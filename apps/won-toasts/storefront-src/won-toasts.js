/*
 * Won Toasts — storefront runtime. Pure notification surface: diffs /cart.js,
 * renders page-view recipes (countdown/stock/announcement/aggregates/social) and
 * cart toasts in a Shadow-DOM host. NEVER rewrites prices or auto-adds products;
 * the only cart write is user-initiated Undo. All behaviour/look comes from the
 * admin config at /apps/won-toasts/config; logic mirrors @won/core (spec-tested).
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
      // Must mirror @won/core DEFAULT_GROUPING. reconcile() reads
      // cfg.global.grouping unconditionally, so a fallback without it would
      // throw and silently kill every toast if the config endpoint ever fails.
      grouping: {
        mode: "by-product",
        mergeDeltas: true,
        dedupeWindowMs: 1000,
        rateLimitPerMin: 30,
      },
      // Must mirror @won/core DEFAULT_FREQUENCY (MVP8). governanceOK/quietOn
      // read cfg.global.frequency; a fallback without it would break governance
      // if the config endpoint ever fails.
      frequency: {
        maxPerSession: 0,
        cooldownMs: 0,
        suppressAfterDismissMs: 0,
        quietMode: false,
      },
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
      gradient: false,
      gradientColor: "#f2f4f7",
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
      iconSet: "line",
      fontMode: "system",
      fontFamily: "",
    },
    // MVP9 page-view recipes (mirror @won/core DEFAULT_NOTIFICATIONS = []).
    notifications: [],
    // MVP10 exclusions (mirror @won/core DEFAULT_EXCLUSIONS).
    exclusions: { pages: [], urls: [] },
    // Per cart-event on/off (absent = on). Mirror @won/core DEFAULT cartEvents = {}.
    cartEvents: {},
    // Per-type look/behaviour overrides (mirror @won/core DEFAULT byType = {}).
    byType: {},
  };

  var cfg = FALLBACK;
  var locale = "en";
  // MVP13c: which experiment arm this shopper is in (0 control, 1 variant).
  // Stamped on every analytics atom so cohorts can be compared.
  var wonAbVariant = 0;
  var defaultLocale = "en"; // merchant's fallback language (from cfg.locales)
  var active = true; // targeting: whether toasts run on this page

  // Persistent per-UNIQUE-VISITOR storage: prefer localStorage so countdowns and
  // frequency caps persist across sessions (one countdown per visitor, not per
  // tab). Falls back to sessionStorage in private mode, then to a no-op.
  var persist = (function () {
    var s = null;
    try {
      var t = "won-toasts:t";
      localStorage.setItem(t, "1");
      localStorage.removeItem(t);
      s = localStorage;
    } catch (e) {
      try {
        s = sessionStorage;
      } catch (e2) {
        s = null;
      }
    }
    return {
      get: function (k) {
        try {
          return s ? s.getItem(k) : null;
        } catch (e) {
          return null;
        }
      },
      set: function (k, v) {
        try {
          if (s) s.setItem(k, v);
        } catch (e) {
          /* ignore */
        }
      },
      remove: function (k) {
        try {
          if (s) s.removeItem(k);
        } catch (e) {
          /* ignore */
        }
      },
    };
  })();
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

  // ---- exclusions (mirror of @won/core/toasts/url-match + exclusions, MVP10) ----
  function normPath(p) {
    p = String(p || "");
    var q = p.indexOf("?");
    if (q >= 0) p = p.slice(0, q);
    var h = p.indexOf("#");
    if (h >= 0) p = p.slice(0, h);
    if (!p) return "/";
    return p.charAt(0) === "/" ? p : "/" + p;
  }
  function matchUrl(path, pattern) {
    var a = normPath(path);
    var b = normPath(pattern);
    if (b.indexOf("*") < 0) return a === b;
    var re = new RegExp(
      "^" +
        b
          .split("*")
          .map(function (s) {
            return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join(".*") +
        "$",
    );
    return re.test(a);
  }
  function pathExcluded(path, patterns) {
    if (!patterns || !patterns.length) return false;
    for (var i = 0; i < patterns.length; i++) {
      var pat = patterns[i];
      if (typeof pat === "string" && pat.trim() && matchUrl(path, pat.trim()))
        return true;
    }
    return false;
  }
  function metaOptedOut() {
    var m = document.querySelector('meta[name="won-toasts:active"]');
    return !!(m && String(m.getAttribute("content")).toLowerCase() === "false");
  }
  // Whether the whole app is suppressed on this page (pages/urls/meta opt-out).
  function isExcluded() {
    if (metaOptedOut()) return true;
    var ex = cfg.exclusions || {};
    if (ex.pages && ex.pages.indexOf(pageType()) >= 0) return true;
    if (pathExcluded(location.pathname || "/", ex.urls)) return true;
    return false;
  }


  var lastCart = { items: [] };
  var host = null;
  var region = null;

  function normLocale(v) {
    v = String(v || "").toLowerCase().replace(/_/g, "-");
    return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(v) ? v : "";
  }
  function localeLang(v) {
    var n = normLocale(v);
    return n ? n.split("-")[0] : "";
  }
  // Mirror of @won/core resolveLocalizedText: exact -> language -> default ->
  // default-language -> (optional) any -> "". Locale-as-data: keys are open.
  function resolveLocalized(map, allowAny) {
    if (!map || typeof map !== "object") return "";
    function pick(k) {
      var val = map[k];
      return typeof val === "string" && val.replace(/\s/g, "") ? val : "";
    }
    var want = normLocale(locale);
    if (want && pick(want)) return map[want];
    var lang = localeLang(locale);
    if (lang) {
      if (pick(lang)) return map[lang];
      for (var k in map) if (localeLang(k) === lang && pick(k)) return map[k];
    }
    var def = normLocale(defaultLocale) || "en";
    if (pick(def)) return map[def];
    var dl = localeLang(def);
    if (dl && pick(dl)) return map[dl];
    if (allowAny !== false) for (var k2 in map) if (pick(k2)) return map[k2];
    return "";
  }
  function messageFor(type, fallback) {
    var m = cfg.messages && cfg.messages[type];
    return resolveLocalized(m, true) || fallback;
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
    // Per-event on/off: a merchant can silence e.g. "removed" toasts. Absent = on.
    return ev.filter(function (e) {
      return !cfg.cartEvents || cfg.cartEvents[e.type] !== false;
    });
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
    var cartTheme = resolveThemeFor("cart");
    var showDelta =
      cartTheme.showDelta && grp.type !== "removed" && grp.totalDelta !== 0;
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
      image: cartTheme.showImage ? ev.line.image : null,
      showIcon: cartTheme.showIcon,
      iconSet: cartTheme.iconSet,
      iconEmojis: cartTheme.iconEmojis,
      semantic: semantic,
    };
  }

  // Emoji per cart semantic (mirror of @won/core/toasts/branding ICON_EMOJI, cart
  // subset). Milestone toasts render separately, so only cart events need glyphs;
  // anything else falls back to info.
  var ICON_EMOJI = {
    added: "🛒", removed: "🗑️", increased: "➕", decreased: "➖", info: "🔔",
  };
  function iconFor(p) {
    if (!p.showIcon || p.iconSet === "none") return null;
    if (p.iconSet === "emoji") {
      var g = (p.iconEmojis && p.iconEmojis[p.semantic]) || ICON_EMOJI[p.semantic] || ICON_EMOJI.info;
      var span = elem("span");
      span.setAttribute("data-won-toast-icon", "");
      span.setAttribute("data-emoji", "");
      span.setAttribute("aria-hidden", "true");
      span.textContent = g;
      return span;
    }
    var chip = elem("div");
    chip.setAttribute("data-won-toast-icon", "");
    chip.setAttribute("aria-hidden", "true");
    chip.style.background = p.accent;
    return chip;
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

  // ---- rate-limit (mirror of @won/core/toasts/rate-limit) ----
  var emitTimes = [];
  // Visible cart toasts by group key: a burst spanning reconciles merges its net
  // delta into the one toast (cumulative "+N") instead of dropping duplicates.
  var liveCartToasts = {};
  function withinRateLimit(now, perMin) {
    if (!(perMin > 0)) return true;
    var start = now - 60000;
    var n = 0;
    emitTimes.forEach(function (t) {
      if (t >= start) n++;
    });
    return n < perMin;
  }

  // ---- frequency governance (mirror of @won/core/toasts/governance) ----
  // The GATE for page-view types (MVP8): per-session caps, cooldown, suppress-
  // after-dismiss and a global quiet mode. State persists per cart token in
  // sessionStorage so caps survive navigation. Cart-change toasts are NOT
  // governed (only quiet mode mutes them); page-view types (MVP9+) call
  // governanceOK/govRecordEmit before rendering.
  function govKey(token) {
    return "won-toasts:gov:" + (token || "cart");
  }
  function loadGov(token) {
    try {
      return JSON.parse(persist.get(govKey(token)) || "{}") || {};
    } catch (e) {
      return {}; // private mode: fail open (no persistence)
    }
  }
  function saveGov(token, s) {
    try {
      persist.set(govKey(token), JSON.stringify(s));
    } catch (e) {
      /* private mode: fail open */
    }
  }
  function quietOn() {
    var f = cfg.global && cfg.global.frequency;
    return !!(f && f.quietMode);
  }
  function freqNum(rule, field) {
    var f = cfg.global.frequency || {};
    return rule && rule[field] != null ? rule[field] : f[field] || 0;
  }
  // Why a rule is blocked right now (or null if it may render). Reasons mirror
  // @won/core/toasts/insights SUPPRESS_REASONS so the analytics `suppressed` atom
  // records WHY a wanted toast never showed.
  function govBlockReason(token, rule, groupKey, now) {
    if (quietOn()) return "quiet";
    var s = loadGov(token);
    var maxPer = freqNum(rule, "maxPerSession");
    if (maxPer > 0 && ((s.counts && s.counts[rule.key]) || 0) >= maxPer)
      return "cap";
    var cd = freqNum(rule, "cooldownMs");
    if (cd > 0 && s.last && now - (s.last[rule.key] || -Infinity) < cd)
      return "cooldown";
    var sup = freqNum(rule, "suppressAfterDismissMs");
    if (sup > 0 && s.dismissed && now - (s.dismissed[groupKey] || -Infinity) < sup)
      return "cooldown";
    return null;
  }
  // Gate + instrument: emits a `suppressed` atom (with reason) when blocked.
  function govGate(token, rule, groupKey, now, ruleId) {
    var reason = govBlockReason(token, rule, groupKey, now);
    if (reason) {
      emitAtom("suppressed", ruleId, baseDims(typeKeyFor(ruleId)), {
        suppressReason: reason,
      });
      return false;
    }
    return true;
  }
  function govRecordEmit(token, rule, now) {
    var s = loadGov(token);
    s.counts = s.counts || {};
    s.last = s.last || {};
    s.counts[rule.key] = (s.counts[rule.key] || 0) + 1;
    s.last[rule.key] = now;
    saveGov(token, s);
  }
  function govRecordDismiss(token, groupKey, now) {
    var s = loadGov(token);
    s.dismissed = s.dismissed || {};
    s.dismissed[groupKey] = now;
    saveGov(token, s);
  }
  // ---- a11y + collision + RTL (MVP14, mirror @won/core a11y/format/layout) ----
  var ASSERTIVE = { stock: 1, "stock.low": 1 };
  function ariaRole(t) {
    return ASSERTIVE[t] ? "alert" : "status";
  }
  function srText(a, b) {
    return [a, b]
      .map(function (s) {
        return String(s || "").trim();
      })
      .filter(Boolean)
      .join(". ");
  }
  var RTL = { ar: 1, he: 1, fa: 1, ur: 1, ps: 1, syr: 1, dv: 1 };
  function isRTL(l) {
    return !!RTL[String(l || "").toLowerCase().split(/[-_]/)[0]];
  }
  // Clear the tallest fixed/sticky obstacle (header, cookie bar, chat) on `edge`.
  function collisionOffset(base, edge) {
    var tallest = 0;
    try {
      var els = document.querySelectorAll(
        '[class*="cookie" i],[id*="cookie" i],[class*="chat" i],[id*="chat" i],' +
          "header,[data-sticky]",
      );
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var cs = window.getComputedStyle(el);
        if (cs.position !== "fixed" && cs.position !== "sticky") continue;
        var r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 20 || r.height > 240) continue;
        var onEdge =
          edge === "top" ? r.top <= 4 : window.innerHeight - r.bottom <= 4;
        if (onEdge && r.height > tallest) tallest = r.height;
      }
    } catch (e) {
      /* no-op */
    }
    return tallest > 0 ? Math.max(base, tallest + 8) : base;
  }
  function dismissAll() {
    if (!region) return;
    var list = region.querySelectorAll("[data-won-toast]:not([data-won-persistent])");
    for (var i = 0; i < list.length; i++) dismiss(list[i]);
  }

  // ---- analytics: batched lifecycle atoms (MVP13a) ----
  // Pro-only (matches server gating); silent for Free. Rich atoms
  // (shown/visible/read_through/hover/click/dismiss/auto_fade/suppressed) carry
  // NON-PII dimensions only, are batched, and flushed via sendBeacon on
  // page-hide/visibility/~5s — instrumentation never blocks the shopper and never
  // costs a request per event (perf budget). The server re-scrubs every event.
  var _atomQ = [];
  var _atomTimer = 0;
  function analyticsOn() {
    return !!(cfg && cfg.plan === "pro");
  }
  function deviceType() {
    var w = window.innerWidth || 1024;
    return w < 600 ? "mobile" : w < 1024 ? "tablet" : "desktop";
  }
  function baseDims(typeKey, extra) {
    var d = new Date();
    var dims = {
      type: typeKey || "cart",
      pageType: pageType(),
      device: deviceType(),
      locale: locale,
      hourOfDay: d.getHours(),
      dayOfWeek: d.getDay(),
      abVariant: wonAbVariant,
    };
    try {
      if (window.Shopify && Shopify.currency && Shopify.currency.active)
        dims.currency = Shopify.currency.active;
    } catch (e) {
      /* no-op */
    }
    if (cfg && cfg.lookPreset) dims.lookPreset = cfg.lookPreset;
    if (extra)
      for (var k in extra) if (extra[k] != null && extra[k] !== "") dims[k] = extra[k];
    return dims;
  }
  function flushAtoms() {
    if (_atomTimer) {
      clearTimeout(_atomTimer);
      _atomTimer = 0;
    }
    if (!_atomQ.length) return;
    var batch = _atomQ.splice(0, _atomQ.length);
    var payload = JSON.stringify({ events: batch });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/apps/won-toasts/track",
          new Blob([payload], { type: "application/json" }),
        );
        return;
      }
    } catch (e) {
      /* fall through to fetch */
    }
    try {
      window
        .fetch("/apps/won-toasts/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        })
        .catch(function () {});
    } catch (e) {
      /* no-op */
    }
  }
  function scheduleFlush() {
    if (_atomTimer) return;
    _atomTimer = setTimeout(flushAtoms, 5000);
  }
  function emitAtom(atom, ruleId, dims, extra) {
    if (!analyticsOn()) return;
    var ev = { atom: atom, dims: dims || baseDims(typeKeyFor(ruleId)) };
    if (ruleId) ev.ruleId = ruleId;
    if (extra) for (var k in extra) if (extra[k] != null) ev[k] = extra[k];
    _atomQ.push(ev);
    if (_atomQ.length >= 20) flushAtoms();
    else scheduleFlush();
  }
  // Legacy single-event shim (undo path) → one click atom on the same pipeline.
  function trackEvent(ruleId, type) {
    if (!ruleId) return;
    if (type === "undo")
      emitAtom("click", ruleId, baseDims(typeKeyFor(ruleId)), {
        clickTarget: "cta",
      });
  }
  try {
    window.addEventListener("pagehide", flushAtoms);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flushAtoms();
    });
  } catch (e) {
    /* no-op */
  }
  // MVP13c guardrail telemetry: one `session` atom per session (conversion
  // denominator) and a `js_error` atom whenever OUR script throws (error-rate
  // guardrail). Both feed the live circuit breaker; neither is a per-toast metric.
  function logSession() {
    if (!analyticsOn()) return;
    try {
      if (persist.get("won-toasts:sess-logged")) return;
      persist.set("won-toasts:sess-logged", "1");
    } catch (e) {
      /* private mode: fall through, at worst double-count once */
    }
    emitAtom("session", null, baseDims("app"));
  }
  try {
    window.addEventListener("error", function (ev) {
      // Only OUR errors — match the extension asset filename.
      var src = (ev && ev.filename) || "";
      if (src.indexOf("won-toasts") >= 0 && analyticsOn()) {
        emitAtom("js_error", null, baseDims("app"));
      }
    });
  } catch (e) {
    /* no-op */
  }
  // FNV-1a mirror of @won/core/toasts/experiments for a deterministic A/B split.
  function abHash(token) {
    var h = 0x811c9dc5;
    var s = String(token || "");
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  function abVariant(token, n) {
    if (!(n > 1)) return 0;
    return abHash(token) % n;
  }

  // ---- page-view notifications (MVP9): mirror @won/core/toasts/page-view +
  // notifications + aggregates. These are NOT cart-diff driven — they render on
  // page load for the configured pages, and every emit is governed by MVP8.
  function pvRemaining(now, o) {
    if (typeof o.endsAt === "number") return Math.max(0, o.endsAt - now);
    if (typeof o.evergreenMs === "number" && typeof o.startedAt === "number")
      return Math.max(0, o.startedAt + o.evergreenMs - now);
    return 0;
  }
  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function fmtCountdown(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(total / 86400);
    var h = Math.floor((total % 86400) / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return (d > 0 ? d + ":" : "") + pad2(h) + ":" + pad2(m) + ":" + pad2(s);
  }
  function pvLowStock(inv, thr) {
    return (
      isFinite(inv) && isFinite(thr) && thr > 0 && inv > 0 && inv < thr
    );
  }
  function notifOnPage(rule) {
    var pages = rule.pages || [];
    if (!pages.length || pages.indexOf("all") >= 0) return true;
    return pages.indexOf(pageType()) >= 0;
  }
  // Flatten a rule's optional per-rule frequency for governanceOK/freqNum.
  function govRuleOf(rule) {
    var f = rule.frequency || {};
    return {
      key: rule.id,
      maxPerSession: f.maxPerSession,
      cooldownMs: f.cooldownMs,
      suppressAfterDismissMs: f.suppressAfterDismissMs,
    };
  }
  // Stable per-session governance id: an empty cart's token can regenerate per
  // /cart.js call and reset caps, so anchor to a persistent session id and use
  // the real cart token only once the cart has items.
  function govSessionId() {
    // A stable per-UNIQUE-VISITOR id (localStorage via persist) so countdown +
    // frequency caps are per visitor across sessions, not just per tab.
    var k = "won-toasts:vid";
    var v = persist.get(k);
    if (!v) {
      v = "v" + Date.now().toString(36) + Math.floor(Date.now() % 1000).toString(36);
      persist.set(k, v);
    }
    return v || "visitor";
  }
  function cartToken() {
    if (
      lastCart &&
      lastCart.token &&
      lastCart.items &&
      lastCart.items.length > 0
    ) {
      return lastCart.token;
    }
    return govSessionId();
  }

  // A page-view card: no line body, just a message (+ optional live timer node).
  function notifCard(type, timeEl, text) {
    var card = elem("div");
    card.setAttribute("data-won-toast", "");
    card.setAttribute("data-type", type);
    card.setAttribute("role", ariaRole(type));
    if (text) card.setAttribute("aria-label", srText(text, ""));
    card.style.borderLeft = "4px solid " + accentFor("info");
    var body = elem("div", "won-b");
    var title = elem("div", "won-t");
    if (timeEl) {
      // Split the message on {countdown} so the live node sits inline.
      var parts = String(text || "").split("{countdown}");
      title.appendChild(document.createTextNode(parts[0] || ""));
      title.appendChild(timeEl);
      if (parts.length > 1) title.appendChild(document.createTextNode(parts[1] || ""));
    } else {
      title.textContent = text;
    }
    body.appendChild(title);
    card.appendChild(body);
    return card;
  }

  function isPersistentSurface(surface) {
    return (
      surface === "banner" ||
      surface === "persistent-toast" ||
      surface === "inline"
    );
  }

  function cdStart(rule) {
    // Evergreen countdown start persists per session so it doesn't reset on nav.
    var key = "won-toasts:cd:" + rule.id;
    var v = persist.get(key);
    if (v) return Number(v);
    var now = Date.now();
    persist.set(key, String(now));
    return now;
  }

  function renderCountdown(rule) {
    if (!region) return;
    var opts = rule.endsAt
      ? { endsAt: Date.parse(rule.endsAt) }
      : typeof rule.evergreenMs === "number"
        ? { evergreenMs: rule.evergreenMs, startedAt: cdStart(rule) }
        : null;
    if (!opts || !isFinite(opts.endsAt != null ? opts.endsAt : 0) && rule.endsAt)
      return;
    var now = Date.now();
    if (pvRemaining(now, opts) <= 0) return; // already ended → show nothing
    var token = cartToken();
    var gr = "countdown:" + rule.id;
    if (!govGate(token, govRuleOf(rule), gr, now, rule.id)) return;

    var timeEl = elem("span");
    timeEl.setAttribute("data-won-countdown-time", "");
    var card = notifCard("countdown", timeEl, rule.message || "Ends in {countdown}");
    card.setAttribute("data-won-countdown", "");
    function paint() {
      var r = pvRemaining(Date.now(), opts);
      timeEl.textContent = fmtCountdown(r);
      if (r <= 0) {
        clearInterval(card.__cd);
        dismiss(card);
      }
    }
    paint();
    card.__cd = setInterval(paint, 1000);
    var persistent = isPersistentSurface(rule.surface);
    finalizeCard(card, {
      persistent: persistent,
      ruleId: rule.id,
      onClose: function () {
        clearInterval(card.__cd);
        govRecordDismiss(token, gr, Date.now());
      },
    });
    govRecordEmit(token, govRuleOf(rule), now);
  }

  function currentProductHandle() {
    var m = /\/products\/([^/?#]+)/.exec(location.pathname || "");
    return m ? m[1] : null;
  }
  // Real inventory only: an explicit theme hook wins; product.js is a best-effort
  // fallback (Shopify usually omits inventory there). Unknown → NaN → show nothing.
  function readInventory(cb) {
    var el = document.querySelector("[data-won-stock]");
    if (el) {
      var n = parseInt(el.getAttribute("data-won-stock"), 10);
      if (isFinite(n)) {
        cb(n);
        return;
      }
    }
    var handle = currentProductHandle();
    if (!handle || !window.fetch) {
      cb(NaN);
      return;
    }
    window
      .fetch("/products/" + handle + ".js", { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (p) {
        var inv = NaN;
        if (p && p.variants && p.variants.length) {
          var vid = Number(new URLSearchParams(location.search).get("variant"));
          var sel = vid
            ? p.variants.filter(function (v) {
                return v.id === vid;
              })[0]
            : null;
          if (sel && typeof sel.inventory_quantity === "number") {
            inv = sel.inventory_quantity;
          } else {
            var qs = p.variants
              .map(function (v) {
                return v.inventory_quantity;
              })
              .filter(function (x) {
                return typeof x === "number";
              });
            if (qs.length) inv = Math.min.apply(Math, qs);
          }
        }
        cb(inv);
      })
      .catch(function () {
        cb(NaN);
      });
  }

  function renderStockLow(rule) {
    readInventory(function (inv) {
      if (!pvLowStock(inv, rule.threshold)) return; // honest: only real scarcity
      var now = Date.now();
      var token = cartToken();
      var gr = "stock:" + rule.id;
      if (!govGate(token, govRuleOf(rule), gr, now, rule.id)) return;
      var text = renderTemplate(rule.message || "Only {count} left", {
        count: inv,
      });
      var card = notifCard("stock", null, text);
      var persistent = isPersistentSurface(rule.surface);
      finalizeCard(card, {
        persistent: persistent,
        ruleId: rule.id,
        onClose: function () {
          govRecordDismiss(token, gr, Date.now());
        },
      });
      govRecordEmit(token, govRuleOf(rule), now);
    });
  }

  // ---- aggregates (mirror of @won/core/toasts/aggregates, MVP11) ----
  function countWithinWindow(events, now, windowMs) {
    if (!events || !events.length || !(windowMs > 0)) return 0;
    var start = now - windowMs;
    var n = 0;
    for (var i = 0; i < events.length; i++) {
      var t = events[i];
      if (typeof t === "number" && t >= start && t <= now) n++;
    }
    return n;
  }
  function formatAggregateCount(template, count) {
    if (!(count > 0)) return ""; // honest: never "0 people"
    return String(template || "").replace(/\{count\}/g, String(count));
  }

  // ---- social proof (mirror of @won/core/toasts/social-proof, MVP12) ----
  function relTime(at) {
    var diff = Date.now() - at;
    if (!(diff > 0)) diff = 0;
    var min = Math.floor(diff / 60000);
    if (min < 1) return locale === "cs" ? "právě teď" : locale === "sk" ? "práve teraz" : "just now";
    if (min < 60) return min + " min";
    return Math.floor(min / 60) + " h";
  }
  function formatSale(tpl, sale) {
    var t = String(tpl || "");
    var name = (sale.firstName || "").trim();
    var city = (sale.city || "").trim();
    var product = (sale.product || "").trim();
    if (!city) t = t.replace(/\s*from\s+\{city\}/gi, "");
    return t
      .replace(/\{name\}/g, name || "Someone")
      .replace(/\{city\}/g, city)
      .replace(/\{product\}/g, product || "an item")
      .replace(/\{time\}/g, relTime(sale.at))
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  function renderSocialProof(rule) {
    window
      .fetch("/apps/won-toasts/social", { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var sales = (data && data.sales) || [];
        if (!sales.length) return; // cold-start honest: nothing to show
        var i = 0;
        var token = cartToken();
        var timer = null;
        function pop() {
          if (i >= sales.length) {
            if (timer) clearInterval(timer);
            return;
          }
          var sale = sales[i++];
          var now = Date.now();
          var gr = "sale:" + rule.id;
          if (!govGate(token, govRuleOf(rule), gr, now, rule.id)) return;
          var text = formatSale(
            rule.message || "{name} from {city} bought {product}",
            sale,
          );
          if (!text) return;
          var card = notifCard("sale", null, text);
          finalizeCard(card, {
            persistent: false,
            ruleId: rule.id,
            onClose: function () {
              govRecordDismiss(token, gr, Date.now());
            },
          });
          govRecordEmit(token, govRuleOf(rule), now);
        }
        pop();
        timer = setInterval(pop, Math.max(4000, (cfg.global.durationMs || 3500) + 1500));
      })
      .catch(function () {});
  }

  function renderAnnouncement(rule) {
    var token = cartToken();
    // MVP13 A/B: when variants exist, split deterministically by cart token so a
    // shopper always sees the same one; else fall back to the i18n/base message.
    var variant = 0;
    var text;
    if (rule.variants && rule.variants.length) {
      variant = abVariant(token, rule.variants.length);
      text = rule.variants[variant];
    } else {
      text = resolveLocalized(rule.messages, false) || rule.message || "";
    }
    if (!text) return;
    var now = Date.now();
    var gr = "announcement:" + rule.id;
    if (!govGate(token, govRuleOf(rule), gr, now, rule.id)) return;
    var card = notifCard("announcement", null, renderTemplate(text, {}));
    finalizeCard(card, {
      persistent: isPersistentSurface(rule.surface),
      ruleId: rule.id,
      variant: variant,
      onClose: function () {
        govRecordDismiss(token, gr, Date.now());
      },
    });
    govRecordEmit(token, govRuleOf(rule), now);
  }

  function renderAggregates(rules) {
    var maxHours = 1;
    rules.forEach(function (r) {
      maxHours = Math.max(maxHours, r.windowHours || 24);
    });
    window
      .fetch("/apps/won-toasts/aggregates?window=" + maxHours, {
        headers: { Accept: "application/json" },
      })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var carts = (data && data.cartAdds) || [];
        var orders = (data && data.orders) || [];
        var now = Date.now();
        rules.forEach(function (rule) {
          var evs = rule.type === "order.summary" ? orders : carts;
          var count = countWithinWindow(
            evs,
            now,
            (rule.windowHours || 24) * 3_600_000,
          );
          var text = formatAggregateCount(rule.message || "{count}", count);
          if (!text) return; // honest: 0 → render nothing
          var token = cartToken();
          var gr = rule.type + ":" + rule.id;
          if (!govGate(token, govRuleOf(rule), gr, now, rule.id)) return;
          var dtype =
            rule.type === "order.summary" ? "order-summary" : "cart-activity";
          var card = notifCard(dtype, null, text);
          // Aggregates are visually distinct from single events (spec).
          card.setAttribute("data-won-aggregate", "1");
          finalizeCard(card, {
            persistent: isPersistentSurface(rule.surface),
            ruleId: rule.id,
            onClose: function () {
              govRecordDismiss(token, gr, Date.now());
            },
          });
          govRecordEmit(token, govRuleOf(rule), now);
        });
      })
      .catch(function () {});
  }

  function renderNotifications() {
    if (!region || quietOn()) return;
    var list = cfg.notifications || [];
    var aggRules = [];
    list.forEach(function (rule) {
      if (!rule || !rule.enabled || !notifOnPage(rule)) return;
      if (rule.type === "countdown") renderCountdown(rule);
      else if (rule.type === "stock.low") renderStockLow(rule);
      else if (rule.type === "announcement") renderAnnouncement(rule);
      else if (rule.type === "order.created") renderSocialProof(rule);
      else if (rule.type === "cart.activity" || rule.type === "order.summary")
        aggRules.push(rule);
    });
    if (aggRules.length) renderAggregates(aggRules);
  }

  // True when a real cart-add should be beaconed to the aggregate counter.
  function cartActivityEnabled() {
    return (cfg.notifications || []).some(function (n) {
      return n && n.enabled && n.type === "cart.activity";
    });
  }
  function beaconCartAdd() {
    try {
      window
        .fetch("/apps/won-toasts/aggregates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          keepalive: true,
        })
        .catch(function () {});
    } catch (e) {
      /* no-op */
    }
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
  // Mirror of @won/core resolveMilestoneThresholdCents: a cart subtotal is in
  // its presentment currency (Markets), so pick the per-currency threshold when
  // the merchant set one, else fall back to the base thresholdCents.
  function resolveThr(rule, cur) {
    var map = rule.thresholds;
    if (map && cur) {
      var per = map[String(cur).toUpperCase()];
      if (typeof per === "number" && isFinite(per)) return per;
    }
    return rule.thresholdCents;
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
        state = mState(
          prev.subtotalCents,
          next.subtotalCents,
          resolveThr(rule, after.currency),
        );
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
    var baseBg = t.mode === "custom" ? t.colorBg : isDark ? "#1a1f24" : "#ffffff";
    var bg = t.gradient
      ? "linear-gradient(135deg," + baseBg + "," + t.gradientColor + ")"
      : baseBg;
    var text =
      t.mode === "custom" ? t.colorText : isDark ? "#eef1f4" : "#1a1f24";
    // Font: inherit the shop theme, a clean system stack, or the merchant's own.
    var font =
      t.fontMode === "inherit-theme"
        ? "inherit"
        : t.fontMode === "custom" && (t.fontFamily || "").trim()
          ? t.fontFamily
          : 'system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
    return {
      "--won-bg": bg,
      "--won-text": text,
      "--won-font": font,
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
    "font-size:14px;line-height:1.35;font-family:var(--won-font);" +
    "animation:won-in var(--won-anim-ms) ease both;}" +
    "[data-won-toast] img{width:40px;height:40px;border-radius:8px;object-fit:cover;flex:0 0 auto;}" +
    "[data-won-toast] .won-b{flex:1 1 auto;min-width:0;}" +
    "[data-won-toast] .won-t{font-weight:700;}" +
    "[data-won-toast] .won-d{color:#8892a0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
    "[data-won-toast-icon]{width:18px;height:18px;border-radius:5px;opacity:.9;flex:0 0 auto;}" +
    "[data-won-toast-icon][data-emoji]{width:auto;height:auto;background:none!important;border-radius:0;opacity:1;font-size:16px;line-height:1;}" +
    "[data-won-toast-delta]{font-weight:800;flex:0 0 auto;}" +
    "[data-won-toast] button{border:0;background:transparent;font:inherit;cursor:pointer;flex:0 0 auto;}" +
    "[data-won-toast-undo]{font-weight:700;text-decoration:underline;}" +
    "[data-won-toast-close]{font-size:18px;line-height:1;color:#9aa4ad;padding:0 2px;}" +
    "@keyframes won-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}" +
    '[data-anim="fade"] [data-won-toast]{animation-name:won-fade}' +
    '[data-anim="pop"] [data-won-toast]{animation-name:won-pop}' +
    '[data-anim="slide-scale"] [data-won-toast]{animation-name:won-ss}' +
    // Per-card animation (per-type) — wins over the region default (comes later).
    '[data-won-toast][data-anim="slide"]{animation-name:won-in}' +
    '[data-won-toast][data-anim="fade"]{animation-name:won-fade}' +
    '[data-won-toast][data-anim="pop"]{animation-name:won-pop}' +
    '[data-won-toast][data-anim="slide-scale"]{animation-name:won-ss}' +
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
      // MVP14: nudge past a sticky header / cookie bar / chat on the same edge.
      s[vert] = collisionOffset(g.offsetTop, vert) + "px";
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

  function fmtDelta(n) {
    return (n > 0 ? "+" : "") + n;
  }
  // Fold a burst increment into an already-visible toast for the same group
  // (cumulative delta + count, refreshed badge, reset timer). True = merged.
  function toastDir(type) {
    return type === "removed" || type === "decreased" ? -1 : 1;
  }
  function mergeIntoLiveToast(grp) {
    var entry = liveCartToasts[grp.key];
    // Merge same key + same direction: a burst folds "added"(0→N)+"increased"
    // (N→N+1) into one cumulative toast; a flip (removed→added) stays separate.
    if (
      !entry ||
      !entry.card ||
      !entry.card.parentNode ||
      toastDir(entry.type) !== toastDir(grp.type)
    ) {
      return false;
    }
    entry.total += grp.totalDelta;
    entry.count += grp.count;
    entry.card.setAttribute("data-group-count", String(entry.count));
    var show =
      resolveThemeFor("cart").showDelta && entry.type !== "removed" && entry.total !== 0;
    if (show) {
      if (!entry.badge) {
        entry.badge = elem("div");
        entry.badge.setAttribute("data-won-toast-delta", "");
        entry.badge.style.color = entry.accent;
        entry.card.appendChild(entry.badge);
      }
      entry.badge.textContent = fmtDelta(entry.total);
    }
    if (resolveBehaviorFor("cart").autoDismiss) scheduleDismiss(entry.card);
    return true;
  }

  function renderToast(grp) {
    if (!region) return;
    var ev = grp.rep;
    var p = presentation(grp);
    var card = elem("div");
    card.setAttribute("data-won-toast", "");
    card.setAttribute("data-type", grp.type);
    card.setAttribute("data-group-count", String(grp.count));
    card.setAttribute("role", ariaRole(grp.type));
    card.setAttribute("aria-label", srText(p.title, p.detail));
    card.style.borderLeft = "4px solid " + p.accent;
    card.__wonKey = grp.key;

    if (p.image) {
      var img = elem("img");
      img.src = p.image;
      img.alt = "";
      card.appendChild(img);
    }

    // Icon — accent chip or emoji glyph per iconSet (parity with the preview).
    var iconEl = iconFor(p);
    if (iconEl) card.appendChild(iconEl);

    var body = elem("div", "won-b");
    var title = elem("div", "won-t");
    title.textContent = p.title;
    var detail = elem("div", "won-d");
    detail.textContent = p.detail;
    body.appendChild(title);
    body.appendChild(detail);
    card.appendChild(body);

    var badge = null;
    if (p.delta) {
      badge = elem("div");
      badge.setAttribute("data-won-toast-delta", "");
      badge.style.color = p.accent;
      badge.textContent = p.delta;
      card.appendChild(badge);
    }
    // Track this toast so later burst increments merge into it.
    liveCartToasts[grp.key] = {
      card: card,
      badge: badge,
      total: grp.totalDelta,
      count: grp.count,
      type: grp.type,
      accent: p.accent,
    };

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
            trackEvent("cart:removed", "undo");
            reconcile();
            dismiss(card);
          })
          .catch(function () {
            undo.disabled = false;
          });
      });
      card.appendChild(undo);
    }

    finalizeCard(card, { ruleId: "cart:" + grp.type });
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
    finalizeCard(card, { ruleId: "milestone:" + type });
  }

  // Shared: close button, click action, placement, overflow, auto-dismiss.
  // opts.persistent → no auto-dismiss and exempt from maxVisible eviction
  // (page-view fixtures like a countdown). opts.onClose → called on user dismiss
  // (used by governance suppress-after-dismiss).
  // ---- per-type look/behaviour resolution (mirror @won/core/toasts/type-style) ----
  // A toast's type: cart deltas + milestones share "cart"; a notification rule's
  // id IS its type (countdown/announcement/stock.low/cart.activity/order.*).
  function typeKeyFor(ruleId) {
    if (!ruleId) return "cart";
    if (ruleId.indexOf("cart:") === 0 || ruleId.indexOf("milestone:") === 0)
      return "cart";
    return ruleId;
  }
  function overrideFor(key) {
    return (cfg.byType && cfg.byType[key]) || null;
  }
  function resolveThemeFor(key) {
    var ov = overrideFor(key);
    if (!ov || !ov.theme) return cfg.theme;
    var merged = {};
    for (var k in cfg.theme) merged[k] = cfg.theme[k];
    for (var k2 in ov.theme) {
      if (k2 === "accent") continue;
      merged[k2] = ov.theme[k2];
    }
    if (ov.theme.accent) {
      var acc = {};
      for (var a in cfg.theme.accent) acc[a] = cfg.theme.accent[a];
      for (var a2 in ov.theme.accent) acc[a2] = ov.theme.accent[a2];
      merged.accent = acc;
    }
    return merged;
  }
  function resolveBehaviorFor(key) {
    var g = cfg.global;
    var b = (overrideFor(key) && overrideFor(key).behavior) || {};
    return {
      durationMs: typeof b.durationMs === "number" ? b.durationMs : g.durationMs,
      clickAction: b.clickAction || g.clickAction,
      autoDismiss: typeof b.autoDismiss === "boolean" ? b.autoDismiss : g.autoDismiss,
      pauseOnHover:
        typeof b.pauseOnHover === "boolean" ? b.pauseOnHover : g.pauseOnHover,
      closeable: typeof b.closeable === "boolean" ? b.closeable : g.closeable,
    };
  }

  function finalizeCard(card, opts) {
    opts = opts || {};
    if (opts.persistent) card.setAttribute("data-won-persistent", "");
    // Resolve this toast's type → its look + behaviour (default+override).
    var typeKey = opts.typeKey || typeKeyFor(opts.ruleId);
    var beh = resolveBehaviorFor(typeKey);
    var th = resolveThemeFor(typeKey);
    card.__wonDur = beh.durationMs;
    // MVP13a: per-card analytics context (non-PII dims + shown timestamp for dwell).
    card.__wonRuleId = opts.ruleId || null;
    // abVariant is the experiment arm (stamped globally by baseDims), not a
    // per-toast value — so all atoms in a session share the shopper's arm.
    card.__wonDims = baseDims(typeKey, {
      semantic: opts.semantic,
      surface: opts.surface,
    });
    card.__wonShownAt = Date.now();
    // A per-type hook + the type's entry animation (per-card, so each type can
    // animate differently; also lets custom CSS target one type).
    card.setAttribute("data-won-type", typeKey);
    card.setAttribute("data-anim", th.animationIn || "slide");
    // Per-type look: set the toast's CSS-var tokens on the card, overriding the
    // region defaults for just this card (colours/shape/shadow/density/width/
    // border/blur). Only when the type overrides — otherwise it inherits.
    if (overrideFor(typeKey) && overrideFor(typeKey).theme) {
      var tk = styleTokens(th);
      for (var v in tk) card.style.setProperty(v, tk[v]);
    }
    if (beh.closeable || opts.persistent) {
      var close = elem("button");
      close.type = "button";
      close.setAttribute("data-won-toast-close", "");
      close.setAttribute("aria-label", "Dismiss");
      close.textContent = "×";
      close.addEventListener("click", function (e) {
        e.stopPropagation();
        card.__wonManual = 1; // mark so the timer path doesn't also log auto_fade
        emitAtom("dismiss", card.__wonRuleId, card.__wonDims, {
          dwellMs: Date.now() - (card.__wonShownAt || Date.now()),
        });
        dismiss(card);
        if (typeof opts.onClose === "function") opts.onClose();
      });
      card.appendChild(close);
    }

    if (beh.clickAction === "open-cart" && !opts.persistent) {
      card.style.cursor = "pointer";
      card.addEventListener("click", function () {
        emitAtom("click", card.__wonRuleId, card.__wonDims, { clickTarget: "body" });
        flushAtoms(); // navigation imminent — don't lose the click
        window.location.href = "/cart";
      });
    }

    if (cfg.global.stackDirection === "newest-top") {
      region.insertBefore(card, region.firstChild);
    } else {
      region.appendChild(card);
    }
    // MVP13a: lifecycle atoms — `shown` now; `visible` when it truly enters the
    // viewport (IntersectionObserver); `hover` on first pointer pause.
    emitAtom("shown", card.__wonRuleId, card.__wonDims);
    if (analyticsOn()) {
      try {
        if (window.IntersectionObserver) {
          var io = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
              if (entries[i].isIntersecting) {
                emitAtom("visible", card.__wonRuleId, card.__wonDims);
                io.disconnect();
                break;
              }
            }
          });
          io.observe(card);
        } else {
          emitAtom("visible", card.__wonRuleId, card.__wonDims);
        }
      } catch (e) {
        /* no-op */
      }
      card.addEventListener(
        "mouseenter",
        function () {
          emitAtom("hover", card.__wonRuleId, card.__wonDims);
        },
        { once: true },
      );
    }
    enforceMaxVisible();

    if (beh.autoDismiss && !opts.persistent) {
      scheduleDismiss(card);
      if (beh.pauseOnHover) {
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
      // Survived its full duration without a manual dismiss → it was read.
      if (!card.__wonManual) {
        emitAtom("read_through", card.__wonRuleId, card.__wonDims);
        emitAtom("auto_fade", card.__wonRuleId, card.__wonDims, {
          dwellMs: Date.now() - (card.__wonShownAt || Date.now()),
        });
      }
      dismiss(card);
    }, card.__wonDur || cfg.global.durationMs);
  }
  function dismiss(card) {
    if (!card) return;
    clearTimeout(card.__wonTimer);
    var e = card.__wonKey && liveCartToasts[card.__wonKey];
    if (e && e.card === card) delete liveCartToasts[card.__wonKey];
    if (card.parentNode) card.parentNode.removeChild(card);
  }
  function enforceMaxVisible() {
    if (!region) return;
    var max = cfg.global.maxVisible || 3;
    var dropped = 0;
    // Persistent page-view fixtures (countdown, inline stock) are exempt — only
    // transient cart toasts compete for the maxVisible budget.
    var sel = "[data-won-toast]:not([data-won-persistent])";
    while (region.querySelectorAll(sel).length > max) {
      var list = region.querySelectorAll(sel);
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
          // Quiet mode (MVP8) mutes everything without touching other settings.
          if (cfg.enabled && active && !quietOn()) {
            var g = cfg.global.grouping;
            var groups = groupEvents(deriveEvents(lastCart, after), g);
            var now = Date.now();
            // MVP11: a genuine cart-add feeds the real cart.activity counter.
            if (
              cartActivityEnabled() &&
              groups.some(function (gr) {
                return gr.type === "added" || gr.type === "increased";
              })
            ) {
              beaconCartAdd();
            }
            emitTimes = emitTimes.filter(function (t) {
              return t >= now - 60000;
            });
            groups.forEach(function (grp) {
              // Merge a burst into its visible toast (keeps net delta correct).
              if (mergeIntoLiveToast(grp)) return;
              if (!withinRateLimit(now, g.rateLimitPerMin)) return;
              emitTimes.push(now);
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
    // MVP14 a11y: Escape dismisses all transient toasts.
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") dismissAll();
    });

    locale =
      normLocale(embed.getAttribute("data-won-toasts-locale")) ||
      normLocale((document.documentElement && document.documentElement.lang) || "") ||
      "en";
    if (region) region.setAttribute("dir", isRTL(locale) ? "rtl" : "ltr");
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
          // Page-view notifications (MVP9) run once on load, after we know the
          // cart token (governance state) and targeting. Cart-diff toasts stay
          // event-driven via reconcile().
          if (cfg.enabled && active) renderNotifications();
          embed.setAttribute("data-won-toasts-status", "ready");
        });
    };

    // Load config immediately (the script already runs async, after
    // DOMContentLoaded, and does non-blocking fetches — so this doesn't compete
    // with critical render, and a notification surface should be ready promptly).
    if (endpoint && window.fetch) {
      window
        .fetch(endpoint, { headers: { Accept: "application/json" } })
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          if (data && data.config) cfg = data.config;
          var token = cartToken();
          // MVP13c holdout: a running experiment can hold this visitor out (show
          // NO toasts) so revenue impact is provable. Deterministic per cart
          // token — mirror @won/core inHoldout (distinct "holdout:" salt).
          var holdoutPct = (data && data.holdoutPercent) || 0;
          var heldOut =
            holdoutPct > 0 && abHash("holdout:" + token) % 100 < holdoutPct;
          // MVP13c live A/B: exposed visitors split control vs variant by the
          // "arm:" salt (mirror @won/core assignArm). The variant arm renders the
          // experiment's variant config; every analytics atom is tagged with the
          // arm so the experiment engine can compare cohorts.
          var exp = data && data.experiment;
          if (
            !heldOut &&
            exp &&
            exp.variantPercent > 0 &&
            exp.config &&
            abHash("arm:" + token) % 100 < exp.variantPercent
          ) {
            cfg = exp.config;
            wonAbVariant = 1;
          }
          if (cfg.locales && cfg.locales.defaultLocale)
            defaultLocale = normLocale(cfg.locales.defaultLocale) || "en";
          // MVP10 exclusions/meta opt-out fully suppress the app on this page.
          active = matchesTargeting(cfg.targeting) && !isExcluded() && !heldOut;
          // MVP13c: count this session once (guardrail conversion denominator).
          logSession();
        })
        .catch(function () {})
        .then(ready);
    } else {
      ready();
    }
  }

  function boot() {
    // SF-1: never run in the Theme Editor — wrapping fetch and firing cart/
    // page-view toasts inside the editor preview is confusing and can interfere
    // with the editor. The merchant sees toasts on the real storefront instead.
    if (window.Shopify && window.Shopify.designMode) return;
    var embed = document.querySelector(EMBED_SELECTOR);
    if (embed) init(embed);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
