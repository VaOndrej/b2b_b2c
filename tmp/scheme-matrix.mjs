import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const T = 'themes/dist/horizon-dev/templates/index.json';
const setScheme = (val) => {
  const d = JSON.parse(readFileSync(T, 'utf8'));
  for (const s of Object.values(d.sections)) if (s.settings && 'color_scheme' in s.settings) s.settings.color_scheme = val;
  writeFileSync(T, JSON.stringify(d, null, 2) + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MEASURE = () => {
  const parse = (c) => { const m = (c.match(/[\d.]+/g) || [0,0,0]).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const over = (f, b) => ({ r: f.r*f.a + b.r*(1-f.a), g: f.g*f.a + b.g*(1-f.a), b: f.b*f.a + b.b*(1-f.a), a: 1 });
  const lum = (c) => { const f = (v) => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x+0.05)/(y+0.05); };
  const behind = (el) => { let n = el; while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a === 1) return c; n = n.parentElement; } return { r:255,g:255,b:255,a:1 }; };
  const vis = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return b.width > 2 && b.height > 2 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.1; };
  const bad = [];
  let checked = 0;
  for (const el of document.querySelectorAll('.won-section h1, .won-section h2, .won-section h3, .won-section p, .won-section .won-btn, .won-section a[href]')) {
    if (!vis(el)) continue;
    if (el.querySelector('h1,h2,h3,p,a,button')) continue; // jen listy, ať neměřím obaly
    const cs = getComputedStyle(el);
    const bg = behind(el.parentElement || el);
    const fg = over(parse(cs.color), bg);
    const r = ratio(fg, bg);
    checked++;
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const floor = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    if (r < floor) bad.push({ t: (el.textContent || '').trim().slice(0, 22), r: +r.toFixed(2), floor, size: Math.round(size) });
  }
  return { checked, bad: bad.slice(0, 6), badTotal: bad.length };
};

const b = await chromium.launch();
for (const scheme of ['scheme-1', 'scheme-2', 'scheme-3', 'scheme-4', 'scheme-5', 'scheme-6']) {
  setScheme(scheme);
  await sleep(14000);
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
  await p.waitForTimeout(1600);
  const m = await p.evaluate(MEASURE);
  console.log(`${scheme.padEnd(9)} měřeno=${String(m.checked).padEnd(4)} pod AA=${m.badTotal}${m.badTotal ? ' -> ' + JSON.stringify(m.bad) : ''}`);
  await p.close();
}
await b.close();
