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
    if (this.track.hasAttribute('data-marquee')) { this.setupMarquee(); return; }
    this.prevBtn = this.querySelector('[data-won-prev]');
    this.nextBtn = this.querySelector('[data-won-next]');
    this.progress = this.querySelector('[data-won-progress]');
    this.bar = this.querySelector('[data-won-progress-bar]');
    this.dots = this.querySelector('[data-won-dots]');
    this._onScroll = this.onScroll.bind(this);
    this.track.addEventListener('scroll', this._onScroll, { passive: true });
    if (this.prevBtn) this.prevBtn.addEventListener('click', () => this.scrollByItems(-1));
    if (this.nextBtn) this.nextBtn.addEventListener('click', () => this.scrollByItems(1));
    if (this.dots) this.buildDots();
    this.bindMouseDrag();
    this.onScroll();
    // Infinite loop: clone the end slides so the rail scrolls endlessly both
    // ways and a neighbour always peeks in on BOTH sides — even resting on the
    // first/last card (no empty outer spacer). data-won-loop = always | desktop
    // | mobile picks the breakpoint where it's active.
    this._loopMode = this.dataset.wonLoop || '';
    if (this._loopMode) {
      this._loopMq = this._loopMode === 'always' ? null
        : matchMedia(this._loopMode === 'mobile' ? '(max-width: 749px)' : '(min-width: 750px)');
      this._syncLoop = this.syncLoop.bind(this);
      if (this._loopMq) this._loopMq.addEventListener('change', this._syncLoop);
      this._onSettle = () => {
        if (!this._loop) return;
        clearTimeout(this._settleTimer);
        this._settleTimer = setTimeout(() => this.wrapIfOnClone(), 130);
      };
      this.track.addEventListener('scroll', this._onSettle, { passive: true });
      this.syncLoop();
    }
    const interval = parseInt(this.dataset.autoplay, 10);
    if (interval && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this._timer = setInterval(() => this.autoAdvance(), interval * 1000);
      this.addEventListener('pointerenter', () => clearInterval(this._timer));
    }
  }
  disconnectedCallback() {
    if (this.track) this.track.removeEventListener('scroll', this._onScroll);
    if (this._loopMq && this._syncLoop) this._loopMq.removeEventListener('change', this._syncLoop);
    if (this._io) this._io.disconnect();
    clearTimeout(this._settleTimer);
    clearInterval(this._timer);
  }
  // Add/remove the bookend clones when the active breakpoint changes.
  syncLoop() {
    const want = this._loopMq ? this._loopMq.matches : true;
    if (want && !this._loop) this.addBookends();
    else if (!want && this._loop) this.removeBookends();
  }
  addBookends() {
    const reals = Array.from(this.track.children).filter((c) => !c.dataset.wonClone);
    if (reals.length < 2) return;
    const clone = (src) => {
      const c = src.cloneNode(true);
      c.dataset.wonClone = '1';
      c.setAttribute('aria-hidden', 'true');
      c.style.scrollSnapAlign = 'none';
      if (c.id) c.removeAttribute('id');
      c.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      return c;
    };
    this._firstReal = reals[0];
    this._lastReal = reals[reals.length - 1];
    this._head = clone(this._lastReal);
    this._tail = clone(this._firstReal);
    this.track.insertBefore(this._head, this._firstReal);
    this.track.appendChild(this._tail);
    this.track.dataset.wonLoop = '1';
    this._loop = true;
    // Centre the first real slide as the rest position. A scroll set now can be
    // dropped when the section is below the fold (content-visibility skips its
    // render), so also re-centre the first time the carousel actually enters the
    // viewport — that is exactly when it needs to look right.
    this.centerOn(this._firstReal, 'auto');
    if ('IntersectionObserver' in window) {
      this._io = new IntersectionObserver((entries, obs) => {
        if (entries.some((e) => e.isIntersecting)) { this.centerOn(this._firstReal, 'auto'); obs.disconnect(); }
      }, { threshold: 0.01 });
      this._io.observe(this);
    }
  }
  removeBookends() {
    if (this._io) { this._io.disconnect(); this._io = null; }
    if (this._head) this._head.remove();
    if (this._tail) this._tail.remove();
    this._head = this._tail = null;
    delete this.track.dataset.wonLoop;
    this._loop = false;
    this.track.scrollTo({ left: 0, behavior: 'auto' });
  }
  centerOn(el, behavior) {
    const eb = this.track.getBoundingClientRect();
    const rb = el.getBoundingClientRect();
    const target = this.track.scrollLeft + (rb.left - eb.left) - (eb.width - rb.width) / 2;
    if (behavior === 'auto') this.track.scrollLeft = target;
    else this.track.scrollTo({ left: target, behavior: 'smooth' });
  }
  // Once scrolling settles on a clone, jump instantly to its real twin — the
  // clone is identical, so the swap is invisible and the loop feels endless.
  wrapIfOnClone() {
    const eb = this.track.getBoundingClientRect();
    const mid = eb.left + eb.width / 2;
    let nearest = null, best = Infinity;
    for (const k of this.track.children) {
      const r = k.getBoundingClientRect();
      const d = Math.abs((r.left + r.width / 2) - mid);
      if (d < best) { best = d; nearest = k; }
    }
    if (!nearest || !nearest.dataset.wonClone) return;
    const twin = nearest === this._head ? this._lastReal : this._firstReal;
    const prev = this.track.style.scrollBehavior;
    this.track.style.scrollBehavior = 'auto';
    this.track.scrollLeft += twin.getBoundingClientRect().left - nearest.getBoundingClientRect().left;
    this.track.style.scrollBehavior = prev;
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
  scrollByItems(dir) {
    this.track.scrollBy({ left: dir * this.itemWidth(), behavior: 'smooth' });
  }
  autoAdvance() {
    // When looping, always step forward — wrapIfOnClone handles the seam, so
    // there's no "jump back to 0" (that would undo the endless feel).
    if (this._loop) { this.scrollByItems(1); return; }
    const max = this.track.scrollWidth - this.track.clientWidth;
    if (Math.abs(this.track.scrollLeft) >= max - 2) {
      this.track.scrollTo({ left: 0, behavior: 'smooth' });
    } else {
      this.scrollByItems(1);
    }
  }
  // Page-based dots: one dot per viewport-width page (not per item), so the
  // count stays small and each dot is a full 44px tap target. Hidden when the
  // rail doesn't scroll (nothing to page through) — no dead control.
  pageCount() {
    const w = this.track.clientWidth;
    return w > 0 ? Math.max(1, Math.round(this.track.scrollWidth / w)) : 1;
  }
  buildDots() {
    const pages = this.pageCount();
    this.dots.hidden = pages <= 1;
    if (pages <= 1) { this.dots.innerHTML = ''; this._dotEls = []; return; }
    this.dots.innerHTML = '';
    this._dotEls = [];
    for (let i = 0; i < pages; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'won-carousel__dot';
      b.setAttribute('aria-label', String(i + 1));
      b.addEventListener('click', () => {
        this.track.scrollTo({ left: i * this.track.clientWidth, behavior: 'smooth' });
      });
      this.dots.appendChild(b);
      this._dotEls.push(b);
    }
    this.updateDots();
  }
  updateDots() {
    if (!this._dotEls || !this._dotEls.length) return;
    const w = this.track.clientWidth;
    const active = w > 0 ? Math.round(Math.abs(this.track.scrollLeft) / w) : 0;
    this._dotEls.forEach((d, i) => d.setAttribute('aria-current', i === active ? 'true' : 'false'));
  }
  onScroll() {
    const max = this.track.scrollWidth - this.track.clientWidth;
    const ratio = max > 0 ? Math.min(1, Math.abs(this.track.scrollLeft) / max) : 0;
    this.updateDots();
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
    this.track.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
  }
}
  customElements.define('won-carousel', WonCarousel);
})();
