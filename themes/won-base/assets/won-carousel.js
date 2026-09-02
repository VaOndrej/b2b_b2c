/* won-carousel — shared slider/scroller web component.
   Used by the won-carousel section AND the won-hero stage (layout: slider).
   Loaded via {{ 'won-carousel.js' | asset_url | script_tag }} from any section
   that needs it. Wrapped in an IIFE with an early return so loading this file
   more than once on a page (several carousel sections each emit the <script>
   tag) does NOT re-declare the top-level class — that throws
   "Identifier 'WonCarousel' has already been declared". */
(function () {
  if (customElements.get('won-carousel')) return;
  class WonCarousel extends HTMLElement {
  connectedCallback() {
    if (this.dataset.wonBound) return;
    this.dataset.wonBound = '1';
    this.track = this.querySelector('[data-won-track]');
    if (!this.track) return;
    // Marquee mode is a self-contained continuous belt (no arrows/dots/drag);
    // it just needs its content duplicated so the -50% loop is seamless.
    // One AbortController for every listener this component adds (incl. the
    // window-level drag listeners) so disconnectedCallback tears them all down —
    // otherwise the window pointermove/pointerup closures keep the element alive.
    this._ac = new AbortController();
    var signal = this._ac.signal;
    if (this.track.hasAttribute('data-marquee')) { this.setupMarquee(); return; }
    this.prevBtn = this.querySelector('[data-won-prev]');
    this.nextBtn = this.querySelector('[data-won-next]');
    this.arrows = this.querySelector('[data-won-arrows]');
    this.progress = this.querySelector('[data-won-progress]');
    this.bar = this.querySelector('[data-won-progress-bar]');
    this.dots = this.querySelector('[data-won-dots]');
    this._onScroll = this.onScroll.bind(this);
    this.track.addEventListener('scroll', this._onScroll, { passive: true, signal: signal });
    // Recompute overflow-gated controls (arrows/dots/progress) on resize too —
    // crossing a breakpoint changes column count and thus whether the rail
    // overflows, and resize does not fire scroll. Keeps the fit-aware invariant
    // true at every breakpoint, not only the one the rail first rendered at.
    window.addEventListener('resize', this._onScroll, { passive: true, signal: signal });
    // A rail inside a hidden tab panel binds at ZERO width: it looks like it
    // never overflows, so the fit-aware gate hides its controls, and revealing
    // the tab fires neither scroll nor resize — the arrows stay hidden forever.
    // ResizeObserver is the only signal for "this element just got a size", so
    // it is what makes the engine safe to use inside panels at all.
    if ('ResizeObserver' in window) {
      this._ro = new ResizeObserver(this._onScroll);
      this._ro.observe(this.track);
    }
    if (this.prevBtn) this.prevBtn.addEventListener('click', () => this.scrollByItems(-1), { signal: signal });
    if (this.nextBtn) this.nextBtn.addEventListener('click', () => this.scrollByItems(1), { signal: signal });
    if (this.dots) this.buildDots();
    this.bindMouseDrag();
    this.onScroll();
    // Looping = WRAP AROUND. 0 / 1 / 2 / 3, and next on 3 returns to 0.
    //
    // This used to clone the end slides into an endless belt. That cost three
    // defects (a first click swallowed by the re-centre, a dead end at the seam
    // because an edge clone cannot be centred, and a progress bar that teleported
    // to the middle on every wrap) and it made the rail feel unfinished: the card
    // you were about to reach was a clone whose media had not been requested yet.
    // A finite track that rewinds has none of those problems and the bar measures
    // something real again. data-won-loop = always | desktop | mobile.
    this._loopMode = this.dataset.wonLoop || '';
    if (this._loopMode) {
      this._loopMq = this._loopMode === 'always' ? null
        : matchMedia(this._loopMode === 'mobile' ? '(max-width: 749px)' : '(min-width: 750px)');
      this._syncLoop = () => {
        this._loop = this._loopMq ? this._loopMq.matches : true;
        this.renderScroll();
      };
      if (this._loopMq) this._loopMq.addEventListener('change', this._syncLoop, { signal: signal });
      this._syncLoop();
    }

    const interval = parseInt(this.dataset.autoplay, 10);
    if (interval && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this._autoMs = interval * 1000;
      const start = () => { clearInterval(this._timer); this._timer = setInterval(() => this.autoAdvance(), this._autoMs); };
      // Pause on hover, RESUME on leave (previously it stopped for good).
      this.addEventListener('pointerenter', () => clearInterval(this._timer), { signal: signal });
      this.addEventListener('pointerleave', start, { signal: signal });
      start();
    }
  }
  disconnectedCallback() {
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._ac) this._ac.abort();
    if (this._io) this._io.disconnect();
    cancelAnimationFrame(this._raf);
    clearTimeout(this._settleTimer);
    clearInterval(this._timer);
  }
  // Wrap the items in a group and duplicate it, so the CSS -50% translate loops
  // seamlessly (the belt rendered its content only once before — the second half
  // was blank). Mirrors the won-marquee section's proven two-group structure.
  setupMarquee() {
    const track = this.track;
    if (track.dataset.wonMarqueeReady) return;
    track.dataset.wonMarqueeReady = '1';
    const group = document.createElement('div');
    group.className = 'won-carousel__mq-group';
    while (track.firstChild) group.appendChild(track.firstChild);
    const clone = group.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    track.appendChild(group);
    track.appendChild(clone);
  }
  itemWidth() {
    const first = this.track.firstElementChild;
    if (!first) return this.track.clientWidth;
    const gap = parseFloat(getComputedStyle(this.track).columnGap || getComputedStyle(this.track).gap) || 0;
    return first.getBoundingClientRect().width + gap;
  }
  // Index of the slide the viewport is centred on. The ends of a rail cannot be
  // read off scrollLeft: a centre-snap peek layout rests at 20px, not 0, and its
  // last slide snaps 20px short of the maximum. The centred child is exact at
  // every layout.
  activeIndex() {
    const kids = this.track.children;
    if (!kids.length) return 0;
    const mid = this.track.getBoundingClientRect().left + this.track.clientWidth / 2;
    let active = 0, best = Infinity;
    for (let i = 0; i < kids.length; i++) {
      const b = kids[i].getBoundingClientRect();
      const d = Math.abs((b.left + b.right) / 2 - mid);
      if (d < best) { best = d; active = i; }
    }
    return active;
  }
  scrollByItems(dir) {
    const max = this.track.scrollWidth - this.track.clientWidth;
    // The rewind is the whole loop: at an end, go to the other one. Smooth on
    // purpose — the shopper sees it travel back, so it reads as "round again"
    // rather than as the rail glitching.
    if (this._loop && max > 1) {
      const i = this.activeIndex();
      const last = this.track.children.length - 1;
      if (dir > 0 && (i >= last || Math.abs(this.track.scrollLeft) >= max - 2)) {
        this.track.scrollTo({ left: 0, behavior: 'smooth' });
        return;
      }
      if (dir < 0 && (i <= 0 || Math.abs(this.track.scrollLeft) <= 2)) {
        this.track.scrollTo({ left: max, behavior: 'smooth' });
        return;
      }
    }
    this.track.scrollBy({ left: dir * this.itemWidth(), behavior: 'smooth' });
  }
  // Media for the neighbours of the slide on screen. Every slide ships `lazy`,
  // which is right for a grid far down the page and wrong for a rail the shopper
  // advances one click at a time: the next card arrived visibly empty. Promoting
  // only the neighbours keeps the initial load untouched.
  preloadNear() {
    const kids = Array.from(this.track.children);
    if (!kids.length) return;
    const active = this.activeIndex();
    for (let i = Math.max(0, active - 1); i <= Math.min(kids.length - 1, active + 2); i++) {
      kids[i].querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = 'eager'; });
    }
  }
  autoAdvance() {
    // scrollByItems already rewinds at the end when the loop is on; without it,
    // autoplay still needs to start over rather than sit on the last slide.
    const max = this.track.scrollWidth - this.track.clientWidth;
    if (!this._loop && Math.abs(this.track.scrollLeft) >= max - 2) {
      this.track.scrollTo({ left: 0, behavior: 'smooth' });
      return;
    }
    this.scrollByItems(1);
  }
  // A dot is a promise: "there are this many stops, and this is the one you are
  // on." The rail snaps per slide, so the stops ARE the slides. Counting pages
  // (round(scrollWidth / clientWidth)) is only true when the slides tile the
  // track exactly; in the peek layout the theme ships, four slides gave three
  // dots and a dot click landed between two cards for the snap to yank away.
  scrollToIndex(i) {
    const child = this.track.children[i];
    if (!child) return;
    // Measured, not computed from offsetLeft: spacers, gaps and whichever
    // element happens to be the offsetParent all drop out of a rect delta.
    const t = this.track.getBoundingClientRect();
    const c = child.getBoundingClientRect();
    const align = getComputedStyle(child).scrollSnapAlign.split(' ').pop();
    const delta =
      align === 'center'
        ? c.left + c.width / 2 - (t.left + this.track.clientWidth / 2)
        : c.left - t.left;
    this.track.scrollTo({ left: this.track.scrollLeft + delta, behavior: 'smooth' });
  }
  buildDots() {
    const stops = this.track.children.length;
    this.dots.hidden = stops <= 1;
    if (stops <= 1) { this.dots.innerHTML = ''; this._dotEls = []; return; }
    this.dots.innerHTML = '';
    this._dotEls = [];
    for (let i = 0; i < stops; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'won-carousel__dot';
      b.setAttribute('aria-label', String(i + 1));
      b.addEventListener('click', () => this.scrollToIndex(i));
      this.dots.appendChild(b);
      this._dotEls.push(b);
    }
    this.updateDots();
  }
  updateDots() {
    if (!this._dotEls || !this._dotEls.length) return;
    // Same "which slide is at rest" answer the arrows and the loop already use,
    // so the dot and the rail can never disagree about where the shopper is.
    const active = this.activeIndex();
    this._dotEls.forEach((d, i) => d.setAttribute('aria-current', i === active ? 'true' : 'false'));
  }
  // Coalesce scroll bursts into one layout read+write per frame (the handler
  // reads scrollWidth/clientWidth then writes bar width/transform).
  onScroll() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.renderScroll(); });
  }
  renderScroll() {
    const max = this.track.scrollWidth - this.track.clientWidth;
    const ratio = max > 0 ? Math.min(1, Math.abs(this.track.scrollLeft) / max) : 0;
    const scrollable = max > 1;
    // Invariant: navigation must not render when there's nothing to scroll — gate
    // arrows on real overflow (runtime, so it holds at every breakpoint), not just
    // the desktop count-based `fits` class. A looping rail always scrolls.
    if (this.arrows) this.arrows.hidden = !scrollable && !this._loop;
    this.updateDots();
    this.preloadNear();
    // The progress thumb must mirror the scroll: its width is the visible
    // fraction of the content, its offset is how far through that scroll we
    // are. When nothing overflows, there's nothing to indicate — hide it.
    if (this.progress && this.bar) {
      const scrollable = max > 1;
      this.progress.hidden = !scrollable;
      if (scrollable) {
        const trackW = this.progress.clientWidth;
        const visibleFrac = this.track.clientWidth / this.track.scrollWidth;
        const barW = Math.max(24, Math.round(trackW * visibleFrac));
        this.bar.style.inlineSize = barW + 'px';
        this.bar.style.transform = 'translateX(' + (ratio * (trackW - barW)) + 'px)';
      }
    }
    // A looping rail never reaches an end, so its arrows stay enabled.
    if (this.prevBtn) this.prevBtn.disabled = !this._loop && ratio <= 0.001;
    if (this.nextBtn) this.nextBtn.disabled = !this._loop && ratio >= 0.999;
  }
  bindMouseDrag() {
    let startX = 0, startLeft = 0, dragging = false;
    const down = (e) => {
      if (e.pointerType !== 'mouse') return;
      dragging = true; startX = e.clientX; startLeft = this.track.scrollLeft;
      this.classList.add('is-dragging');
    };
    const move = (e) => {
      if (!dragging) return;
      this.track.scrollLeft = startLeft - (e.clientX - startX);
    };
    const up = () => {
      if (!dragging) return;
      dragging = false; this.classList.remove('is-dragging');
    };
    var signal = this._ac ? this._ac.signal : undefined;
    this.track.addEventListener('pointerdown', down, { signal: signal });
    window.addEventListener('pointermove', move, { passive: true, signal: signal });
    window.addEventListener('pointerup', up, { signal: signal });
  }
}
  customElements.define('won-carousel', WonCarousel);
})();
