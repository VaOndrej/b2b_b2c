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
    // MVP9 page-view recipes (mirror @won/core DEFAULT_NOTIFICATIONS = []).
    notifications: [],
    // MVP10 exclusions (mirror @won/core DEFAULT_EXCLUSIONS).
    exclusions: { pages: [], urls: [] },
  };

  var cfg = FALLBACK;
  var locale = "en";
  var active = true; // targeting: whether toasts run on this page
  var shopTz = "UTC"; // shop IANA timezone (from the embed block) for scheduling
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

  // ---- scheduling (mirror of @won/core/toasts/scheduling.isScheduledNow) ----
  function shopLocalParts(ms, tz) {
    try {
      var parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz || "UTC",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(new Date(ms));
      var get = function (t) {
        for (var i = 0; i < parts.length; i++)
          if (parts[i].type === t) return parts[i].value;
        return "";
      };
      var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      var hh = parseInt(get("hour"), 10);
      if (!isFinite(hh) || hh === 24) hh = 0;
      var mm = parseInt(get("minute"), 10) || 0;
      return { dow: DOW[get("weekday")] || 0, hour: hh + mm / 60 };
    } catch (e) {
      return { dow: new Date(ms).getDay(), hour: new Date(ms).getHours() };
    }
  }
  function isScheduledNow(sch, now, tz) {
    if (!sch) return true;
    if (sch.startsAt) {
      var st = Date.parse(sch.startsAt);
      if (isFinite(st) && now < st) return false;
    }
    if (sch.endsAt) {
      var en = Date.parse(sch.endsAt);
      if (isFinite(en) && now > en) return false;
    }
    var needsLocal =
      (sch.daysOfWeek && sch.daysOfWeek.length) ||
      (sch.hours && sch.hours.length === 2);
    if (!needsLocal) return true;
    var lp = shopLocalParts(now, tz);
    if (sch.daysOfWeek && sch.daysOfWeek.length && sch.daysOfWeek.indexOf(lp.dow) < 0)
      return false;
    if (sch.hours && sch.hours.length === 2) {
      var from = sch.hours[0];
      var to = sch.hours[1];
      if (from === to) return false;
      if (from < to) {
        if (!(lp.hour >= from && lp.hour < to)) return false;
      } else if (!(lp.hour >= from || lp.hour < to)) return false;
    }
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
      return JSON.parse(sessionStorage.getItem(govKey(token)) || "{}") || {};
    } catch (e) {
      return {}; // private mode: fail open (no persistence)
    }
  }
  function saveGov(token, s) {
    try {
      sessionStorage.setItem(govKey(token), JSON.stringify(s));
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
  function governanceOK(token, rule, groupKey, now) {
    if (quietOn()) return false;
    var s = loadGov(token);
    var maxPer = freqNum(rule, "maxPerSession");
    if (maxPer > 0 && ((s.counts && s.counts[rule.key]) || 0) >= maxPer)
      return false;
    var cd = freqNum(rule, "cooldownMs");
    if (cd > 0 && s.last && now - (s.last[rule.key] || -Infinity) < cd)
      return false;
    var sup = freqNum(rule, "suppressAfterDismissMs");
    if (sup > 0 && s.dismissed && now - (s.dismissed[groupKey] || -Infinity) < sup)
      return false;
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

  // ---- analytics + A/B (MVP13) ----
  // Beacon one toast lifecycle event. Pro-only (matches server gating); silent
  // for Free. No PII — just a rule id, event type, and A/B variant.
  function trackEvent(ruleId, type, variant) {
    if (!ruleId || !cfg || cfg.plan !== "pro") return;
    try {
      window
        .fetch("/apps/won-toasts/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ruleId: ruleId, type: type, variant: variant || 0 }),
          keepalive: true,
        })
        .catch(function () {});
    } catch (e) {
      /* no-op */
    }
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
    try {
      var k = "won-toasts:sid";
      var v = sessionStorage.getItem(k);
      if (!v) {
        v = "s" + Date.now().toString(36);
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return "session"; // private mode: fixed key (still per-tab-session)
    }
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
    try {
      var v = sessionStorage.getItem(key);
      if (v) return Number(v);
      var now = Date.now();
      sessionStorage.setItem(key, String(now));
      return now;
    } catch (e) {
      return Date.now();
    }
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
    if (!governanceOK(token, govRuleOf(rule), gr, now)) return;

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
      if (!governanceOK(token, govRuleOf(rule), gr, now)) return;
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
          if (!governanceOK(token, govRuleOf(rule), gr, now)) return;
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
      text = (rule.messages && rule.messages[locale]) || rule.message || "";
    }
    if (!text) return;
    var now = Date.now();
    var gr = "announcement:" + rule.id;
    if (!governanceOK(token, govRuleOf(rule), gr, now)) return;
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
          if (!governanceOK(token, govRuleOf(rule), gr, now)) return;
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
    var now = Date.now();
    var aggRules = [];
    list.forEach(function (rule) {
      if (!rule || !rule.enabled || !notifOnPage(rule)) return;
      // MVP10 scheduling: a rule outside its active window doesn't render.
      if (rule.schedule && !isScheduledNow(rule.schedule, now, shopTz)) return;
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
      cfg.theme.showDelta && entry.type !== "removed" && entry.total !== 0;
    if (show) {
      if (!entry.badge) {
        entry.badge = elem("div");
        entry.badge.setAttribute("data-won-toast-delta", "");
        entry.badge.style.color = entry.accent;
        entry.card.appendChild(entry.badge);
      }
      entry.badge.textContent = fmtDelta(entry.total);
    }
    if (cfg.global.autoDismiss) scheduleDismiss(entry.card);
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
  function finalizeCard(card, opts) {
    opts = opts || {};
    if (opts.persistent) card.setAttribute("data-won-persistent", "");
    if (cfg.global.closeable || opts.persistent) {
      var close = elem("button");
      close.type = "button";
      close.setAttribute("data-won-toast-close", "");
      close.setAttribute("aria-label", "Dismiss");
      close.textContent = "×";
      close.addEventListener("click", function (e) {
        e.stopPropagation();
        dismiss(card);
        if (opts.ruleId) trackEvent(opts.ruleId, "dismiss", opts.variant);
        if (typeof opts.onClose === "function") opts.onClose();
      });
      card.appendChild(close);
    }

    if (cfg.global.clickAction === "open-cart" && !opts.persistent) {
      card.style.cursor = "pointer";
      card.addEventListener("click", function () {
        if (opts.ruleId) trackEvent(opts.ruleId, "click", opts.variant);
        window.location.href = "/cart";
      });
    }

    if (cfg.global.stackDirection === "newest-top") {
      region.insertBefore(card, region.firstChild);
    } else {
      region.appendChild(card);
    }
    // MVP13: one impression per rendered toast (Pro analytics).
    if (opts.ruleId) trackEvent(opts.ruleId, "impression", opts.variant);
    enforceMaxVisible();

    if (cfg.global.autoDismiss && !opts.persistent) {
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

    locale = normLocale(embed.getAttribute("data-won-toasts-locale"));
    shopTz = embed.getAttribute("data-won-toasts-shop-tz") || "UTC";
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
          // MVP10 exclusions/meta opt-out fully suppress the app on this page.
          active = matchesTargeting(cfg.targeting) && !isExcluded();
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
