/* won-panels — shared tab-set web component for the won-panels section
   (display: tabs). Builds the tab nav from each panel's data-title, wires
   click + Arrow key roving-tabindex, toggles panel visibility. Accordion mode
   needs no JS (native <details>). Loaded via <script defer> from won-panels.liquid;
   Wrapped in an IIFE with an early return so loading this file more than once on
   a page does NOT re-declare the top-level class. */
(function () {
  if (customElements.get('won-tabset')) return;
  class WonTabset extends HTMLElement {
  connectedCallback() {
    if (this.dataset.wonBound) return;
    this.panels = Array.from(this.querySelectorAll('.won-panels__panel'));
    if (!this.panels.length) return;
    const nav = this.querySelector('[role="tablist"]');
    if (!nav) return;
    this.tabs = this.panels.map((panel, i) => {
      const btnId = panel.id.replace('won-panelpanel-', 'won-paneltab-');
      const btn = document.createElement('button');
      btn.className = 'won-panels__tab';
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.id = btnId;
      btn.setAttribute('aria-controls', panel.id);
      btn.textContent = panel.dataset.title || '';
      panel.setAttribute('aria-labelledby', btnId);
      nav.appendChild(btn);
      btn.addEventListener('click', () => this.select(i));
      btn.addEventListener('keydown', (e) => {
        let next = null;
        if (e.key === 'ArrowRight') next = (i + 1) % this.tabs.length;
        else if (e.key === 'ArrowLeft') next = (i - 1 + this.tabs.length) % this.tabs.length;
        if (next !== null) { e.preventDefault(); this.select(next); this.tabs[next].focus(); }
      });
      return btn;
    });
    this.dataset.wonBound = '1';
    this.select(0);
  }
  select(index) {
    this.tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      const panel = this.querySelector('#' + tab.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
  }
}
  customElements.define('won-tabset', WonTabset);
})();
