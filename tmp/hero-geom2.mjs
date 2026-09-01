import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const w of [1440, 390]) {
  const p = await b.newPage({ viewport: { width: w, height: 1000 } });
  await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
  await p.waitForTimeout(2200);
  const r = await p.evaluate(() => {
    const bx = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; };
    const out = [];
    for (const hero of document.querySelectorAll('.won-hero--slider')) {
      const sec = (hero.closest('.shopify-section')?.id || '?').replace(/^shopify-section-template--\d+__/, '');
      const track = hero.querySelector('[data-won-track]');
      const controls = hero.querySelector('.won-rail__controls');
      const slides = [...track.children].filter((s) => s.getBoundingClientRect().width > 1);
      const mid = window.innerWidth / 2;
      const active = slides.reduce((best, s) => {
        const b = s.getBoundingClientRect();
        const d = Math.abs((b.left + b.right) / 2 - mid);
        return !best || d < best.d ? { el: s, d } : best;
      }, null)?.el;
      out.push({
        sec, peek: hero.classList.contains('won-hero--peek'),
        heroBox: bx(hero), track: bx(track), aktivni: active ? bx(active) : null,
        controls: controls ? bx(controls) : null,
        slideWidthVar: getComputedStyle(hero).getPropertyValue('--won-hero-slide').trim(),
        slidy: slides.map(bx),
      });
    }
    return out;
  });
  console.log(`--- ${w}px ---`);
  for (const h of r) {
    console.log(` ${h.sec} peek=${h.peek} --won-hero-slide=${h.slideWidthVar}`);
    console.log(`   hero     ${JSON.stringify(h.heroBox)}`);
    console.log(`   aktivní  ${JSON.stringify(h.aktivni)}`);
    console.log(`   controls ${JSON.stringify(h.controls)}`);
    console.log(`   slidy    ${JSON.stringify(h.slidy)}`);
  }
  await p.close();
}
await b.close();
