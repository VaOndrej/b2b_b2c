# Native Triage Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `won-carousel` and `won-grid` to parity with the two native Horizon sections they replace, add one improvement each, then hide `product-list` and `featured-blog-posts` from the section picker.

**Architecture:** All work is additive inside `themes/won-base/**` (the portable IP layer) plus a locale merge and two entries in the compose step-2c hide list. No native Horizon file is ever overridden — that would break the Skeleton/Theme-Store track. `themes/dist/horizon-dev` is a build artefact: it is wiped and rebuilt from pristine Horizon on every `compose.mjs` run.

**Tech Stack:** Shopify Liquid sections with inline `{% schema %}` JSON, plain CSS in `{% stylesheet %}`-style `<style>` blocks inside each section, Playwright smoke tests, Node build script (`themes/build/compose.mjs`).

**Spec:** `docs/superpowers/specs/2026-08-21-native-section-triage-design.md` (Wave 1 row).

## Global Constraints

- **Never hand-edit `themes/dist/**`.** Compose step 1 does `rmSync(outDir)` then copies pristine Horizon. Source of truth is `themes/won-base/**`.
- **Compose command:** `node themes/build/compose.mjs` from the repo root, producing `themes/dist/horizon-dev`.
- **Composing wedges a running `theme dev` watcher.** After every compose, restart it: `kill $(lsof -ti tcp:9292)`, then relaunch and wait for port 9292 to answer.
- **Every new schema `id` must be referenced somewhere in `themes/won-base` source** (sections + blocks + snippets + assets) or `tests/smoke/won-settings-coverage.spec.ts` fails. That gate runs headless, no server.
- **Range `default` must be a valid step of its own `min`/`max`/`step`**, or Shopify rejects the theme upload with "default must be a step in the range".
- **Every editor label goes in BOTH `themes/won-base/locales/cs.schema.json` and `en.default.schema.json`.** Editor strings live in `*.schema.json` under the `won` root. Storefront-facing strings live in `cs.json` / `en.default.json`, also under `won`. Do not mix the two files up.
- **No overriding native Horizon files.** Permitted interventions are exactly three: additive `won-*` files, deep-merged locale fragments, and stripping `presets` from a native schema in `dist` via `HIDE_NATIVE_SECTIONS`.
- **Behavioural smoke tests need a live storefront.** `npm run test:smoke` targets `http://127.0.0.1:9292` by default and requires `shopify theme dev --store b2b-b2c-store-development.myshopify.com --path themes/dist/horizon-dev --port 9292`. Only `won-settings-coverage.spec.ts` runs without a server. A failing smoke run with `ECONNREFUSED` means the server is down, not that the code is broken.
- **The repo owner reviews before any commit and the checkout sits on `main`.** Create a branch before the first commit; do not push.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `themes/won-base/sections/won-carousel.liquid` | product/content carousel | Modify: `mobile_carousel` + `arrow_style` settings, classes, CSS |
| `themes/won-base/sections/won-grid.liquid` | blocks / articles / stats grid | Modify: `show_author` + `show_reading_time` settings, article meta render, CSS |
| `themes/won-base/locales/cs.schema.json` | Czech editor labels | Modify: new setting labels, arrow options, Horizon category overrides |
| `themes/won-base/locales/en.default.schema.json` | English editor labels | Modify: same keys |
| `themes/won-base/locales/cs.json` | Czech storefront strings | Modify: reading-time string |
| `themes/won-base/locales/en.default.json` | English storefront strings | Modify: reading-time string |
| `themes/build/compose.mjs` | build pipeline | Modify: two entries in `HIDE_NATIVE_SECTIONS` |
| `tests/smoke/won-wave1-parity.spec.ts` | behavioural proof for all Wave 1 controls | Create |

---

### Task 1: `won-carousel` — swipeable row on mobile

Closes the `carousel_on_mobile` gap against native `product-list`. Only meaningful when `layout: grid` — a `slider` already scrolls on every breakpoint.

**Files:**
- Modify: `themes/won-base/sections/won-carousel.liquid`
- Modify: `themes/won-base/locales/cs.schema.json`, `themes/won-base/locales/en.default.schema.json`
- Test: `tests/smoke/won-wave1-parity.spec.ts` (created here, extended by Tasks 2–3)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: CSS class `won-carousel--scroll-sm` on the `<won-carousel>` element; schema id `mobile_carousel` (checkbox, default `false`). Task 5 relies on this shipping before `product-list` is hidden.

- [ ] **Step 1: Add the two demo fixtures the tests assert against**

**The demo has no `layout: grid` carousel at all** — all five are `slider` or `marquee` (verified 2026-08-21). Both the positive and the negative test therefore need a fixture, or they fail on "element not attached" rather than on the behaviour under test.

This follows the repo's established pattern: demo content doubles as the behavioural test surface (the Bestsellers carousel exists partly so the dots test has real overflow). Give them real headings, not test names — the demo store is shown to clients.

In `themes/demo/horizon/templates/index.json`, inside `"sections"`, add both:

```json
"daily_grid": {
  "type": "won-carousel",
  "settings": {
    "layout": "grid",
    "source": "collection",
    "collection": "automated-collection",
    "products_limit": 8,
    "heading": "<p>Doplňky pro každý den</p>",
    "columns_desktop": 4,
    "columns_tablet": 2,
    "columns_mobile": "2",
    "mobile_carousel": true,
    "gap": 16,
    "color_scheme": "scheme-1",
    "padding_top": 56,
    "padding_bottom": 56
  }
},
"range_grid": {
  "type": "won-carousel",
  "settings": {
    "layout": "grid",
    "source": "collection",
    "collection": "automated-collection",
    "products_limit": 4,
    "heading": "<p>Celá řada</p>",
    "columns_desktop": 4,
    "columns_tablet": 2,
    "columns_mobile": "2",
    "mobile_carousel": false,
    "gap": 16,
    "color_scheme": "scheme-1",
    "padding_top": 56,
    "padding_bottom": 56
  }
}
```

`automated-collection` is the handle the existing Bestsellers carousel uses, so it is known to resolve on the demo store.

`columns_mobile` is `"2"` in both, deliberately: a fractional value like `"1.2"` adds `won-carousel--peek-mobile`, whose `flex: 0 0 76%` would confound the rail-geometry assertions.

Then insert `"daily_grid"` and `"range_grid"` into the template's `"order"` array, after `"bestsellers"`.

- [ ] **Step 2: Write the failing test**

Create `tests/smoke/won-wave1-parity.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// Wave 1 — behavioural proof that the parity controls added against the two
// hidden native sections (product-list, featured-blog-posts) actually do
// something. Static schema references are not enough: the 2026-08-11 audit
// found four settings that were referenced but whose consumer was broken.

test('grid carousel with mobile_carousel scrolls horizontally on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile-only contract');

  await page.goto('/');
  const rail = page.locator('won-carousel.won-carousel--scroll-sm .won-carousel__track').first();
  await expect(rail).toBeAttached();

  const geometry = await rail.evaluate((el) => ({
    overflowX: getComputedStyle(el).overflowX,
    display: getComputedStyle(el).display,
    scrollable: el.scrollWidth - el.clientWidth > 2,
  }));

  expect(geometry.display).toBe('flex');
  expect(geometry.overflowX).toBe('auto');
  expect(geometry.scrollable).toBe(true);
});

test('grid carousel without mobile_carousel stays a stacked grid on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile-only contract');

  await page.goto('/');
  const plain = page.locator('won-carousel.won-carousel--grid:not(.won-carousel--scroll-sm) .won-carousel__track').first();
  await expect(plain).toBeAttached();
  await expect(plain).toHaveCSS('display', 'grid');
});
```

- [ ] **Step 3: Compose and run the test to verify it fails**

```bash
node themes/build/compose.mjs
kill $(lsof -ti tcp:9292) 2>/dev/null; sleep 1
shopify theme dev --store b2b-b2c-store-development.myshopify.com --path themes/dist/horizon-dev --port 9292 &
until curl -sf http://127.0.0.1:9292 >/dev/null; do sleep 2; done
npx playwright test tests/smoke/won-wave1-parity.spec.ts --project=mobile --reporter=list
```

Expected: FAIL — the first test errors because no element matches `won-carousel.won-carousel--scroll-sm` (the class does not exist yet).

- [ ] **Step 4: Add the schema setting**

In `themes/won-base/sections/won-carousel.liquid`, in the `{% schema %}` `settings` array, immediately after the `columns_mobile` entry, insert:

```json
{ "type": "checkbox", "id": "mobile_carousel", "label": "t:won.settings.mobile_carousel", "info": "t:won.info.mobile_carousel", "default": false, "visible_if": "{{ section.settings.layout == 'grid' }}" },
```

Both locale keys already exist — `won-grid` uses them — so no locale change is needed for this setting.

- [ ] **Step 5: Emit the class**

In the same file, on the `<won-carousel>` element (around line 46), change:

```liquid
      class="won-carousel won-carousel--{{ s.layout }}{% if fits %} won-carousel--fits{% endif %}{% if s.columns_mobile contains '.' %} won-carousel--peek-mobile{% endif %}"
```

to:

```liquid
      class="won-carousel won-carousel--{{ s.layout }}{% if fits %} won-carousel--fits{% endif %}{% if s.columns_mobile contains '.' %} won-carousel--peek-mobile{% endif %}{% if s.layout == 'grid' and s.mobile_carousel %} won-carousel--scroll-sm{% endif %}"
```

- [ ] **Step 6: Add the CSS**

In the same file's `<style>` block, immediately after the `.won-carousel--grid .won-carousel__track { ... }` rule (around line 117–122), add:

```css
  /* Grid layout that becomes a single swipeable rail on phones. Mirrors
     won-grid's .won-grid--scroll-sm so the two sections behave identically.
     Must out-specify .won-carousel--grid .won-carousel__track above, hence the
     doubled class. */
  @media (max-width: 749px) {
    .won-carousel--scroll-sm.won-carousel--scroll-sm .won-carousel__track {
      display: flex;
      flex-wrap: nowrap;
      grid-template-columns: none;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .won-carousel--scroll-sm .won-carousel__track::-webkit-scrollbar { display: none; }
    .won-carousel--scroll-sm .won-carousel__track > * {
      flex: 0 0 82%;
      scroll-snap-align: start;
    }
  }
```

- [ ] **Step 7: Recompose, restart the watcher, run the test**

```bash
node themes/build/compose.mjs
kill $(lsof -ti tcp:9292) 2>/dev/null; sleep 1
shopify theme dev --store b2b-b2c-store-development.myshopify.com --path themes/dist/horizon-dev --port 9292 &
until curl -sf http://127.0.0.1:9292 >/dev/null; do sleep 2; done
npx playwright test tests/smoke/won-wave1-parity.spec.ts --project=mobile --reporter=list
```

Expected: PASS, 2 passed.

- [ ] **Step 8: Run the settings-coverage gate**

```bash
npx playwright test tests/smoke/won-settings-coverage.spec.ts --project=desktop --reporter=list
```

Expected: PASS — `mobile_carousel` is now referenced in `won-carousel.liquid`.

- [ ] **Step 9: Commit**

```bash
git add themes/won-base/sections/won-carousel.liquid themes/demo/horizon/templates/index.json tests/smoke/won-wave1-parity.spec.ts
git commit -m "feat(won-carousel): swipeable row on mobile for grid layout (product-list parity)"
```

---

### Task 2: `won-carousel` — arrow style

Closes the `icons_style` / `icons_shape` gap against native `product-list`, collapsing two native controls into one (replacement contract, condition 3).

**Files:**
- Modify: `themes/won-base/sections/won-carousel.liquid`
- Modify: `themes/won-base/locales/cs.schema.json`, `themes/won-base/locales/en.default.schema.json`
- Test: `tests/smoke/won-wave1-parity.spec.ts`

**Interfaces:**
- Consumes: `tests/smoke/won-wave1-parity.spec.ts` from Task 1.
- Produces: schema id `arrow_style` (select: `chevron` | `circle` | `square` | `minimal`, default `chevron`); CSS class `won-carousel__arrow--<value>` on both arrow buttons.

- [ ] **Step 1: Write the failing test**

Append to `tests/smoke/won-wave1-parity.spec.ts`:

```ts
test('carousel arrows carry their style modifier class', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop-only contract');

  await page.goto('/');
  const arrow = page.locator('.won-carousel__arrow').first();
  await expect(arrow).toBeAttached();

  const className = await arrow.getAttribute('class');
  expect(className).toMatch(/won-carousel__arrow--(chevron|circle|square|minimal)/);

  // Non-vacuous: the modifier must actually change rendering, not just exist.
  const shape = await arrow.evaluate((el) => getComputedStyle(el).borderRadius);
  expect(shape).not.toBe('');
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx playwright test tests/smoke/won-wave1-parity.spec.ts --project=desktop --reporter=list -g "style modifier"
```

Expected: FAIL — `className` has no `won-carousel__arrow--*` modifier.

- [ ] **Step 3: Add the schema setting**

In `themes/won-base/sections/won-carousel.liquid`, in the `{% schema %}` `settings` array, immediately after the `show_arrows` entry (around line 257), insert:

```json
{
  "type": "select", "id": "arrow_style", "label": "t:won.settings.arrow_style",
  "options": [
    { "value": "chevron", "label": "t:won.options.arrow_chevron" },
    { "value": "circle", "label": "t:won.options.arrow_circle" },
    { "value": "square", "label": "t:won.options.arrow_square" },
    { "value": "minimal", "label": "t:won.options.arrow_minimal" }
  ],
  "default": "chevron",
  "visible_if": "{{ section.settings.layout == 'slider' and section.settings.show_arrows }}"
},
```

- [ ] **Step 4: Add the locale keys**

In `themes/won-base/locales/cs.schema.json`, add to `won.settings`:

```json
"arrow_style": "Styl šipek",
```

and to `won.options`:

```json
"arrow_chevron": "Šipka",
"arrow_circle": "Kolečko",
"arrow_square": "Čtvereček",
"arrow_minimal": "Bez pozadí",
```

In `themes/won-base/locales/en.default.schema.json`, add to `won.settings`:

```json
"arrow_style": "Arrow style",
```

and to `won.options`:

```json
"arrow_chevron": "Chevron",
"arrow_circle": "Circle",
"arrow_square": "Square",
"arrow_minimal": "Borderless",
```

- [ ] **Step 5: Emit the modifier class**

In `themes/won-base/sections/won-carousel.liquid` (around lines 67–68), change both buttons:

```liquid
            <button type="button" class="won-carousel__arrow won-carousel__arrow--{{ s.arrow_style }}" data-won-prev aria-label="{{ 'won.a11y.previous' | t }}"><span aria-hidden="true">‹</span></button>
            <button type="button" class="won-carousel__arrow won-carousel__arrow--{{ s.arrow_style }}" data-won-next aria-label="{{ 'won.a11y.next' | t }}"><span aria-hidden="true">›</span></button>
```

- [ ] **Step 6: Add the CSS**

In the same file's `<style>` block, immediately after `.won-carousel__arrow:disabled { ... }` (around line 140), add:

```css
  .won-carousel__arrow--chevron { border-radius: var(--won-radius-sm, 8px); }
  .won-carousel__arrow--circle { border-radius: 999px; }
  .won-carousel__arrow--square { border-radius: 0; }
  .won-carousel__arrow--minimal {
    border-radius: 0;
    border-color: transparent;
    background: transparent;
  }
```

- [ ] **Step 7: Recompose, restart the watcher, run the test**

```bash
node themes/build/compose.mjs
kill $(lsof -ti tcp:9292) 2>/dev/null; sleep 1
shopify theme dev --store b2b-b2c-store-development.myshopify.com --path themes/dist/horizon-dev --port 9292 &
until curl -sf http://127.0.0.1:9292 >/dev/null; do sleep 2; done
npx playwright test tests/smoke/won-wave1-parity.spec.ts --project=desktop --reporter=list
```

Expected: PASS.

- [ ] **Step 8: Run the settings-coverage gate**

```bash
npx playwright test tests/smoke/won-settings-coverage.spec.ts --project=desktop --reporter=list
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add themes/won-base/sections/won-carousel.liquid themes/won-base/locales/cs.schema.json themes/won-base/locales/en.default.schema.json tests/smoke/won-wave1-parity.spec.ts
git commit -m "feat(won-carousel): arrow_style select (product-list icons_style parity, 2 controls -> 1)"
```

---

### Task 3: `won-grid` — article author and reading time

The improvement that satisfies replacement-contract condition 2 for `featured-blog-posts`. Author and reading-time are E-E-A-T signals; the native has neither.

**Files:**
- Modify: `themes/won-base/sections/won-grid.liquid`
- Modify: `themes/won-base/locales/cs.schema.json`, `themes/won-base/locales/en.default.schema.json`
- Modify: `themes/won-base/locales/cs.json`, `themes/won-base/locales/en.default.json`
- Test: `tests/smoke/won-wave1-parity.spec.ts`

**Interfaces:**
- Consumes: `tests/smoke/won-wave1-parity.spec.ts` from Task 1.
- Produces: schema ids `show_author`, `show_reading_time` (both checkbox, default `false`); CSS classes `won-grid__article-author`, `won-grid__article-readtime`; storefront locale key `won.article.reading_time`.

- [ ] **Step 1: Turn the settings on in the demo**

`themes/demo/horizon/templates/index.json` already has an articles grid — section key `articles`, `"source": "articles"`, blog `news`, `articles_limit: 3` (verified 2026-08-21). No new fixture is needed; just extend its `settings` object with:

```json
"show_author": true,
"show_reading_time": true
```

The resulting `settings` object should read:

```json
{
  "heading": "<p>Z našeho blogu</p>",
  "head_link_label": "Všechny články",
  "blog": "news",
  "articles_limit": 3,
  "columns_desktop": 3,
  "color_scheme": "scheme-1",
  "padding_top": 56,
  "padding_bottom": 56,
  "source": "articles",
  "article_layout": "grid",
  "show_author": true,
  "show_reading_time": true
}
```

Note that `show_date` and `show_excerpt` are **not** in this section's settings, so they fall back to their schema defaults of `true`. The author separator CSS in Step 8 must therefore tolerate a date being present.

- [ ] **Step 2: Write the failing test**

Append to `tests/smoke/won-wave1-parity.spec.ts`:

```ts
test('article cards render author and reading time when enabled', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop-only contract');

  await page.goto('/');
  const card = page.locator('.won-grid__article').first();
  await expect(card).toBeAttached();

  await expect(card.locator('.won-grid__article-author')).toHaveCount(1);

  const readtime = card.locator('.won-grid__article-readtime');
  await expect(readtime).toHaveCount(1);

  // Non-vacuous: reading time must be a real computed number, never "0".
  const text = (await readtime.innerText()).trim();
  expect(text).not.toBe('');
  expect(text).toMatch(/[1-9]/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx playwright test tests/smoke/won-wave1-parity.spec.ts --project=desktop --reporter=list -g "author and reading time"
```

Expected: FAIL — `.won-grid__article-author` has count 0.

- [ ] **Step 4: Add the schema settings**

In `themes/won-base/sections/won-grid.liquid`, in the `{% schema %}` `settings` array, immediately after the `show_excerpt` entry (around line 220), insert:

```json
{ "type": "checkbox", "id": "show_author", "label": "t:won.settings.show_author", "info": "t:won.info.show_author", "default": false, "visible_if": "{{ section.settings.source == 'articles' }}" },
{ "type": "checkbox", "id": "show_reading_time", "label": "t:won.settings.show_reading_time", "info": "t:won.info.show_reading_time", "default": false, "visible_if": "{{ section.settings.source == 'articles' }}" },
```

- [ ] **Step 5: Add the editor locale keys**

In `themes/won-base/locales/cs.schema.json`, add to `won.settings`:

```json
"show_author": "Zobrazit autora",
"show_reading_time": "Zobrazit dobu čtení",
```

and to `won.info`:

```json
"show_author": "Vypíše autora článku pod nadpisem. Prázdné pole autora se přeskočí, nezobrazí se prázdné místo.",
"show_reading_time": "Odhad z počtu slov (200 slov za minutu), zaokrouhleno nahoru na celou minutu.",
```

In `themes/won-base/locales/en.default.schema.json`, add to `won.settings`:

```json
"show_author": "Show author",
"show_reading_time": "Show reading time",
```

and to `won.info`:

```json
"show_author": "Prints the article author under the title. A blank author is skipped, so no empty slot appears.",
"show_reading_time": "Estimated from word count (200 words per minute), rounded up to a whole minute.",
```

- [ ] **Step 6: Add the storefront locale key**

In `themes/won-base/locales/cs.json`, add a new `article` group under `won`:

```json
"article": {
  "reading_time": "{{ minutes }} min čtení"
},
```

In `themes/won-base/locales/en.default.json`:

```json
"article": {
  "reading_time": "{{ minutes }} min read"
},
```

- [ ] **Step 7: Render author and reading time**

In `themes/won-base/sections/won-grid.liquid`, immediately after the `show_date` line (around line 88), insert:

```liquid
                {%- if s.show_author and article.author != blank -%}<span class="won-grid__article-author">{{ article.author }}</span>{%- endif -%}
                {%- if s.show_reading_time -%}
                  {%- assign won_rt_words = article.content | strip_html | split: ' ' | size -%}
                  {%- assign won_rt_mins = won_rt_words | divided_by: 200 | at_least: 1 -%}
                  <span class="won-grid__article-readtime">{{ 'won.article.reading_time' | t: minutes: won_rt_mins }}</span>
                {%- endif -%}
```

`at_least: 1` is what keeps a short article from rendering "0 min čtení" — the non-vacuous assertion in Step 2 guards exactly this.

- [ ] **Step 8: Add the CSS**

In the same file's `<style>` block, next to the existing `.won-grid__article-date` rule, add:

```css
    .won-grid__article-author,
    .won-grid__article-readtime {
      font-size: 0.82rem;
      opacity: 0.7;
    }
    .won-grid__article-author + .won-grid__article-readtime::before {
      content: '·';
      margin: 0 0.4em;
    }
```

- [ ] **Step 9: Recompose, restart the watcher, run the test**

```bash
node themes/build/compose.mjs
kill $(lsof -ti tcp:9292) 2>/dev/null; sleep 1
shopify theme dev --store b2b-b2c-store-development.myshopify.com --path themes/dist/horizon-dev --port 9292 &
until curl -sf http://127.0.0.1:9292 >/dev/null; do sleep 2; done
npx playwright test tests/smoke/won-wave1-parity.spec.ts --project=desktop --reporter=list
```

Expected: PASS.

- [ ] **Step 10: Run the settings-coverage gate**

```bash
npx playwright test tests/smoke/won-settings-coverage.spec.ts --project=desktop --reporter=list
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add themes/won-base/sections/won-grid.liquid themes/won-base/locales/ themes/demo/horizon/templates/ tests/smoke/won-wave1-parity.spec.ts
git commit -m "feat(won-grid): article author + reading time (E-E-A-T signals featured-blog-posts lacks)"
```

---

### Task 4: Rename the Horizon picker categories

Won and Horizon both render `Produkty` and `Rozvržení` in the Czech section picker, so the merchant sees two identically-named groups and cannot tell which carries Won's rules. Fixed by a locale merge, which compose already performs — not by touching a Horizon file.

**Files:**
- Modify: `themes/won-base/locales/cs.schema.json`, `themes/won-base/locales/en.default.schema.json`
- Test: verified against the composed output, no server needed

**Interfaces:**
- Consumes: nothing.
- Produces: top-level `categories` key in each won schema locale fragment. `deepMerge` in `compose.mjs` overwrites leaf values, so these win over Horizon's.

- [ ] **Step 1: Write the failing check**

Create `tests/smoke/won-category-labels.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The composed locale must not present two identically-labelled picker groups.
// Won's five categories live under `won.categories`; Horizon's under
// `categories`. A collision means the merchant sees two groups with the same
// name and cannot tell which one carries Won's rules.

const LOCALES = ['cs.schema.json', 'en.default.schema.json'];

for (const file of LOCALES) {
  test(`composed ${file} has no duplicate picker category labels`, () => {
    const raw = readFileSync(join('themes/dist/horizon-dev/locales', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,(\s*[}\]])/g, '$1');
    const data = JSON.parse(raw);

    const wonLabels: string[] = Object.values(data.won?.categories ?? {});
    const horizonLabels: string[] = Object.values(data.categories ?? {});

    expect(wonLabels.length).toBeGreaterThan(0);
    expect(horizonLabels.length).toBeGreaterThan(0);

    const collisions = wonLabels.filter((l) => horizonLabels.includes(l));
    expect(collisions, `labels shared by Won and Horizon: ${collisions.join(', ')}`).toEqual([]);
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node themes/build/compose.mjs
npx playwright test tests/smoke/won-category-labels.spec.ts --project=desktop --reporter=list
```

Expected: FAIL, twice — collisions `Produkty, Rozvržení` in `cs.schema.json` and `Products, Layout` in `en.default.schema.json`.

- [ ] **Step 3: Override the Horizon labels from the won fragment**

In `themes/won-base/locales/cs.schema.json`, add a new **top-level** key next to `won` (not inside it):

```json
"categories": {
  "products": "Produkty (Horizon)",
  "layout": "Rozvržení (Horizon)"
},
```

In `themes/won-base/locales/en.default.schema.json`:

```json
"categories": {
  "products": "Products (Horizon)",
  "layout": "Layout (Horizon)"
},
```

Only these two keys collide. Leave every other Horizon category alone — `deepMerge` overwrites only the keys present in the fragment.

- [ ] **Step 4: Recompose and run the check**

```bash
node themes/build/compose.mjs
npx playwright test tests/smoke/won-category-labels.spec.ts --project=desktop --reporter=list
```

Expected: PASS, 2 passed.

- [ ] **Step 5: Verify Won's own categories are untouched**

```bash
python3 -c "
import json
d=json.load(open('themes/dist/horizon-dev/locales/cs.schema.json'))
print('won:', d['won']['categories'])
print('horizon products/layout:', d['categories']['products'], '/', d['categories']['layout'])
"
```

Expected: `won:` still shows the five original labels (`Produkty`, `Obsah`, `Rozvržení`, `Aplikace`, `Hero`); Horizon shows the two suffixed labels.

- [ ] **Step 6: Commit**

```bash
git add themes/won-base/locales/cs.schema.json themes/won-base/locales/en.default.schema.json tests/smoke/won-category-labels.spec.ts
git commit -m "fix(won-theme): stop Won and Horizon picker categories sharing a label"
```

---

### Task 5: Hide `product-list` and `featured-blog-posts`

The wave's payoff. Runs **last** and only after Tasks 1–3 are green: the spec's invariant is that a native is never hidden before its replacement ships.

**Files:**
- Modify: `themes/build/compose.mjs:HIDE_NATIVE_SECTIONS`
- Test: `tests/smoke/won-hidden-natives.spec.ts` (create)

**Interfaces:**
- Consumes: `won-carousel.mobile_carousel` and `arrow_style` (Tasks 1–2), `won-grid.show_author` and `show_reading_time` (Task 3).
- Produces: nothing downstream in Wave 1. Wave 2 adds `product-hotspots` to the same list; Wave 3 adds `product-recommendations`.

- [ ] **Step 1: Write the failing test**

Create `tests/smoke/won-hidden-natives.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A native section is "hidden from the picker" when compose step 2c strips its
// `presets` array. The file must still exist and still render — templates that
// already reference it keep working. This guards both halves.

const HIDDEN = ['product-list', 'featured-blog-posts'];

for (const name of HIDDEN) {
  test(`${name} is hidden from the section picker but still renders`, () => {
    const src = readFileSync(join('themes/dist/horizon-dev/sections', `${name}.liquid`), 'utf8');

    expect(src.length, `${name}.liquid must still exist and be non-empty`).toBeGreaterThan(0);
    expect(src, `${name} must keep its schema`).toContain('{% schema %}');
    expect(src, `${name} must have no presets left`).not.toContain('"presets"');
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node themes/build/compose.mjs
npx playwright test tests/smoke/won-hidden-natives.spec.ts --project=desktop --reporter=list
```

Expected: FAIL, twice — both files still contain `"presets"`.

- [ ] **Step 3: Add the two entries**

In `themes/build/compose.mjs`, extend `HIDE_NATIVE_SECTIONS`, keeping the existing `-> won-*` comment convention:

```js
const HIDE_NATIVE_SECTIONS = [
  'hero',            // -> won-hero
  'carousel',        // -> won-carousel
  'marquee',         // -> won-marquee
  'slideshow',       // -> won-hero-carousel
  'layered-slideshow', // -> won-hero-carousel / won-hero-grid
  'media-with-content', // -> won-band
  'collection-list', // -> won-collection / won-collection-tiles
  'collection-links', // -> won-collection-tiles
  'product-list',    // -> won-carousel (layout: grid, source: collection)
  'featured-blog-posts', // -> won-grid (source: articles)
];
```

- [ ] **Step 4: Recompose and run the test**

```bash
node themes/build/compose.mjs
npx playwright test tests/smoke/won-hidden-natives.spec.ts --project=desktop --reporter=list
```

Expected: PASS, 2 passed. The compose log line should now read `10 native duplicate sections hidden from picker`.

- [ ] **Step 5: Run the whole headless gate**

```bash
npx playwright test tests/smoke/won-settings-coverage.spec.ts tests/smoke/won-category-labels.spec.ts tests/smoke/won-hidden-natives.spec.ts --project=desktop --reporter=list
```

Expected: PASS, all green.

- [ ] **Step 6: Run the full smoke suite against the live storefront**

```bash
kill $(lsof -ti tcp:9292) 2>/dev/null; sleep 1
shopify theme dev --store b2b-b2c-store-development.myshopify.com --path themes/dist/horizon-dev --port 9292 &
until curl -sf http://127.0.0.1:9292 >/dev/null; do sleep 2; done
npm run test:smoke
```

Expected: PASS across desktop and mobile projects. If anything that previously passed now fails, it is a regression from this wave — fix it before continuing.

- [ ] **Step 7: Run the theme upload gate**

```bash
shopify theme push --path themes/dist/horizon-dev --theme 161463730417 --json | python3 -c "import json,sys; print(json.load(sys.stdin).get('theme',{}).get('errors','no errors'))"
```

Expected: `no errors`. This catches server-only schema errors the MCP validator misses — duplicate `content_for 'blocks'`, preset settings outside a block's range, and range defaults that are not a step of their own range.

- [ ] **Step 8: Commit**

```bash
git add themes/build/compose.mjs tests/smoke/won-hidden-natives.spec.ts
git commit -m "feat(won-theme): hide product-list + featured-blog-posts now that won equivalents are at parity"
```

---

## Wave 1 exit criteria

- [ ] `won-carousel` has `mobile_carousel` and `arrow_style`, both behaviourally proven
- [ ] `won-grid` has `show_author` and `show_reading_time`, both behaviourally proven
- [ ] Won and Horizon picker categories no longer share a label in `cs` or `en`
- [ ] `product-list` and `featured-blog-posts` are gone from the picker, files intact
- [ ] `won-settings-coverage.spec.ts` green — no dead settings introduced
- [ ] `npm run test:smoke` green on both projects
- [ ] `shopify theme push --json` reports no theme errors

## Out of scope for this wave

- `won-shoppable-image` overlay / pin style / mobile fallback — Wave 2
- `won-recommendations` and its five source blocks — Wave 3
- `layout_type: editorial` — deliberately skipped, see the spec's Non-goals
- Any change to `quick-order-list`, `featured-product`, `featured-product-information`, `custom-liquid`, `divider` — all kept native
