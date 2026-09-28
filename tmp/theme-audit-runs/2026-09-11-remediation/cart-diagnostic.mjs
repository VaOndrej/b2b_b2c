import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch();
const results=[];
for(const width of [390,1440]) {
 const page=await browser.newPage({viewport:{width,height:1000}});const events=[];const start=Date.now();
 page.on('request',r=>{if(/\/cart\/(update|clear)\.js/.test(r.url())) events.push({at:Date.now()-start,type:'request',url:r.url(),body:r.postData()});});
 page.on('response',async r=>{if(/\/cart(?:\/(update|clear))?\.js/.test(r.url())) {try{const c=await r.json();events.push({at:Date.now()-start,type:'response',url:r.url(),count:c.item_count});}catch{}}});
 await page.goto('http://127.0.0.1:9292/');
 const shop=await page.evaluate(()=>Shopify.shop);if(shop!=='b2b-b2c-store-development.myshopify.com') throw Error(shop);
 await page.evaluate(()=>fetch('/cart/clear.js',{method:'POST'}));await page.reload();
 await page.locator('[data-won-stepper][data-won-rendered-qty="0"]').first().waitFor();
 const card=page.locator('.won-pcard:has([data-won-stepper])').first();const add=card.locator('[data-won-add]');const minus=card.locator('[data-won-step="-1"]');
 await card.hover();await add.click();await add.click();await minus.click();await minus.click();
 const immediate=await page.evaluate(async()=>({count:(await(await fetch('/cart.js')).json()).item_count,hidden:document.querySelector('.won-pcard [data-won-qty]').hidden}));
 await page.waitForFunction(()=>!document.querySelector('.won-pcard [data-won-stepper].is-syncing'));
 let eventual;for(let i=0;i<30;i++){eventual=await page.evaluate(async()=>(await(await fetch('/cart.js')).json()).item_count);if(eventual===0)break;}
 results.push({width,shop,immediate,eventual,events});await page.close();
}
await writeFile('tmp/theme-audit-runs/2026-09-11-remediation/cart-diagnostic.json',JSON.stringify(results,null,2));await browser.close();
