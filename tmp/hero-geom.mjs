import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const w of [1440, 390]) {
  const p = await b.newPage({ viewport: { width: w, height: 1000 } });
  await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
  await p.waitForTimeout(2000);
  const r = await p.evaluate(() => {
    const box = (el) => el ? { l: Math.round(el.getBoundingClientRect().left), r: Math.round(el.getBoundingClientRect().right), w: Math.round(el.getBoundingClientRect().width) } : null;
    const hero = document.querySelector('.won-hero');
    if (!hero) return null;
    const sec = hero.closest('.shopify-section');
    const track = hero.querySelector('[data-won-track]');
    const slides = [...(track?.children || [])];
    const mid = window.innerWidth / 2;
    const active = slides.reduce((best, s) => {
      const b = s.getBoundingClientRect();
      const d = Math.abs((b.left + b.right) / 2 - mid);
      return !best || d < best.d ? { el: s, d } : best;
    }, null)?.el;
    return {
      sekce: box(sec), hero: box(hero), track: box(track),
      container: box(hero.querySelector('.won-container')),
      aktivniSlide: box(active),
      controls: box(hero.querySelector('.won-rail__controls')),
      arrows: box(hero.querySelector('[data-won-arrows]')),
      progress: box(hero.querySelector('[data-won-progress]')),
      slidu: slides.length,
    };
  });
  console.log(`--- ${w}px ---`);
  console.log(JSON.stringify(r, null, 1));
  await p.close();
}
await b.close();
