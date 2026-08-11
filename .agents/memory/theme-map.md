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
  - **Step 2c** (`HIDE_NATIVE_SECTIONS` list) strips `presets` from native Horizon sections that duplicate a Won equivalent (hero, carousel, marquee, slideshow, layered-slideshow, media-with-content, collection-list, collection-links) → hidden from „Add section" picker, still render where referenced. Edit the list + re-compose to change.
  - **Step 2d** (W3-b Universal Customization Layer) injects the shared style-controls fragment (`themes/build/won-style-controls.json` → `tier1`+`tier2`+`tier3`) into each `WON_STYLE_SECTIONS` allow-listed won section's schema (dedupe of copied `padding_*`/`accent_override`/`corner_radius`, **preserving per-section defaults**), swaps root `render 'won-spacing'` → `render 'won-style-vars'` (superset snippet emitting `--won-*`; consumed by `won-tokens.css .won-section`), and wires `render 'won-guard'` after the section root (editor-only coaching notes, never blocks — see "Merchant coaching layer" below). Allowlist = all 26 won sections (`won-sticky-atc` excluded — floating widget, no won-spacing root). Idempotent (dist rebuilt from pristine source each run). Colours: default inherit the Color scheme, with optional per-section `bg_color`/`text_color` overrides that win via a doubled `.won-section.won-section` selector (out-specifies `.color-<id>`) — Horizon's scheme system itself is never modified. Range settings PRESERVE each section's curated geometry (min/max/step/default) + snap default to grid — else Shopify's upload parser rejects "default must be a step in the range" (compact sections use step:2). `.won-section` visibility var is scoped `:not([hidden])` so it never overrides the HTML `hidden` attribute; heading-weight fallback is the theme token, never `inherit` (would un-bold). Extend by adding pure-var controls to the fragment + snippet + `won-tokens.css` together; class/Liquid-coupled settings (color_scheme/section_width/content_align) stay section-authored.
  - Running compose wedges a live `theme dev` watcher → restart it after composing (kill `lsof -ti tcp:9292`, re-launch, poll 200).

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

## Editor grouping + section help-text
- „Add section" picker grupuje podle `presets[].category` = locale `t:won.categories.{hero,content,products,layout,apps}`. Sekce bez kategorie = „nezařazeno"; deprecated sekce bez presetu se nezobrazí.
- Každá aktivní sekce má úvodní „k čemu to je" `{ "type":"paragraph","content":"t:won.info.<slug>_about" }` jako první top-level setting (locale `won.info.*_about` v en+cs).
- won-sticky-atc `bar_style`: full | compact | minimal (edge-to-edge) + **center** (plovoucí pilulka na střed, skrývá thumb) + **corner** (malá karta vpravo dole). Plovoucí styly čtou `--won-radius-md` (setting `corner_radius`) a `--won-sticky-offset` (setting `offset_bottom`) inline na `<won-sticky-atc>`. Smoke: „sticky ATC — corner/center…".
- won-shoppable-image hotspot: volitelná **samostatná mobilní pozice** — `custom_mobile_pos` toggle → emit `--x-m/--y-m` + třída `won-shop__pin--m`; `@media(max-width:749px)` override. Smoke: „hotspot honours its separate mobile position".
- PDP galerie = **nativní Horizon** `blocks/_product-media-gallery.liquid` (schema) + `snippets/product-media-gallery-content.liquid` (renderer). Už plně konfigurovatelná (grid/carousel, media_columns, thumbnail_position/width, aspect_ratio, media_fit, zoom). Měnit přes `templates/product.json` settings; NEoverlayovat (upgrade-unsafe). Viz docs/won-design-system.md.

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

## Merchant coaching layer (won-guard)
- `snippets/won-guard.liquid` = editor-only (`request.design_mode`), non-blocking coaching engine; **supersedes won-contrast-guard** (deleted). Wired after each section root by compose 2d (`render 'won-guard'`), 26/26. Runs 6 self-skipping checks → one `.won-editor-notes` box: both-hidden, accent-vs-white contrast, text-vs-bg contrast (both set), empty media (media_type image + no image), button label↔link (both directions). Copy in `won.editor.*` (en+cs). Storefront never renders it (no-leak Playwright test guards this). Editor "shows" direction = manual check (headless can't pass admin bot-check).
