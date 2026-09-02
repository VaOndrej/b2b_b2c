import { chromium } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
const files = readdirSync('themes/won-base/assets').filter(f => /^won-pack-.*\.svg$/.test(f)).sort();
const cells = files.map(f => `<figure><div>${readFileSync('themes/won-base/assets/'+f,'utf8')}</div><figcaption>${f}</figcaption></figure>`).join('');
const html = `<style>body{margin:0;background:#fff;font:12px system-ui;display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:12px}
figure{margin:0;text-align:center}figure svg{width:100%;height:auto;display:block}figcaption{padding-top:4px;color:#555}</style>${cells}`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
await p.setContent(html, { waitUntil: 'load' });
await p.screenshot({ path: 'tmp/shots/packshots-all.png', fullPage: true });
await b.close();
console.log('sheet written,', files.length, 'packs');
