#!/usr/bin/env node
/**
 * render-packs — write the flat SVG packshots.
 *
 * One catalogue, two outputs:
 *   - .svg into themes/won-base/assets/  (theme assets; ~2 kB each, crisp at any size)
 *   - .png into a chosen dir with --raster (Shopify PRODUCT media does not render
 *     SVG, so store uploads need raster; the SVG stays the source of truth)
 *
 *   node themes/demo/tools/render-packs.mjs                    # dry run
 *   node themes/demo/tools/render-packs.mjs --apply
 *   node themes/demo/tools/render-packs.mjs --apply --raster tmp/packs --size 1400
 */

import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMS, sceneSvg } from './scenes/pack-svg.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', '..', 'won-base', 'assets');

/**
 * One restrained family, keyed to the theme's brand token (--won-accent
 * #ff5a3c). `bg` is a very light tint of the pack colour so the card reads as a
 * deliberate set rather than as products photographed by four different people —
 * that inconsistency is what made the old placeholders look unfinished.
 */
const PACKS = {
  'won-pack-whey': { form: 'tub', name: 'Whey', sub: 'Čokoláda', body: '#8a5a3c', cap: '#5f3c27', dark: '#6d4630', accent: '#8a5a3c', bg: '#f6efe9' },
  'won-pack-creatine': { form: 'tub', name: 'Kreatin', sub: 'Monohydrát', body: '#2b323c', cap: '#171c23', dark: '#1e242c', accent: '#ff5a3c', bg: '#eceef1' },
  'won-pack-bcaa': { form: 'tub', name: 'BCAA', sub: 'Recovery', body: '#e8563a', cap: '#b8402a', dark: '#c2452d', accent: '#b8402a', bg: '#fdeee9' },
  'won-pack-vitamin': { form: 'tub', name: 'D3 + K2', sub: '90 kapslí', body: '#e0a52e', cap: '#b07f1c', dark: '#c08f22', accent: '#a8761a', bg: '#fdf5e4' },
  'won-pack-magnesium': { form: 'tub', name: 'Magnesium', sub: 'B6', body: '#5b6bb5', cap: '#3f4c8a', dark: '#4a5799', accent: '#4a5799', bg: '#eef0f9' },
  'won-pack-omega': { form: 'tub', name: 'Omega 3', sub: 'Rybí olej', body: '#3f7f74', cap: '#2b5c54', dark: '#33685f', accent: '#2b5c54', bg: '#eaf3f1' },
  'won-pack-electrolytes': { form: 'tub', name: 'Elektrolyty', sub: 'Hydratace', body: '#3d6d8f', cap: '#2a4f69', dark: '#325b78', accent: '#2a4f69', bg: '#eaf1f6' },
  'won-pack-greens': { form: 'pouch', name: 'Greens', sub: 'Detox', body: '#5f8f4a', cap: '#456b36', dark: '#4c7539', accent: '#456b36', bg: '#eff5ea' },
  'won-pack-sticks': { form: 'box', name: 'Sticks', sub: '20 ks', body: '#d8cdb8', cap: '#b3a68d', dark: '#b3a68d', accent: '#8a6f45', bg: '#f7f3ea' },
};
// guard against a typo silently shipping a broken fill
for (const [k, v] of Object.entries(PACKS)) {
  for (const key of ['body', 'cap', 'dark', 'accent', 'bg']) {
    if (v[key] === undefined) continue; // pouch/box have no cap
    if (!/^#[0-9a-f]{6}$/i.test(v[key])) throw new Error(`${k}.${key} is not a hex colour: ${JSON.stringify(v[key])}`);
  }
}

const P = (n) => { const { form, ...o } = PACKS[n]; return { form, ...o, bg: null }; };

/**
 * Composite art, same flat packs. Names match what the section presets and the
 * demo templates already reference, so switching style is a file swap — except
 * the extension, which moves .jpg -> .svg (updated in the same change).
 */
const SCENES = {
  'won-hero-product': () => sceneSvg({
    w: 2400, h: 1040, bg: '#20252c', floor: { y: 880, fill: '#1a1e24' }, label: 'Won supplement range',
    glow: { x: 1790, y: 640, r: 760 },
    packs: [
      { ...P('won-pack-greens'), x: 1490, y: 900, scale: 0.62, opacity: 0.55 },
      { ...P('won-pack-creatine'), x: 1790, y: 900, scale: 0.9 },
      { ...P('won-pack-bcaa'), x: 2080, y: 900, scale: 0.7, opacity: 0.9 },
    ],
  }),
  'won-hero-product-mobile': () => sceneSvg({
    w: 840, h: 1240, bg: '#20252c', floor: { y: 760, fill: '#1a1e24' }, scrim: 'none',
    glow: { x: 430, y: 560, r: 420 },
    packs: [
      { ...P('won-pack-greens'), x: 255, y: 770, scale: 0.42, opacity: 0.6 },
      { ...P('won-pack-creatine'), x: 430, y: 780, scale: 0.6 },
      { ...P('won-pack-bcaa'), x: 610, y: 770, scale: 0.47, opacity: 0.9 },
    ],
  }),
  'won-hero-supplements': () => sceneSvg({
    w: 2400, h: 1200, bg: '#241f24', floor: { y: 1010, fill: '#1d191d' }, label: 'Won supplement range',
    glow: { x: 1740, y: 740, r: 760 },
    packs: [
      { ...P('won-pack-whey'), x: 1420, y: 1030, scale: 0.6, opacity: 0.55 },
      { ...P('won-pack-magnesium'), x: 1740, y: 1030, scale: 0.9 },
      { ...P('won-pack-sticks'), x: 2050, y: 1030, scale: 0.68, opacity: 0.9 },
    ],
  }),
  'won-lifestyle-1': () => sceneSvg({
    w: 2000, h: 1126, bg: '#eef1f0', floor: { y: 940, fill: '#e3e8e6' }, scrim: 'none',
    packs: [
      { ...P('won-pack-whey'), x: 660, y: 960, scale: 0.95 },
      { ...P('won-pack-greens'), x: 940, y: 960, scale: 0.78 },
      { ...P('won-pack-sticks'), x: 1210, y: 960, scale: 0.66 },
      { ...P('won-pack-creatine'), x: 1470, y: 960, scale: 0.86 },
    ],
  }),
};
// Promo slides: one pack each, upper-right quadrant, copy-zone scrims on.
const PROMO = [
  ['won-promo-1', 'won-pack-electrolytes', '#eaf1f6', '#dde8f0'],  // "Když voda nestačí"
  ['won-promo-2', 'won-pack-creatine', '#eceef1', '#e0e4e9'],      // "Kreatin −20 %"
  ['won-promo-3', 'won-pack-whey', '#f6efe9', '#ece2d9'],          // "Whey s 21 g proteinu"
  ['won-promo-4', 'won-pack-bcaa', '#fdeee9', '#f7e2db'],          // "Novinka: BCAA"
];
for (const [name, pack, bg, floor] of PROMO) {
  SCENES[name] = () => sceneSvg({
    w: 1400, h: 1000, bg, floor: { y: 640, fill: floor },
    packs: [{ ...P(pack), x: 790, y: 660, scale: 0.86 }],
  });
}

const TILES = [
  ['won-cat-protein', 'won-pack-whey', 'won-pack-greens', '#f2ebe4', '#e6dbd0'],
  ['won-cat-creatine', 'won-pack-creatine', 'won-pack-bcaa', '#e9ecf0', '#dbe0e7'],
  ['won-cat-vitamins', 'won-pack-vitamin', 'won-pack-omega', '#faf2e0', '#f0e5cc'],
  ['won-cat-health', 'won-pack-magnesium', 'won-pack-sticks', '#eef0f9', '#e0e4f2'],
];
for (const [name, a, b2, bg, floor] of TILES) {
  SCENES[name] = () => sceneSvg({
    w: 1200, h: 1500, bg, floor: { y: 1180, fill: floor }, scrim: 'none',
    packs: [
      { ...P(b2), x: 730, y: 1200, scale: 0.78, opacity: 0.85 },
      { ...P(a), x: 480, y: 1210, scale: 1.0 },
    ],
  });
}

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const apply = argv.includes('--apply');
const rasterDir = flag('--raster');
const size = Number(flag('--size') || 1400);

const names = Object.keys(PACKS);
const sceneNames = Object.keys(SCENES);
console.log(`${apply ? 'WRITE' : 'DRY RUN'}  ${names.length} pack(s) -> ${assetsDir}${rasterDir ? ` (+ png -> ${rasterDir})` : ''}\n`);

const svgs = {};
for (const n of names) {
  const { form, ...opts } = PACKS[n];
  svgs[n] = FORMS[form]({ w: 600, h: 700, ...opts });
  const dest = join(assetsDir, `${n}.svg`);
  const before = existsSync(dest) ? `${(statSync(dest).size / 1024).toFixed(1)} kB` : 'new';
  console.log(`  ${n.padEnd(22)} ${form.padEnd(6)} ${(svgs[n].length / 1024).toFixed(1)} kB  (${before})`);
}

if (!apply) {
  console.log('\nnothing written. re-run with --apply');
  process.exit(0);
}

mkdirSync(assetsDir, { recursive: true });
for (const n of names) writeFileSync(join(assetsDir, `${n}.svg`), svgs[n]);
for (const n of sceneNames) {
  const out = SCENES[n]();
  writeFileSync(join(assetsDir, `${n}.svg`), out);
  console.log(`  scene ${n.padEnd(26)} ${(out.length / 1024).toFixed(1)} kB`);
}
console.log(`\nwrote ${names.length} pack svg + ${sceneNames.length} scene svg -> ${assetsDir}`);

if (rasterDir) {
  const { chromium } = await import('playwright');
  mkdirSync(rasterDir, { recursive: true });
  const browser = await chromium.launch();
  // Packs keep their 6:7 frame; scenes carry their own viewBox, so read the
  // aspect out of the SVG instead of assuming one — a category tile is 4:5 and a
  // hero is ~2.3:1, and forcing 6:7 on either would letterbox it.
  const jobs = [
    ...names.map((n) => [n, svgs[n]]),
    // Collection images: Shopify shows them as their own media, so they need the
    // same rasterisation path as products.
    ...sceneNames.filter((n) => n.startsWith('won-cat-')).map((n) => [n, SCENES[n]()]),
  ];
  for (const [n, svg] of jobs) {
    const vb = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
    const ratio = vb ? Number(vb[2]) / Number(vb[1]) : 700 / 600;
    const page = await browser.newPage({ viewport: { width: size, height: Math.round(size * ratio) } });
    await page.setContent(
      `<style>*{margin:0;padding:0}svg{width:100vw;height:100vh;display:block}</style>${svg}`,
      { waitUntil: 'load' }
    );
    const buf = await page.screenshot({ type: 'png' });
    writeFileSync(join(rasterDir, `${n}.png`), buf);
    console.log(`  raster ${n}.png  ${(buf.length / 1024).toFixed(0)} kB`);
    await page.close();
  }
  await browser.close();
}
console.log('next: node themes/build/compose.mjs horizon');
