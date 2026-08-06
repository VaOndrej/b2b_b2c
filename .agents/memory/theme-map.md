# Theme map — won-base overlay on Horizon (b2b_b2c)

Per-project architecture & file-finding facts. Keep terse. Shared lessons go to the plugin's
`regression-log.md` / `decisions.md`, not here.

## Composition pipeline
- Source of truth: `themes/won-base/**` (overlay) — sections, blocks, snippets, assets, locales.
- Curated demo data (templates/section-groups/settings that must survive a rebuild):
  `themes/demo/<base>/**` (e.g. `themes/demo/horizon/`).
- Build: `node themes/build/compose.mjs` → `themes/dist/horizon-dev`.
  - Step 1 `rmSync(outDir)` + `cpSync(pristine base)` — **wipes dist** and rebuilds from pristine
    Horizon. Never hand-edit dist; it is destroyed on every compose.
  - Overlays won-base code, merges locales, then **step 4** copies `themes/demo/<base>/**` over dist.
  - Running compose wedges a live `theme dev` watcher → restart it after composing.

## Serving locally
- `shopify theme dev --store b2b-b2c-store-development.myshopify.com --path themes/dist/horizon-dev --port 9292`
- Dev theme id: **161463730417** ("Development (…)").
- Static validation gate: `shopify theme push --path themes/dist/horizon-dev --theme 161463730417 --json`
  → check `.theme.errors`. This catches server-only errors the MCP `validate_theme` misses
  (duplicate `content_for 'blocks'`, preset settings outside a block's range).

## Block taxonomy (post-consolidation)
- **Containers (schránky):** `won-hero` (single), `won-hero-grid`, `won-hero-carousel`, `won-grid`
  (source: blocks | articles | stats), `won-panels` (display: tabs | accordion), `won-carousel`
  (JS slider engine). Legacy `won-features/collection-tiles/articles/stats/tabs/accordion` are
  deprecated (presets stripped, files kept for back-compat render).
- **Primitives (blocks):** `won-slide`, `won-feature`, `won-tile`, `won-panel`.
- **Functional widgets:** `won-comparison`, `won-newsletter`, `won-footer`, `won-contact`,
  `won-media-compare`, `won-page-header`, `won-sticky-atc`, `won-shipping-bar`, `won-variant-picker`,
  `won-collection`, `won-band`, `won-app-slot`.

## Shared assets / gotchas
- Global CSS/JS live in `themes/won-base/assets/`: `won-tokens.css` (all cross-component CSS +
  section/heading alignment doctrine), `won-carousel.js`, `won-panels.js`.
- Shared asset JS loaded via multiple `<script src>` tags re-executes → wrap in an IIFE with
  `if (customElements.get('x')) return;` guard (both won-carousel.js and won-panels.js do this).
- Radius tokens: `--won-radius-sm` 8, `--won-radius-md` 14, `--won-radius-lg` 22. Corner-radius
  control injects `--won-radius-md/sm` inline on the LEAF that renders the rounded surface.
- Locale keys `t:won.*` in `themes/won-base/locales/en.default.schema.json` + `cs.schema.json`.

## Tests
- Playwright harness: `playwright.config.ts` (desktop 1440 + mobile 390, workers 1), specs in
  `tests/smoke/`, shared invariants in `tests/support/responsive-invariants.ts`
  (`assertResponsiveSane`, `assertCarousel`, `assertHeadingBodyAlignment`). Run: `npm run test:smoke`.
