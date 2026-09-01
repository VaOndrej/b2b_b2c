import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const P = 'themes/dist/horizon-dev/config/settings_data.json';
const setGlobal = (patch) => {
  const raw = readFileSync(P, 'utf8'); const i = raw.indexOf('{');
  const d = JSON.parse(raw.slice(i)); Object.assign(d.current, patch);
  writeFileSync(P, raw.slice(0, i) + JSON.stringify(d, null, 2) + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return null;
  const cs = getComputedStyle(el), af = getComputedStyle(el, '::after');
  return { transform: cs.transform, bg: cs.backgroundColor, color: cs.color,
           shadow: cs.boxShadow.slice(0, 26), border: cs.borderColor,
           dur: cs.transitionDuration.split(',')[0].trim(),
           anim: af.animationName, animDur: af.animationDuration, animIter: af.animationIterationCount };
}, sel);

const BASE = { won_btn_hover: 'lift', won_btn_sheen: 'hover', won_btn_press: 'sink', won_fx_speed: 'normal' };
const CASES = [
  ['won_btn_hover', ['none', 'lift', 'grow', 'fill', 'outline']],
  ['won_btn_sheen', ['off', 'hover', 'loop']],
  ['won_btn_press', ['none', 'sink']],
  ['won_fx_speed', ['fast', 'normal', 'slow']],
];
const SEL = '.won-btn.won-fx, a.won-fx, button.won-fx';

const b = await chromium.launch();
for (const [key, values] of CASES) {
  for (const v of values) {
    setGlobal({ ...BASE, [key]: v });
    await sleep(14000);
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
    await p.waitForTimeout(1500);
    const el = p.locator(SEL).first();
    if (!(await el.count())) { console.log(`${key}=${v}: žádné CTA s efektovou vrstvou`); await p.close(); continue; }
    await el.scrollIntoViewIfNeeded();
    const sel = await el.evaluate((n) => {
      n.setAttribute('data-fx-probe', '1'); return '[data-fx-probe]';
    });
    const rest = await snap(p, sel);
    await el.hover(); await p.waitForTimeout(500);
    const hover = await snap(p, sel);
    const box = await el.boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down(); await p.waitForTimeout(280);
    const press = await snap(p, sel);
    await p.mouse.up();
    const diff = (a, c) => Object.keys(a).filter((k) => a[k] !== c[k]).map((k) => `${k}:${a[k]}→${c[k]}`);
    console.log(`\n### ${key} = ${v}`);
    console.log(`  klid   dur=${rest.dur} transform=${rest.transform} sheen=${rest.anim}/${rest.animDur}/${rest.animIter}`);
    console.log(`  hover  ${diff(rest, hover).join(' | ') || '— ŽÁDNÁ ZMĚNA'}`);
    console.log(`  press  ${diff(hover, press).join(' | ') || '— ŽÁDNÁ ZMĚNA oproti hoveru'}`);
    await p.close();
  }
}
await b.close();
