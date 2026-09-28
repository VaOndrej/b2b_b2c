import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const out = 'tmp/theme-remediation/2026-09-11';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
const issues=[]; page.on('pageerror', e=>issues.push(e.message));
const results=[];
await page.goto('http://127.0.0.1:9292/pages/contact?view=won-qa-page-31');
if(await page.evaluate(()=>window.Shopify?.shop)!=='b2b-b2c-store-development.myshopify.com')throw Error('Wrong store');
for(const width of [390,768,1440]){
 await page.setViewportSize({width,height:1000});
 for(const id of ['qa183','qa184','qa185']){
  const section=page.locator(`[id^="shopify-section-"][id$="__${id}"]`);
  const iframe=section.locator('iframe');await iframe.scrollIntoViewIfNeeded();
  const frame=await iframe.elementHandle().then(h=>h.contentFrame());
  let ready=true;try{await frame.locator('button,video').first().waitFor({state:'attached',timeout:15000})}catch{ready=false}
  const path=`${out}/${id}-${width}-provider-ready.png`;
  await section.screenshot({path,style:'.shopify-section-group-header-group {visibility:hidden!important}',animations:'disabled'});
  results.push({id,width,ready,path,provider:frame.url()});
 }
}
writeFileSync(`${out}/video-provider-review.json`,JSON.stringify({results,issues},null,2));
await browser.close();
