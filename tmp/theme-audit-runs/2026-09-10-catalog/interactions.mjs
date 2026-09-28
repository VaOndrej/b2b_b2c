import {chromium} from 'playwright';
import fs from 'node:fs';
const root='tmp/theme-audit-runs/2026-09-10-catalog';
const manifest=JSON.parse(fs.readFileSync('themes/won-base/examples/qa/manifest.json')).cases;
const browser=await chromium.launch();const rows=[];
for(const width of [390,768,1440]){
 const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width===390,isMobile:width===390});const page=await context.newPage();
 async function open(id){let c=manifest.find(c=>c.id===id);await page.goto('http://127.0.0.1:9292'+c.url);if(await page.evaluate(()=>window.Shopify?.shop)!=='b2b-b2c-store-development.myshopify.com')throw Error('wrong store');return page.locator(`[id^="shopify-section-"][id$="__${c.sectionId}"]`);}
 for(const id of ['qa011','qa012','qa035','qa036']){
  try{const s=await open(id);const input=s.locator('input[type=email]');await input.fill('invalid');const invalid=await input.evaluate(e=>e.validity.typeMismatch);await input.fill('qa@example.invalid');rows.push({id,width,emailRejectsInvalid:invalid,emailAcceptsValid:await input.evaluate(e=>e.checkValidity()),submission:'not attempted'});}catch(e){rows.push({id,width,error:e.message});}
 }
 for(const id of ['qa168','qa169','qa170','qa171','qa172']){
  try{const s=await open(id);await s.scrollIntoViewIfNeeded();const rail=s.locator('won-carousel').first();const track=rail.locator('[data-won-track]');const next=rail.locator('[data-won-next]');const prev=rail.locator('[data-won-prev]');await track.evaluate(e=>e.scrollTo({left:0,behavior:'instant'}));await page.waitForTimeout(300);const before=await track.evaluate(e=>e.scrollLeft);let clicked=false;if(await next.isVisible()){await next.click();await page.waitForTimeout(700);clicked=(await track.evaluate(e=>e.scrollLeft))!==before;}const post=await track.evaluate(e=>e.scrollLeft);await page.waitForTimeout(5500);const later=await track.evaluate(e=>e.scrollLeft);rows.push({id,width,nextVisible:await next.isVisible(),nextMoves:clicked,prevVisible:await prev.isVisible(),post,later,autoplayAttribute:await rail.getAttribute('data-autoplay'),loop:await rail.getAttribute('data-loop')});}catch(e){rows.push({id,width,error:e.message});}
 }
 for(const id of ['qa135','qa173','qa174']){try{const s=await open(id);await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(700);const sticky=s.locator('won-sticky-atc');rows.push({id,width,visible:await sticky.isVisible(),geometry:await sticky.evaluate(e=>[e,...e.querySelectorAll('.won-sticky__inner,.won-sticky__atc')].map(x=>({class:x.className,x:x.getBoundingClientRect().x,right:x.getBoundingClientRect().right,width:x.getBoundingClientRect().width,display:getComputedStyle(x).display}))) });if(id==='qa135')await page.screenshot({path:`${root}/sticky-page-${width}.png`});}catch(e){rows.push({id,width,error:e.message});}}
 const mosaic=await open('qa019');rows.push({id:'qa019',width,grid:await mosaic.locator('.won-tile--large').evaluateAll(a=>a.map(e=>({parent:e.parentElement.outerHTML.slice(0,180),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,parentDisplay:getComputedStyle(e.parentElement).display,media:[...e.querySelectorAll('img')].map(i=>({w:i.width,h:i.height,natural:i.naturalWidth}))})))});
 await context.close();fs.writeFileSync(`${root}/interactions.json`,JSON.stringify(rows,null,2));
}
await browser.close();console.log(JSON.stringify(rows,null,2));
