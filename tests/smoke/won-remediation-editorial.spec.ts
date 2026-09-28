import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync('themes/won-base/examples/qa/manifest.json', 'utf8'));
async function open(page: any, id: string) {
  const c = manifest.cases.find((c: any) => c.id === id);
  expect((await page.goto(c.url))?.status()).toBe(200);
  expect(await page.evaluate(() => (window as any).Shopify.shop)).toBe('b2b-b2c-store-development.myshopify.com');
  return page.locator(c.selector);
}
test.describe('Won remediation editorial', () => {
  test.skip(process.env.WON_REMEDIATION_QA !== '1', 'Opt-in QA fixtures');
  for (const width of [390, 768, 1440]) {
    test(`column ratios preserve width and DOM order at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      for (const [id, ratio] of [['qa177', 1], ['qa178', 2/3], ['qa179', 3/2]] as const) {
        const section = await open(page, id);
        const children = section.locator('.won-group > .won-group__items > .shopify-block');
        const a = await children.nth(0).boundingBox(), b = await children.nth(1).boundingBox();
        expect(a).not.toBeNull(); expect(b).not.toBeNull();
        if (width === 390) {
          expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
          expect(Math.abs(a!.width - b!.width)).toBeLessThan(1);
        } else {
          expect(Math.abs(a!.y-b!.y)).toBeLessThan(1);
          expect(Math.abs(a!.width/b!.width-ratio)).toBeLessThan(0.02);
        }
      }
    });
    test(`table state labels and real picker targets at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const section = await open(page, 'qa156');
      const toggle = section.locator('.won-vp__table-toggle');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const show = await toggle.textContent();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle).not.toHaveText(show!);
      expect(await toggle.getAttribute('data-hide-label')).toBe((await toggle.textContent())?.trim());
      const controls = section.locator('.won-vp__qty-btn, .won-vp__table-toggle, .won-vp__table-pick, .won-vp__swatch');
      for (const c of await controls.all()) if(await c.isVisible()) {
        const b = await c.boundingBox(); expect(b!.width).toBeGreaterThanOrEqual(44); expect(b!.height).toBeGreaterThanOrEqual(44);
      }
      await toggle.focus(); await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded','false'); await expect(toggle).toHaveText(show!);
    });
    test(`independent light surfaces and visible circle at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const light = (await open(page,'qa157')).locator('.won-slide');
      const style = await light.evaluate((e: Element) => ({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color,shadow:getComputedStyle(e).boxShadow}));
      expect(style.background).toBe('rgb(255, 255, 255)'); expect(style.color).not.toBe(style.background); expect(style.shadow).toBe('none');
      const arrow = (await open(page,'qa161')).locator('.won-rail__arrow--surface:not([disabled])').first();
      if (await arrow.isVisible()) {
        const contrast = await arrow.evaluate((e: Element) => {
          const luminance = (color: string) => {
            const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
            return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
          };
          const a=luminance(getComputedStyle(e).color), b=luminance(getComputedStyle(e).backgroundColor);
          return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        });
        expect(contrast, 'chevron contrast against its own circular surface').toBeGreaterThanOrEqual(3);
      }
      const circle = (await open(page,'qa102')).locator('.won-slide__heading');
      const paint = await circle.evaluate((e: Element) => ({isolation:getComputedStyle(e).isolation,mask:getComputedStyle(e,'::before').maskImage,background:getComputedStyle(e,'::before').backgroundColor}));
      expect(paint.isolation).toBe('isolate'); expect(paint.mask).toContain('svg'); expect(paint.background).not.toBe('rgba(0, 0, 0, 0)');
    });
  }
});
