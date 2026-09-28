const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
 const b=await chromium.launch();const page=await b.newPage({viewport:{width:390,height:1000}});const rows=[];
 await page.goto('http://127.0.0.1:9292/pages/contact?view=won-qa-page-1');
 console.log('identity',await page.evaluate(()=>window.Shopify?.shop));await page.evaluate(()=>document.fonts.ready);
 async function capture(stage){rows.push({stage,links:await page.locator('a.won-btn').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return {section:e.closest('[id^="shopify-section-"]')?.id,text:e.textContent,w:r.width,h:r.height,x:r.x,y:r.y,min:s.minBlockSize,transform:s.transform,ancestors:[...function*(p){while(p){const cs=getComputedStyle(p);if(cs.transform!=='none'||cs.overflowX!=='visible')yield {tag:p.tagName,class:p.className,transform:cs.transform,overflowX:cs.overflowX};p=p.parentElement;}}(e.parentElement)]};}).filter(e=>e.w<44||e.h<44))});}
 await capture('initial');
 for(const id of ['qa003','qa005']){const section=page.locator(`[id^="shopify-section-"][id$="__${id}"]`);await section.scrollIntoViewIfNeeded();await section.locator('img').evaluateAll(async imgs=>{imgs.forEach(i=>i.loading='eager');await Promise.all(imgs.map(i=>i.decode().catch(()=>{})));});await page.waitForTimeout(150);await section.screenshot({path:`tmp/theme-audit-runs/2026-09-11-remediation/tap-${id}.png`,animations:'disabled',style:'.shopify-section-group-header-group { visibility:hidden !important; }'});await capture(id+' screenshot');
 for(const rail of await section.locator('won-carousel').all()){const track=rail.locator('[data-won-track]').first();if(!await track.isVisible())continue;const overflow=await track.evaluate(e=>e.scrollWidth>e.clientWidth+1);if(overflow){await track.evaluate(e=>e.scrollTo({left:0,behavior:'instant'}));await page.waitForTimeout(250);await track.evaluate(e=>e.scrollBy({left:e.clientWidth,behavior:'instant'}));await page.waitForTimeout(200);await track.evaluate(e=>e.scrollTo({left:0,behavior:'instant'}));}}await capture(id+' rail');}
 console.log(JSON.stringify(rows,null,2));fs.writeFileSync('tmp/theme-audit-runs/2026-09-11-remediation/tap-diagnostic.json',JSON.stringify(rows,null,2));await b.close();
})();
