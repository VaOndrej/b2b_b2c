# Editorial PDP implementation report — 2026-09-10

## Source and delivery

Source: `/Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/themes/won-base`.
The existing composition pipeline overlays these files on Horizon; the generic consumer
needs no bespoke Liquid/CSS patch. No upstream Horizon/Skeleton or generic consumer files
were edited. Pre-existing won-grid article-rail and won-shoppable-image fixes were preserved.

## Reuse and additions

- Extended **won-slide**: split testimonial (media/content, reviewer, 0–5 half-step rating)
  and expert portrait (caption overlay, role, existing heading/body). Neutral missing-image
  placeholders for these variants; independent card color scheme.
- Extended **won-feature**: numbered benefit and statistic; number/value, size, marker color,
  bare or disc icon treatment. Existing uploaded icons and shared SVG fallback remain.
- Extended **won-tile**: label below media, preserving the overlay default.
- Extended **won-panel / won-panels**: editorial and boxed disclosures, two-column FAQ preset;
  native keyboard-accessible details/summary and existing tabs runtime reused. Block styles
  now travel with nested panels rather than depending on a rendered panels section.
- Extended **won-delivery-note**: plain compact row; card default unchanged.
- Added **won-group**: reusable nested content columns; existing section alone cannot keep
  a stack of benefits beside an independently editable expert card. One to four desktop
  columns, one or two mobile columns, spacing tokens, alignment and optional scheme.
- Added **won-product-card**: merchant product selection wrapper around the existing shared
  card; no duplicate price, badge, media or cart implementation.
- Added **won-product-meta**: optional badge plus real vendor/type from the current product.
- Added **won-product-offer**: marketing frame around native controls, optional offer badge
  and outline; no product form, discount calculation or JavaScript replacement.
- Added section presets: editorial columns, split reviews and two-column FAQ.

Native gallery, variant picker, price, buy buttons, description and existing unit-price
metafield rules remain authoritative. Settings permit standard Shopify dynamic-source
connections; no metafield definitions or discounts were created. Rating text in manual
reviews does not emit product AggregateRating metadata.

## Exact changed source files

Under `themes/won-base/`:

- `blocks/won-delivery-note.liquid`
- `blocks/won-feature.liquid`
- `blocks/won-group.liquid` (new)
- `blocks/won-panel.liquid`
- `blocks/won-product-card.liquid` (new)
- `blocks/won-product-meta.liquid` (new)
- `blocks/won-product-offer.liquid` (new)
- `blocks/won-slide.liquid`
- `blocks/won-tile.liquid`
- `sections/won-carousel.liquid`
- `sections/won-grid.liquid` (existing unrelated changes preserved)
- `sections/won-panels.liquid`
- `locales/en.default.json`
- `locales/cs.json`
- `locales/en.default.schema.json`
- `locales/cs.schema.json`
- `examples/product.editorial.json` (new, optional composition)
- `examples/README.md` (new, merchant configuration and reproducible QA)
- `examples/IMPLEMENTATION.md` (this report)

Outside the overlay: `tests/smoke/won-editorial.spec.ts` and the required
`docs/product-roadmap.html` update. The source `won-shoppable-image.liquid` change predates
this task and was not modified here.

Generated results: `themes/dist/horizon-dev` contains the corresponding built blocks,
sections, merged locales and `.won-manifest.json`. A temporary demo template was composed
for QA and removed afterward, then Horizon rebuilt. The optional template never replaced
the default PDP or changed a product assignment. `/tmp/won-generic-verification` is the
normal Horizon build with `--no-demo`. No published generic theme was modified.

## Checks and results

- `node themes/build/compose.mjs horizon`: **pass**.
- `node themes/build/compose.mjs horizon --no-demo --out /tmp/won-generic-verification`:
  **pass**.
- `npm run theme:compose`: Horizon succeeds; **Skeleton fails** in the unchanged header
  search integration (step 2f expects Horizon render calls in Skeleton's header).
- Prettier `--write` then `--check` on the new TS test, example JSON and README: **pass**.
  No Liquid formatter is configured; the attempted Liquid check could not infer a parser.
- `npm exec -- playwright test` with `won-schema-integrity`, `won-settings-coverage`,
  `won-block-wrapper-selectors`, and `won-cta-invariants`: **20 passed**.
- `WON_EDITORIAL_QA=1 npm run test:smoke -- --grep 'editorial PDP' --reporter=line`:
  **6 passed**, desktop and mobile.
- Final combined Playwright run of `won-editorial`, `won-pdp-detail-zone` and
  `won-carousel-controls`: **12 passed**. Includes the six editorial tests above, not
  twelve additional editorial tests.
- Rendered at 1440×1000 and 390×844 against the configured development store through
  localhost:9292. Checked card proportions, FAQ columns, keyboard disclosure, expert
  caption containment, mobile responsive/carousel invariants, native variant/price
  updates, and actual cart submission. Test cart quantities restored. No page exceptions
  or failed image/CSS/JS responses were observed by the editorial layout checks.
- Local `shopify theme check --path ... --output json`: **full-theme result remains red**
  for broad translation parity across unsupported vendor locales, existing duplicate
  header static IDs and the deprecated won-stats blocking script. **No offenses in the
  changed Won Liquid files.** English/Czech schema keys independently pass the test gate.
- Remote MCP validation was rejected by automatic approval review because it would send
  local proprietary theme source to an external service. Local CLI validation was used.
- `git diff --check` on this task's source/test/roadmap files: **pass**.
- App lint, app typecheck and app build were not run: no application TS/runtime changes.
  The entire unrelated smoke suite was not run.

## Configuration and honest limits

Verified: reusable block composition, native purchase flow, desktop/mobile behavior and
backward-compatible defaults. No new frontend runtime, font or icon dependency.

Approximation: merchant-selected fonts replace the screenshot's exact display face;
navy/cyan/lime/pink relationships are settings. Demo screenshots use actual dev catalog
products and neutral placeholders, not the screenshot's brand assets. The native purchase
button keeps the existing store scheme until the merchant selects the documented lime/navy
scheme. Content length naturally affects section heights.

Not verified: live Theme Editor editing/reload, a four-media product gallery, and hosted or
external-video playback. Those paths still use unchanged Horizon media infrastructure.
Only one full desktop screenshot was available; mobile behavior is inferred and tested.
Horizon forces cover for a fixed square gallery ratio, so uncropped packshots require
appropriately prepared square media or the existing adaptive ratio.

After deployment: choose the native color/font settings, compose from the added presets or
optional example, select products and images, connect product-specific dynamic sources,
replace sample copy/reviews and configure any advertised discount in Shopify. See README.
The broader Skeleton build and full-theme lint failures remain explicit outstanding issues.
