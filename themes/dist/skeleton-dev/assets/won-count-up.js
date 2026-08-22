/* won-count-up — shared "count-up" util for any statistic/number in the theme.

   Purpose: make a rendered number "load into its final form" — it counts from a
   start value (0 by default) up to the value already printed in the DOM, the
   first time the element scrolls into view.

   Usage (any element, any section):
     <dt data-won-countup>10 000+</dt>
     <span data-won-countup data-won-countup-duration="1200" data-won-countup-start="0">€1.2M</span>

   The element's SERVER-RENDERED text is the source of truth (the final form).
   Without JS, with a bot, or under prefers-reduced-motion, the final value is
   what shows — the animation only ever plays forward TO that value, never
   leaves a half-finished number behind.

   Smart parser: extracts the first numeric block, keeps prefix/suffix and the
   original grouping/decimal formatting, and animates only the number. If the
   text has no clear single metric (another digit sits in the prefix/suffix,
   e.g. "24/7", "3 z 5"), it is left untouched — better a static number than a
   confusing "13/7" mid-animation.

   Loaded once per page via {{ 'won-count-up.js' | asset_url | script_tag }};
   wrapped in an IIFE with an early return so several sections emitting the tag
   never double-initialise. */
(function () {
  // Real double-load guard: several sections each emit this script tag, so on the
  // 2nd+ execution bail entirely — otherwise each run adds its own
  // DOMContentLoaded / shopify:section:load listener and re-scans the page.
  if (typeof window !== 'undefined') {
    if (window.__wonCountUpBound) return;
    window.__wonCountUpBound = true;
  }

  var SPACE = /[   \s]/; // regular, no-break, narrow no-break, figure spaces

  // Parse a display string into an animatable descriptor, or null when it has
  // no single clear number to animate.
  function parseNumber(text) {
    var raw = String(text == null ? '' : text);
    var m = raw.match(/\d[\d.,   \s]*\d|\d/);
    if (!m) return null;

    var core = m[0];
    var prefix = raw.slice(0, m.index);
    var suffix = raw.slice(m.index + core.length);

    // Ambiguity guard: any OTHER digit outside the core means the string is not
    // a single metric ("24/7", "3 z 5", "2 x 100 ml") — leave it static.
    if (/\d/.test(prefix) || /\d/.test(suffix)) return null;

    var hasSpaceGroup = SPACE.test(core);
    var noSpace = core.replace(new RegExp(SPACE.source, 'g'), '');
    var dots = (noSpace.match(/\./g) || []).length;
    var commas = (noSpace.match(/,/g) || []).length;

    var groupSep = hasSpaceGroup ? ' ' : ''; // reconstruct with a no-break space
    var decimalSep = '';
    var digits = noSpace;

    if (dots && commas) {
      // Both present: the last-occurring separator is the decimal point.
      decimalSep = noSpace.lastIndexOf('.') > noSpace.lastIndexOf(',') ? '.' : ',';
      var grp = decimalSep === '.' ? ',' : '.';
      if (!groupSep) groupSep = grp;
      digits = noSpace.split(grp).join('');
    } else if (dots || commas) {
      var sep = dots ? '.' : ',';
      var count = dots || commas;
      var after = noSpace.slice(noSpace.lastIndexOf(sep) + 1);
      // A single separator with a non-3-digit tail is a decimal (1.2, 4,9,
      // 3.14). Otherwise (or if it repeats) it is thousands grouping.
      if (count === 1 && after.length !== 3) {
        decimalSep = sep;
      } else {
        if (!groupSep) groupSep = sep;
        digits = noSpace.split(sep).join('');
      }
    }

    var target;
    var decimals = 0;
    if (decimalSep) {
      var parts = digits.split(decimalSep);
      decimals = parts[1] ? parts[1].length : 0;
      target = parseFloat(parts[0] + '.' + (parts[1] || '0'));
    } else {
      target = parseInt(digits, 10);
    }
    if (!isFinite(target)) return null;

    return {
      prefix: prefix,
      suffix: suffix,
      target: target,
      decimals: decimals,
      groupSep: groupSep,
      decimalSep: decimalSep,
      raw: raw,
    };
  }

  // Render a value back into the original display format.
  function formatValue(value, meta) {
    var str = meta.decimals > 0 ? value.toFixed(meta.decimals) : String(Math.round(value));
    var split = str.split('.');
    var intPart = split[0];
    var frac = split[1] || '';
    var neg = '';
    if (intPart.charAt(0) === '-') { neg = '-'; intPart = intPart.slice(1); }
    if (meta.groupSep) {
      intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, meta.groupSep);
    }
    var out = neg + intPart;
    if (meta.decimals > 0) out += (meta.decimalSep || '.') + frac;
    return meta.prefix + out + meta.suffix;
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function animate(el, meta, duration, start) {
    var from = start;
    var to = meta.target;
    var t0 = null;
    function frame(now) {
      if (t0 === null) t0 = now;
      var p = duration > 0 ? Math.min(1, (now - t0) / duration) : 1;
      var value = from + (to - from) * easeOutCubic(p);
      el.textContent = formatValue(value, meta);
      if (p < 1) {
        requestAnimationFrame(frame);
      } else {
        // Snap back to the exact original text to avoid any rounding drift.
        el.textContent = meta.raw;
      }
    }
    requestAnimationFrame(frame);
  }

  function prep(el) {
    if (el.__wonCountUpReady) return null;
    var meta = parseNumber(el.textContent.trim());
    if (!meta) { el.__wonCountUpReady = true; return null; } // no clear metric — leave static
    el.__wonCountUpReady = true;
    var duration = parseInt(el.getAttribute('data-won-countup-duration'), 10);
    if (!isFinite(duration) || duration < 0) duration = 1600;
    var start = parseFloat(el.getAttribute('data-won-countup-start'));
    if (!isFinite(start)) start = 0;
    return { meta: meta, duration: duration, start: start };
  }

  function reducedMotion() {
    return typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  var observer = null;
  function getObserver() {
    if (observer || typeof IntersectionObserver === 'undefined') return observer;
    observer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        obs.unobserve(el);
        var cfg = el.__wonCountUpCfg;
        if (cfg) animate(el, cfg.meta, cfg.duration, cfg.start);
      });
    }, { threshold: 0.35 });
    return observer;
  }

  function scan(root) {
    root = root || document;
    var els = root.querySelectorAll('[data-won-countup]');
    var obs = getObserver();
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var cfg = prep(el);
      if (!cfg) continue;
      // Reduced motion or no observer: leave the final value in place.
      if (reducedMotion() || !obs) continue;
      // Reserve the final rendered width BEFORE swapping in the (narrower) start
      // value, so the count-up reflow never shifts neighbours (CLS). Measured
      // once here; inline-block lets min-inline-size apply to inline elements too.
      var w = el.getBoundingClientRect().width;
      if (w > 0) { el.style.display = 'inline-block'; el.style.minInlineSize = Math.ceil(w) + 'px'; }
      el.textContent = formatValue(cfg.start, cfg.meta);
      el.__wonCountUpCfg = cfg;
      obs.observe(el);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { scan(); });
    } else {
      scan();
    }
    // Theme editor: a section re-rendered after an edit needs a fresh scan.
    document.addEventListener('shopify:section:load', function (e) {
      scan(e.target || document);
    });
  }

  // Testable surface (Node/CommonJS) — harmless no-op in the browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseNumber: parseNumber, formatValue: formatValue };
  }
})();
