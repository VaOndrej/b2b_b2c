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
- Každá aktivní sekce má úvodní „k čemu to je" `{ "type":"paragraph","content":"t:won.info.<slug>_about" }` jako první top-level setting (locale `won.info.*_about` v en+cs). **Styl about textu = účel + co si můžeš přidat/nastavit** (děti bloku + hlavní controly), ne jen jednořádkový popis — merchant má z něj poznat, co tam nasype a co vyladí. app-slot/sticky-atc používají klíče `won.info.app_slot` / `sticky_atc` (ne `_about`). Deprecated sekce (accordion, articles, collection-tiles, features, stats, tabs) se v pickeru nezobrazí → jejich about je mrtvý text, neřeší se. Popisy dětí bloku se do sekčního intra NErozepisují (A6 disclosure); správné místo je intro uvnitř dítěte, až bude potřeba.
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
- **Settings-coverage gate (`tests/smoke/won-settings-coverage.spec.ts`, no server):** DOKTRÍNA „žádné mrtvé nastavení" — každé schema `id` v každé SHOWN won sekci (i v jejích child blocích, mimo shared style-controls) MUSÍ být referencované někde ve zdroji (sections+blocks+snippets+assets), jinak test padne. Platí do budoucna: nový won blok / nové nastavení nesmí shipnout jako toggle bez efektu. Corpus MUSÍ zahrnovat `blocks/` (bloky čtou `section.settings.<id>`) a heuristika pokrývá dynamické klíče (`'option'|append:pos|append:'_style'` → `s[key]`). Red-proofed. 271 nastavení, 0 mrtvých k 2026-08-11.
- **Statická reference ≠ viditelný efekt.** Content-dependent controly (carousel `show_dots`/`show_progress`/`show_arrows` se schovají, když se rail vejde na 1 stránku — JS `buildDots` `pages<=1`) jsou zapojené, ale vizuálně inertní v části konfigurací → merchant má dojem „toggle nic nedělá". Ty ověřuj behaviorálně: `tests/smoke/won-carousel-controls.spec.ts` (kontrakt: zobrazený pager není nikdy prázdný + non-vacuous overflow). Demo má funkční příklad teček = Bestsellery carousel (collection source, 8 produktů, columns 4 → 2 stránky).
- **Behaviorální settings-audit 2026-08-11** (workflow, 157 effectful settings × 14 sekcí, adversarial verify) našel + opravil **4 chain-bugy, které statika NECHYTLA** (id referencované, ale konzument rozbitý), fixy v `tests/smoke/won-settings-fixes.spec.ts`:
  1. **text_alignment → align-items**: `content_align` (left|center|right) piped do `align-items` je nevalidní pro left/right → drop → block děti (button row) se neposunou. Fix: zvlášť emituj `--won-*-flex` mapované na flex-start|center|flex-end; `text-align` čte raw, `align-items` čte flex var. Bylo v won-band + won-newsletter. **Vzor: text_alignment nikdy nesypat přímo do align-items.**
  2. **won-slide `min_height`**: `--won-slide-min` konzumoval jen gradient/overlayed body → plná karta výšku ignorovala. Fix: base `.won-slide__body { min-height: var(--won-slide-min, 0) }`.
  3. **desktop heading/title size bez konzumenta**: sekce emitovala `--won-h-size-d`, ale chyběl `@media (min-width:750px)` rule → desktop slider inertní (won-tabbed-rail, won-variant-picker). **Vzor: každá sekce s `--won-h-size-d` MUSÍ mít desktop @media 750px font-size rule (viz siblings won-band/comparison/newsletter).**
  - won-variant-picker není v žádné demo šabloně → nerenderuje se na storefrontu, jeho fix jen staticky.

## Shared CTA + design-system invariants (2026-08-12 audit fixes)
- **`snippets/won-button.liquid`** = shared CTA primitive (label, link, style primary|secondary, new_tab, class, aria). Renders nothing when label blank; `target="_blank"` ONLY when `new_tab` truthy. Rewired: won-band, won-slide, won-app-slot, won-accordion, won-panels. New CTA = render this, never inline `<a class="won-btn">`. Guard: `tests/smoke/won-cta-invariants.spec.ts` (no server) — no hardcoded `_blank`, rewired sections use won-button, every source:manual won-carousel preset ships blocks.
- **New tokens in `won-tokens.css`:** `--won-tap: 44px` (all tap targets use it), `--won-shadow-sm/md/lg`, `--won-info`/`--won-success` (badge status). **Breakpoint canon** documented at top: mobile <750 / tablet-up ≥990 / wide-up ≥1024. Outliers still to reconcile (need live QA): 768/1000 inside won-carousel/won-tabbed-rail/won-collection liquid.
- **Carousel arrows now gate on real overflow** (`renderScroll`: `this.arrows.hidden = !scrollable && !loop`), matching dots/progress; needs `data-won-arrows` on the arrows container (both won-carousel + won-hero-carousel have it) + `.__arrows[hidden]{display:none}` CSS (class beats UA [hidden]). won-carousel.js listeners now via one **AbortController** (drag window listeners were leaking) + onScroll rAF-throttled + a **window resize listener that re-runs onScroll** (crossing a breakpoint changes overflow, and resize doesn't fire scroll — without it arrows stayed stale after a breakpoint change). LIVE-VERIFIED 2026-08-13 on dev store: fresh mobile all rails overflow→arrows shown; resize→desktop, fit rails (#0/#3) hide arrows, overflowing (#1/#2) keep them; page overflow 0 both breakpoints; PDP 0 console errors. Guard: `tests/smoke/won-carousel-arrows.spec.ts` (arrows visible ⟺ overflow).
- **won-slide** gained `image_mobile` (art-direction `<picture>` <750px) — restores native hero/slideshow mobile-media capability.
- **6 legacy no-preset sections** (won-accordion/articles/collection-tiles/features/stats/tabs) carry a top-of-file DEPRECATED marker. won-grid category_grid/category_mosaic/shop_by_goal presets recategorized content→products.
- **id canonicalization DONE + LIVE-VERIFIED 2026-08-13** (renames read new id with `| default: old` fallback AND demo template JSON migrated by section/block `type`, so no orphaned values):
  - `columns` → `columns_desktop` (won-carousel, won-hero-grid). Live: bestsellers=4, reviews=3, brand_marquee=6 read from migrated demo.
  - won-slide `alignment` → `content_align` (block schema + all hero presets + demo won-slide blocks; NOT the native text/price/variant `alignment` in product.json). Live: slide --won-slide-align="left".
  - won-shoppable `aspect_ratio{wide,square,portrait}` → **`card_aspect{landscape,square,portrait}`** (crop-shape family, joins carousel/collection/tabbed-rail). demo value wide→landscape. Live: --won-shop-aspect="16 / 9".
  - won-video `aspect` → `aspect_ratio` (numeric-ratio family, joins media-compare). No demo instance.
  - **Taxonomy decision:** two DISTINCT aspect concepts, each internally consistent — `card_aspect` = image crop shape (carousel/collection/tabbed-rail/shoppable); `aspect_ratio` = fixed numeric ratio (media-compare/video). NOT merged into one dictionary (would be worse design).
  - `columns_tablet` added+wired to won-hero-grid (`--won-hero-cols-md`, `@media (750–989px)`); default 2 = no visual change. Live-verified via injection: 3 cols at 800px. **won-stats skipped** (deprecated, not in picker; won-grid is the live grid).
  - `section_width` added to won-collection (`won-container--full` toggle, default page). **won-newsletter intentionally left narrow** (`won-container--narrow` is the design, not an asymmetry).
  - announcement-bar `alignment` (select flex-position) intentionally NOT renamed — genuinely different concept from text `content_align`.
  - Gates: MCP validate 11/11, full smoke 141 passed / 0 failed, live desktop+tablet+mobile, 0 console errors from won code, homepage visually unchanged. Doctrine `rules/theme-block-ux.md` §4–9 codifies these rules.

## Merchant coaching layer (won-guard)
- `snippets/won-guard.liquid` = editor-only (`request.design_mode`), non-blocking coaching engine; **supersedes won-contrast-guard** (deleted). Wired after each section root by compose 2d (`render 'won-guard'`), 26/26. Runs 6 self-skipping checks → one `.won-editor-notes` box: both-hidden, accent-vs-white contrast, text-vs-bg contrast (both set), empty media (media_type image + no image), button label↔link (both directions). Copy in `won.editor.*` (en+cs). Storefront never renders it (no-leak Playwright test guards this). Editor "shows" direction = manual check (headless can't pass admin bot-check).
