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
    this.prevBtn = this.querySelector('[data-won-prev]');
    this.nextBtn = this.querySelector('[data-won-next]');
    this.progress = this.querySelector('[data-won-progress]');
    this.bar = this.querySelector('[data-won-progress-bar]');
    this._onScroll = this.onScroll.bind(this);
    this.track.addEventListener('scroll', this._onScroll, { passive: true });
    if (this.prevBtn) this.prevBtn.addEventListener('click', () => this.scrollByItems(-1));
    if (this.nextBtn) this.nextBtn.addEventListener('click', () => this.scrollByItems(1));
    this.bindMouseDrag();
    this.onScroll();
    const interval = parseInt(this.dataset.autoplay, 10);
    if (interval && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this._timer = setInterval(() => this.autoAdvance(), interval * 1000);
      this.addEventListener('pointerenter', () => clearInterval(this._timer));
    }
  }
  disconnectedCallback() {
    if (this.track) this.track.removeEventListener('scroll', this._onScroll);
    clearInterval(this._timer);
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
    const max = this.track.scrollWidth - this.track.clientWidth;
    if (Math.abs(this.track.scrollLeft) >= max - 2) {
      this.track.scrollTo({ left: 0, behavior: 'smooth' });
    } else {
      this.scrollByItems(1);
    }
  }
  onScroll() {
    const max = this.track.scrollWidth - this.track.clientWidth;
    const ratio = max > 0 ? Math.min(1, Math.abs(this.track.scrollLeft) / max) : 0;
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
    if (this.prevBtn) this.prevBtn.disabled = ratio <= 0.001;
    if (this.nextBtn) this.nextBtn.disabled = ratio >= 0.999;
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
