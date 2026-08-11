import { test, expect } from '@playwright/test';

// W3-b Universal Customization Layer — storefront CSS contract.
// snippets/won-style-vars.liquid emits --won-* custom properties on a won
// section root; assets/won-tokens.css must consume them so a merchant control
// visibly changes the storefront with zero per-section CSS. These assertions
// are RED before the won-tokens.css contract exists (computed border/shadow
// stay at their no-op defaults) and GREEN after. Viewport-independent checks
// run in both projects; the responsive-visibility check branches on width.

test('won sections are wired to the shared style-vars pipeline', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.won-section', { state: 'attached' });
  // At least one section root must carry won-style-vars output (padding tokens),
  // proving the render pipeline (won-spacing -> won-style-vars superset) is wired.
  const hasPaddingVar = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.won-section')).some((el) =>
      (el.getAttribute('style') || '').includes('--won-pt')
    )
  );
  expect(hasPaddingVar).toBe(true);
});

test('won-tokens.css consumes the universal border/shadow/radius vars', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.won-section', { state: 'attached' });

  const computed = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.won-section');
    if (!el) return null;
    el.style.setProperty('--won-border-width', '6px');
    el.style.setProperty('--won-border-style', 'solid');
    el.style.setProperty('--won-border-color', 'rgb(255, 0, 0)');
    el.style.setProperty('--won-section-radius', '20px');
    el.style.setProperty('--won-shadow', '0px 6px 18px rgba(0,0,0,0.5)');
    const cs = getComputedStyle(el);
    return {
      borderTopWidth: cs.borderTopWidth,
      borderTopStyle: cs.borderTopStyle,
      borderTopLeftRadius: cs.borderTopLeftRadius,
      boxShadow: cs.boxShadow,
    };
  });

  expect(computed).not.toBeNull();
  expect(computed!.borderTopWidth).toBe('6px');
  expect(computed!.borderTopStyle).toBe('solid');
  expect(computed!.borderTopLeftRadius).toBe('20px');
  expect(computed!.boxShadow).not.toBe('none');
});

test('won-tokens.css consumes the Tier 2 typography + motion vars', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.won-section', { state: 'attached' });

  const computed = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.won-section');
    if (!el) return null;
    el.style.setProperty('--won-letter-spacing', '0.08em');
    el.style.setProperty('--won-text-transform', 'uppercase');
    el.style.setProperty('--won-anim', 'won-anim-fade');
    const cs = getComputedStyle(el);
    return {
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      animationName: cs.animationName,
    };
  });

  expect(computed).not.toBeNull();
  // 0.08em against the section font-size resolves to a non-zero px letter-spacing.
  expect(computed!.letterSpacing).not.toBe('normal');
  expect(computed!.textTransform).toBe('uppercase');
  // The keyframes must exist and be wired (not 'none') when animate_in is set.
  expect(computed!.animationName).toBe('won-anim-fade');
});

test('per-section bg/text color override wins over the color scheme', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.won-section', { state: 'attached' });

  const computed = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.won-section');
    if (!el) return null;
    const before = getComputedStyle(el).backgroundColor;
    el.style.setProperty('--won-section-bg', 'rgb(10, 20, 30)');
    el.style.setProperty('--won-text-color', 'rgb(200, 210, 220)');
    const cs = getComputedStyle(el);
    return { before, background: cs.backgroundColor, color: cs.color };
  });

  expect(computed).not.toBeNull();
  // Override must win over the scheme's `.color-<id>` background rule.
  expect(computed!.background).toBe('rgb(10, 20, 30)');
  expect(computed!.color).toBe('rgb(200, 210, 220)');
});

test('won-tokens.css consumes the Tier 3 advanced overrides', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.won-section', { state: 'attached' });

  const computed = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.won-section');
    if (!el) return null;
    el.style.setProperty('--won-pad-inline', '48px');
    el.style.setProperty('--won-section-opacity', '0.5');
    el.style.setProperty('--won-shadow', '0px 10px 40px rgba(0,0,0,0.4)');
    const cs = getComputedStyle(el);
    return { paddingLeft: cs.paddingLeft, opacity: cs.opacity, boxShadow: cs.boxShadow };
  });

  expect(computed).not.toBeNull();
  expect(computed!.paddingLeft).toBe('48px');
  expect(computed!.opacity).toBe('0.5');
  // custom_shadow raw string flows through the same --won-shadow var.
  expect(computed!.boxShadow).not.toBe('none');
});

test('editor coaching never leaks to the live storefront', async ({ page }) => {
  // won-guard notes are gated on request.design_mode (true only in the theme
  // editor). On the live storefront they must never render — a shopper must
  // never see a merchant coaching note.
  for (const path of ['/', '/products/the-collection-snowboard-hydrogen']) {
    await page.goto(path);
    await page.waitForSelector('main', { state: 'attached' });
    const leaked = await page.locator('.won-editor-note, .won-editor-notes').count();
    expect(leaked, `coaching note leaked on ${path}`).toBe(0);
  }
});

test('responsive visibility var hides the section at the active breakpoint', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForSelector('.won-section', { state: 'attached' });
  const isMobile = (page.viewportSize()?.width ?? 0) < 750;
  const varName = isMobile ? '--won-d-m' : '--won-d-d';

  const display = await page.evaluate((v) => {
    const el = document.querySelector<HTMLElement>('.won-section');
    if (!el) return null;
    el.style.setProperty(v, 'none');
    return getComputedStyle(el).display;
  }, varName);

  expect(display, `${varName} @ ${testInfo.project.name}`).toBe('none');
});
