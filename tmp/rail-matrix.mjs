import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const P = 'themes/dist/horizon-dev/config/settings_data.json';
const setGlobal = (patch) => {
  const raw = readFileSync(P, 'utf8'); const i = raw.indexOf('{');
  const d = JSON.parse(raw.slice(i));
  Object.assign(d.current, patch);
  writeFileSync(P, raw.slice(0, i) + JSON.stringify(d, null, 2) + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One row per rail found on the page: what a shopper actually sees.
const MEASURE = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const out = [];
  for (const row of document.querySelectorAll('.won-rail__controls')) {
    const section = row.closest('.shopify-section');
    const id = (section?.id || '?').replace(/^shopify-section-/, '').replace(/^template--\d+__/, '').slice(0, 22);
    const track = section?.querySelector('[data-won-track]');
    const overflow = track ? track.scrollWidth > track.clientWidth + 1 : null;
    const progress = row.querySelector('[data-won-progress]');
    const dots = row.querySelector('[data-won-dots]');
    const arrows = row.querySelector('[data-won-arrows]');
    const btn = arrows?.querySelector('button');
    const cs = btn ? getComputedStyle(btn) : null;
    out.push({
      id,
      overflow,
      progress: progress ? (vis(progress) ? 'ano' : 'skryté') : '—',
      dots: dots ? (vis(dots) ? `ano(${dots.children.length})` : 'skryté') : '—',
      arrows: arrows ? (arrows.hasAttribute('hidden') ? 'hidden' : (vis(arrows) ? 'ano' : 'neviditelné')) : '—',
      radius: cs ? cs.borderRadius.split(' ')[0] : '—',
      bg: cs ? cs.backgroundColor : '—',
      tone: arrows?.getAttribute('data-won-rail-tone') ?? '—',
      cls: btn ? [...btn.classList].filter((c) => c.startsWith('won-rail__arrow--')).join(' ') : '—',
    });
  }
  return out;
};

const CASES = [
  ['won_rail_arrow_style', ['square', 'soft', 'minimal']],
  ['won_rail_arrow_tone', ['auto', 'surface', 'overlay']],
];
const BASE = { won_rail_indicator: 'progress', won_rail_arrows: 'always', won_rail_arrow_style: 'pill', won_rail_arrow_tone: 'auto' };

const b = await chromium.launch();
for (const [key, values] of CASES) {
  for (const v of values) {
    setGlobal({ ...BASE, [key]: v });
    await sleep(14000);
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    await p.goto('http://127.0.0.1:9292/', { waitUntil: 'load' });
    await p.waitForTimeout(1800);
    const rows = await p.evaluate(MEASURE);
    console.log(`\n### ${key} = ${v}   (railů: ${rows.length})`);
    for (const r of rows) {
      console.log(`  ${r.id.padEnd(27)} ovf=${String(r.overflow).padEnd(5)} bar=${r.progress.padEnd(7)} dots=${r.dots.padEnd(9)} sipky=${r.arrows.padEnd(6)} r=${r.radius.padEnd(7)} bg=${r.bg.padEnd(22)} ${r.cls}`);
    }
    await p.close();
  }
}
await b.close();
