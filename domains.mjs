import { chromium } from '@playwright/test';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const listings = [
 ['local','https://themes.shopify.com/themes/local/presets/local'],
 ['flow','https://themes.shopify.com/themes/flow/presets/flow'],
 ['boutique','https://themes.shopify.com/themes/boutique/presets/boutique'],
 ['xtra','https://themes.shopify.com/themes/xtra/presets/xtra'],
 ['pebble-bunie','https://themes.shopify.com/themes/pebble/presets/bunie'],
 ['stack','https://themes.shopify.com/themes/stack/presets/stack'],
 ['fit-check','https://themes.shopify.com/themes/fit-check/presets/fit-check'],
 ['flawless-chill','https://themes.shopify.com/themes/flawless/presets/chill'],
 ['koto-mochi','https://themes.shopify.com/themes/koto/presets/mochi'],
 ['next-rush','https://themes.shopify.com/themes/next/presets/rush'],
];
const b = await chromium.launch();
for (const [name,url] of listings){
  const ctx = await b.newContext({ userAgent:UA, viewport:{width:1440,height:1000} });
  const p = await ctx.newPage();
  let demo='(none)';
  try {
    await p.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    // wait for the demo iframe to appear
    await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>/myshopify\.com/.test(f.src)),{timeout:12000}).catch(()=>{});
    demo = await p.evaluate(()=>{ const f=[...document.querySelectorAll('iframe')].find(f=>/myshopify\.com/.test(f.src)); return f?new URL(f.src).origin:'(none)'; });
  } catch(e){ demo='ERR '+e.message.slice(0,40); }
  console.log(name.padEnd(16), demo);
  await ctx.close();
}
await b.close();
