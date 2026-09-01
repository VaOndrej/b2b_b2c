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

## Git deploy pipeline (2026-08-22)
- **Vrstvy**: `themes/build/layers.mjs` = jediná definice `owner` (kdo soubor zapisuje v deploy repu: `compose` | `merchant` | `mixed`) a `layer` (kam patří editace: `won` | `vendor` | `data` | `locale` | `meta`). Compose krok 5 z toho generuje `.won-manifest.json` v kořeni buildu — `owner` + `layer` + `sha` ke každému souboru. Root dotfile je bezpečný: Shopify ignoruje cokoli mimo osm theme adresářů (a čistý Horizon sám má v kořeni LICENSE.md/README.md/release-notes.md).
- **Topologie**: monorepo (zdroj) → `won-theme-generic` (private, motiv v kořeni, upstream) → klon `won-theme-<klient>` napojený na klientův store přes Shopify GitHub integraci. `themes/clients/` **neexistuje** — integrace chce motiv v kořeni repa, podsložka monorepa se napojit nedá.
- **compose.mjs** má nově `--no-demo` a `--out <dir>`. `npm run theme:generic` = horizon build s demo overlayem do `themes/dist/horizon-generic` (gitignorováno, je to publish intermediate).
- **publish.mjs** (dolů, dist → deploy repo): compose-owned soubory mirroruje včetně mazání, merchant cesty (`config/settings_data.json`, `templates/*.json`, `sections/*-group.json`) jen **seeduje když chybí**, storefront locales merguje **jen chybějící klíče** (merchantova hodnota vyhrává), a když se compose-owned soubor v repu liší od `sha` z minulého publish, hlásí **CONFLICT a nepřepíše ho**. Dry-run je default, zápis až `--apply`. Sype tam i starter kit z `themes/build/deploy-repo/**`.
- **promote.mjs** (nahoru, deploy repo → won-base): **NENÍ to `format-patch` + `git apply --directory`** — složená won sekce není svůj zdroj (2d jí vstřikuje style controls + won-style-vars + won-guard), takový patch by build output zapekl do zdroje. Je to **trojcestný merge** `git merge-file --diff3 <won-base zdroj> <recompose generic> <soubor v repu>`. Editace uvnitř vstřikovaného bloku → konflikt, správně (ten obsah vlastní `themes/build/won-style-controls.json`). Locales se povyšují **po klíčích**, jen pod `won.*`. Vendor a merchant data odmítne hlasitě.
- **`locales/*.json` (bez `.schema`) merchant EDITUJE** přes Shopify Language Editor a GitHub integrace to commitne zpátky (nejde vypnout) → `owner: mixed`. `*.schema.json` řídí jen theme editor → zůstává compose-owned.
- Detaily + ověřená matice chování: `docs/superpowers/specs/2026-08-22-git-deploy-model-decision.md` (sekce „Postaveno 2026-08-22").

## Rail chrome + karta + PDP (2026-08-30, feedback 8)
- **`.won-rail__controls`** (`won-tokens.css`) = jediná řada ovládání railu, používají ji
  všechny čtyři railové sekce: won-carousel (slider + grid-rail), won-grid (mobile_carousel),
  won-hero-carousel (absolutní pás přes médium), won-tabbed-rail. Pořadí v DOM = indikátor →
  tečky → šipky; šipky drží `margin-inline-start:auto`. Prázdná řada mizí přes
  `:not(:has(> *:not([hidden])))`, `--sm-only` varianta se skryje nad 750px.
  **Nová sekce s railem renderuje ovládání DOVNITŘ téhle řady, ne jako sourozence.**
- **`assets/won-cart.js`** posílá dvě události: vlastní `cart:refresh` a Horizonův
  `cart:update` s `detail.data.itemCount` (bez něj se počítadlo v hlavičce nehne).
  `syncSteppers(cart)` promítne košík do VŠECH `[data-won-stepper]` na stránce — stejný
  produkt je na HP v několika railech. Klíč řádku (`data-won-line-key`) je jediný handle
  pro `/cart/change.js`.
- **`won_card_add_mode` default = `stepper`** (od 2026-08-30). Label „Do košíku" ⇄ „+"
  přepíná CSS podle `[data-won-stepper][data-won-qty-value]`; stepper s množstvím zůstane
  viditelný i v režimu reveal=hover.
- **PDP galerie: `aspect_ratio` MUSÍ být `adapt`**, jinak Horizon ignoruje `media_fit` a
  vnutí `media-fit-cover` (viz `visible_if` v `blocks/_product-media-gallery.liquid`).
  Vzduch kolem packshotu dělá token `--won-media-inset` (6 %) v `won-tokens.css`, aplikovaný
  jen na `.product-media-container.media-fit-contain`.
- **PDP sloupec (demo `templates/product.json`)**: group (titul+cena+ppu) → popis produktu
  (`text` blok s `{{ closest.product.description }}`) → stock signal → divider → varianty →
  buy buttons → won-product-trust. `won-highlights` z demo šablony odstraněn (dubloval trust
  strip hned pod sekcí), v pickeru zůstává.
- **`feature_title_lines`** (won-grid, default 2) → `--won-feature-title-lines` →
  `min-block-size: calc(N * 1lh)` na `.won-feature__title`. Drží začátky popisků USP stripu
  na jednom řádku i když se nadpisy zalomí různě.
- **Publikace do `won-theme-generic`**: `npm run theme:generic` →
  `node themes/build/publish.mjs --repo ../../won-theme-generic --reseed-demo [--apply]`.
  **`--reseed-demo` je pro generický upstream povinný** — bez něj publish nechá
  `templates/*.json` a `settings_data.json` na hodnotách z prvního publishe (jsou
  `owner: merchant`) a demo data zamrznou, i když se kód posune. Flag přepíše jen
  soubory bajtově shodné se sha z minulého publishe; cokoli editovaného zůstane.
  U klientského forku ho NEPOUŽÍVAT.
- Dev server nad generickým repem: `cd ../../won-theme-generic && shopify theme dev
  --store b2b-b2c-store-development.myshopify.com --port 9293` (9292 drží monorepo dist).
  Dev theme id generiku: **161957216497**.

## CTA efektová vrstva (2026-08-30)
- `snippets/won-fx.liquid` → renderuje se **dovnitř class atributu** každé interaktivní
  won CTA (`{% render 'won-fx' %}`); ze `settings.won_btn_hover/won_btn_sheen/
  won_btn_press/won_fx_speed` poskládá `won-fx won-fx--hover-* --sheen-* --press-* --speed-*`.
  Chování je v `won-tokens.css` (§ CTA effect layer). **Sold-out label ho NEDOSTÁVÁ** —
  neakce se nesmí tvářit klikatelně.
- Nastavení: `themes/build/won-effect-settings.json` (compose 2e injektuje automaticky).
  Defaulty: hover `lift`, sheen `hover`, press `sink`, speed `normal`.
- **`transform` patří výhradně efektové vrstvě.** Reveal quick-addu na kartě jede na
  `translate` (`won-tokens.css`, `.won-pcard__add`) — když obojí psalo `transform`,
  hover efekt a odhalení se navzájem rušily.
- Efekt měnící barvu musí mít **zdvojený selektor** (`.won-fx.won-fx--hover-fill:hover`),
  jinak prohraje se sekčním `{% stylesheet %}`, který se načítá později.
- `<button type="submit">` nemůže jít přes `won-button.liquid` (ten renderuje `<a>`) —
  newsletter, contact, collection, sticky-atc a variant-picker si třídy píšou ručně
  a `{% render 'won-fx' %}` tam musí být doplněný ručně taky. Hlídá
  `tests/smoke/won-cta-effects.spec.ts`.
- **`snippets/won-rail-controls.liquid` = JEDINÁ implementace ovládání railu** (2026-08-30).
  Params: `s` (settings sekce, jen pro `per_section`), `variant` `rail`|`hero`,
  `sm_only`. Rendrují ho won-carousel (2×), won-grid, won-hero-carousel,
  won-tabbed-rail. **Nová railová sekce ho renderuje, nedělá si vlastní resolution** —
  hlídá `tests/smoke/won-rail-indicator-modes.spec.ts` (statický, bez serveru).
  Matice `won_rail_indicator` ověřena runtime přes všechny 4 hodnoty:
  progress/dots/none/per_section, všechny raily. Marquee (brand belt) záměrně bez
  ovládání — je to pás, ne rail.
  Indikátor **nemá šířkový cap** nikde (ani hero) — vyplní volnou šířku řady.

## Demo katalog dev storu (2026-08-30)
- Produkty jsou přejmenované Shopify snowboardy; **handly zůstávají snowboardové**
  (`the-collection-snowboard-liquid` = Whey Protein). Nepřejmenovávat — visí na nich
  demo šablony i testy.
- Obsah dorovnán skriptem `themes/demo/tools/seed-supplement-catalog.mjs`
  (data `supplement-catalog.json`, dry-run default, kroky `desc|options|prices|stock|meta`).
  16 produktů: český popis (odstavec + odrážky + dávkování), osa variant
  (Balení / Počet kapslí / Příchuť), ceny + SKU, sklad, metafieldy
  `won.rating|rating_count|delivery|net_weight_g|servings` + `custom.nutrition`.
  `net_weight_g` a `servings` jsou **per varianta** u produktů s osou.
- Chráněno a nedotčeno: `won-e2e-*`, `mg-e2e-*`, `gift-card`, statusy draft/archived,
  vyprodaný fixture (`the-out-of-stock-snowboard`) a netrackovaný
  (`the-inventory-not-tracked-snowboard`).
- **Store má 3 lokace**, online obsluhuje jen „Shop location" (87488004337).
  „Snow City Warehouse" je neaktivní → `the-3p-fulfilled-snowboard` (Omega 3) je na
  storefrontu nedostupný **odjakživa**, není to regrese.
- Záloha katalogu před zásahem: `tmp/store-backup-2026-08-30.json`, stav po:
  `tmp/store-after-2026-08-30.json` (`themes/demo/tools/dump-products.mjs`).

## Jednotková cena (2026-08-31)
- **Žebříček pravidel je JEDNO globální nastavení `won_unit_price_rules`** (textarea, skupina
  „Cena za jednotku", fragment `themes/build/won-unit-price-settings.json`, injektuje compose 2e).
  Syntax jedno pravidlo na řádek: `<metafield ns.key> | <za kolik jednotek> | <popisek>`.
  Zkouší se shora dolů, vyhraje první metafield (VARIANTA → produkt) s kladným číslem.
  Popisek s `t:` jde přes `| t`, jinak doslova → klient si přidá ml / kusy / prací dávky
  ve svém jazyce bez zásahu do kódu. **Jen metafieldy, pevné množství je zakázané** (test).
- Per-sekční `ppu_base`/`ppu_amount`/`ppu_metafield` ZRUŠENY → jedno volitelné `ppu_rules`
  (override, prázdné = pravidla motivu). Konzumenti: won-price-per-unit (`rules`),
  won-product-card (`ppu_rules`), won-carousel/won-collection (předávají dál), won-variant-picker.
- Liquid nemá literál `\n` → `| newline_to_br | split: '<br />'`. Dynamický klíč `{{ var | t }}` funguje.
- Zápis pravidel: **oddělovač je svislá čára `|`, ne lomítko**; řádek začínající `#` se ignoruje
  (parkování pravidla, defenzivní — zakomentovaný řádek by neprošel tak jako tak).
  Nápověda pro merchanta je v `won.global.unit_price_about` + `won.info.unit_price_rules`.
- **publish.mjs doplňuje chybějící `won_*` globály po klíčích do existujícího
  `config/settings_data.json`** (krok „won globals, additive", běží jako poslední, merchantovu
  hodnotu nikdy nepřepíše, zachovává úvodní komentář souboru). Bez toho se na klientský store
  nedostal ANI JEDEN z 16 won globálů — `owner: merchant` na souboru neznamená, že klíč,
  který merchant nikdy neviděl, patří jemu. Hlídá `tests/smoke/won-publish-global-settings.spec.ts`.
- Stejná díra může být u `templates/*.json` (sekce přidaná do demo šablony po prvním publishi).
  Neprověřeno.

- **`snippets/won-unit-price.liquid` = JEDINÁ implementace ceny za jednotku.** Rendrují ho
  `blocks/won-price-per-unit`, `snippets/won-product-card` (`format: 'text'`) a
  `sections/won-variant-picker` (per varianta, do JSON i do tabulky). Nová sekce ho renderuje,
  nedělá si vlastní výpočet — hlídá `tests/smoke/won-unit-price-honesty.spec.ts` (klíče
  `won.unit.*` smí být jen v tom jednom souboru).
- **Metafield se čte `variant.metafields` a teprve pak `product.metafields`** — produkt s osou
  Balení / Počet kapslí má hmotnost i porce na VARIANTĚ (seed to tak dělá záměrně, produktová
  hodnota by lhala). Když nesedne žádné pravidlo, renderuje se **nic**.
- **Referenční veličina nesmí mít nikde `default` ani zapečenou hodnotu** — ani ve schématu,
  ani v curated `templates/*.json`. Dřív bylo `1000` ve 4 schématech a `33` ve 3 šablonách.
- Katalog: **27 z 27 publikovaných variant** má reálné referenční množství (prášky
  `won.net_weight_g` per varianta → za 100 g, kapsle `won.servings` → za porci).
  `the-minimal/hidden/draft/archived-snowboard` jsou draft/archived fixtures → 404.
- **Skenování storefrontu přes `theme dev` proxy tiše selhává během reloadu.** Sken bez
  retry ukázal „chybí data" u produktů, které data mají. Katalogové skeny dělat s retry.
- `shopify theme dev -e horizon` teď navazuje na dev theme **161957216497**, ne na
  161463730417 uvedené výš. Ověřeno 2026-08-31.

## Vrstva 3 — globální matice (2026-08-31)
- **Každý `won_*` globální setting musí číst aspoň jedna sekce s presetem** (nebo sdílený
  snippet). Deprecated soubory se nepočítají — merchant je nemůže vložit. Hlídá
  `tests/smoke/won-countup-reachable.spec.ts`. Chytlo to `won_countup_default_duration`,
  jehož jediný konzument byl `won-stats` po strhnutí presetů.
- **`won-grid` source `stats` umí count-up** (`animate_values` + `animate_duration`,
  0 = zdědit `won_countup_default_duration`). Absorpce `won-stats` do `won-grid` tuhle
  schopnost původně vynechala. Preset `stats_row` má `animate_values: true`.
- **Nekopírovat vzory z deprecated souborů** — `won-stats` používá `| script_tag`, což MCP
  validate odmítne jako parser-blocking. Živé sekce načítají JS přes `<script src defer>`.
- Naměřeno bez nálezu: Cards (`won_card_add_mode/align/reveal` × 2 viewporty, tap ≥ 44 px,
  0 kolizí s badgem), Effects (13 hodnot ve 4 rodinách), Catalog (`won_hide_gift_cards`
  false → 23 karet vč. gift-card, true → 22), Policy (`won_return_*` řídí
  `MerchantReturnPolicy` v LD+JSON).
- **Efektová vrstva měří `transform` a `::after`**, ne `translate`/`scale`/`::before`.
  Sonda na špatné vlastnosti udělá tři falešná „mrtvá nastavení".
- Pokrytí quick-addu visí na JEDNOM produktu (Elektrolyty); druhý single-SKU vrací 404.

## Vrstva 1 — journey audit (2026-08-31)
- **`blocks/won-breadcrumbs.liquid` + `snippets/won-breadcrumbs.liquid`** = drobečková navigace.
  Snippet je jediná implementace (won-collection nepřijímá děti, proto ho renderuje přímo přes
  `show_breadcrumbs`). Cesta se staví ZE STRÁNKY (`collection` → jinak první kolekce produktu),
  poslední článek není odkaz. `BreadcrumbList` emituje jen jedna instance (`emit_schema`).
- **`won-slide` má volbu `priority`** = `loading="eager" fetchpriority="high"`. Zapnutá na PRVNÍM
  slidu hero presetů i v demu. Blok nemá jak poznat svou pozici, proto to říká merchant.
  **LCP guard měří NEJVĚTŠÍ obrázek nad foldem, ne každý** — jinak by nutil eager i na slide,
  který jen zasahuje ke spodní hraně.
- **Quick view = Horizonův dialog, ne vlastní.** `#quick-add-dialog` je v `layout/theme.liquid`
  na každé stránce. `QuickAddComponent` použít NELZE (bere URL z `closest('product-card')`).
  `assets/won-quick-view.js` (60 řádků) jen fetchne `[data-product-grid-content]` z PDP, vloží
  do `#quick-add-modal-content` a zavolá `showDialog()`. Globál `won_card_choose_action`
  (modal | link), default modal. Tlačítko zůstává `<a href>` — funguje bez JS i na prostřední klik.
- **Test ovládání odhalovaného na hover: hover KARTY + klik BEZ `force`.** `force: true` obchází
  hit-test a projde, i kdyby prvek překrývala fotka.
- Nepokryto z Vrstvy 1: search není v hlavičce (SRH-004/HP-004), výsledky vyhledávání používají
  nativní Horizon kartu místo won karty.
