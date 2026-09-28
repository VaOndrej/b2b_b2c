import { chromium } from 'playwright';
import fs from 'node:fs';
const out='tmp/theme-audit-runs/2026-09-10-catalog';
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});
const result={};
await page.goto('http://127.0.0.1:9292/pages/contact?view=won-qa-page-12');
for (const id of ['qa157','qa158']) {const s=page.locator(`[id$="__${id}"]`);await s.scrollIntoViewIfNeeded();await s.locator('img').evaluateAll(async a=>Promise.all(a.map(i=>i.decode().catch(()=>{}))));await s.screenshot({path:`${out}/${id}-before-1440.png`});result[id]=await s.evaluate(e=>[...e.querySelectorAll('img,.won-slide,.won-slide__body,.won-slide__heading,.won-slide__text')].map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width,color:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor})));}
const range=page.locator('[id$="__qa158"] input[type=range]');await range.focus();await page.keyboard.press('ArrowRight');result.compareKeyboard=await range.inputValue();
await page.goto('http://127.0.0.1:9292/pages/contact?view=won-qa-page-10');const video=page.locator('[id$="__qa128"]');await video.scrollIntoViewIfNeeded();result.video={text:await video.innerText(),iframes:await video.locator('iframe').evaluateAll(a=>a.map(i=>i.src)),html:await video.locator('.won-video__frame').innerHTML()};await video.screenshot({path:`out/video.png`.replace('out',out)});
await page.goto('http://127.0.0.1:9292/products/the-videographer-snowboard?view=won-qa-editorial');
result.identity=await page.evaluate(()=>({shop:window.Shopify.shop,theme:window.Shopify.theme}));
const product=await(await page.request.get('http://127.0.0.1:9292/products/the-videographer-snowboard.js')).json();
const variants=product.variants.filter(v=>v.available);const target=variants[1];const picker=page.locator('variant-picker').first();const form=page.locator('form[data-type="add-to-cart-form"]').first();
result.initialPrice=await page.locator('product-price').first().innerText();await picker.locator('label').filter({hasText:target.option1}).click();await page.waitForFunction(id=>document.querySelector('form[data-type="add-to-cart-form"] input[name="id"]').value===String(id),target.id);
result.selected={expected:target.id,actual:await form.locator('input[name=id]').inputValue(),price:await page.locator('product-price').first().innerText(),expectedPrice:target.price};
const before=await(await page.request.get('http://127.0.0.1:9292/cart.js')).json();const prior=before.items.find(i=>i.variant_id===target.id)?.quantity||0;
try{await form.locator('button[type=submit]').click();await page.waitForFunction(async x=>{let c=await(await fetch('/cart.js')).json();return c.items.find(i=>i.variant_id===x.id)?.quantity===x.q},{id:target.id,q:prior+1});result.cartAdded=true;}finally{let r=await page.request.post('http://127.0.0.1:9292/cart/change.js',{data:{id:String(target.id),quantity:prior}});result.cartRestoreStatus=r.status();result.cartRestored=(await(await page.request.get('http://127.0.0.1:9292/cart.js')).json()).items.map(i=>({id:i.variant_id,quantity:i.quantity}));result.cartBefore=before.items.map(i=>({id:i.variant_id,quantity:i.quantity}));}
await page.screenshot({path:`${out}/native-selected-1440.png`});
await page.goto('http://127.0.0.1:9292/products/the-out-of-stock-snowboard?view=won-qa-editorial');const submit=page.locator('form[data-type="add-to-cart-form"] button[type=submit]').first();result.soldOut={disabled:await submit.isDisabled(),label:await submit.innerText()};await page.screenshot({path:`${out}/native-soldout-1440.png`});
fs.writeFileSync(`${out}/targeted.json`,JSON.stringify(result,null,2));await browser.close();console.log(result);
