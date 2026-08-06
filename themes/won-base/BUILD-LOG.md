# won-base — build log (přehled pro ranní review)

Živý log autonomní noční stavby generické Won block library nad Horizonem.
Poslední update: sekce foundation + první exemplár.

## Klíčová rozhodnutí (checkpointy k ranní diskuzi)

1. **`won-base` je SELF-CONTAINED (base-agnostic).** Horizonovy bloky se opírají o Horizon-only
   snippety (`slideshow-slide`, `spacing-style`, `gap-style`, `layout-panel-style`, `overlay`) a
   custom elementy → reuse by zabil portabilitu na Skeleton. Proto máme vlastní tokeny, vlastní
   `won-spacing` snippet a vlastní `<won-carousel>` element. Závisíme jen na standardním Liquidu +
   `var(--color-*)` s fallbacky. Nested `@theme`/`@app` bloky přijímáme (flexibilita), ale vlastní
   render na nich nestojí.
2. **Generické composable bloky, ne 1:1 podle katalogu.** Jeden `won-carousel` = HP carousel +
   recommended + reviews slider + product showcase + logos + gallery. Presety + ortogonální osy.
3. **Color kaskáda (LOCKED):** globální `color_scheme` je zdroj pravdy; per-block `inherit_color_scheme`
   (default true); accent override vysází inline `style="--won-accent: …"` jen když je vyplněný.
4. **Rich text (LOCKED):** nadpisy `inline_richtext`, body `richtext`.
5. **Multi-language:** všechny labely přes `t:` klíče; obsahové defaulty přes `t:` → locale
   `en.default` + `cs`. Klíče v namespace `won.*`.
6. **Grounded-only presety:** presety odvozené z EshopAudit recipes + Enervit/Therabeast; osy volné,
   ohlídané `visible_if` + token-only hodnotami.

## Breakpointy (mobile-first, min-width)
base / sm 480 / md 768 / lg 1024 / xl 1440.

## Otevřené / odloženo (k dořešení)
- won-carousel: zdroje `blog` a `product recommendations` (Recommendations API) odloženy na pass 2
  (potřebují won-product-card / won-article-card snippety). Zatím `manual` (won-slide) + `collection`.
- Configurator a problem-chooser: theme-native vs. app — zatím theme-native s čistým rozhraním.
- Reviews: Won app vs. 3rd-party (Air) — nerozhodnuto.

## Per-block workflow (závazný, dle /shopify-dev)
1. Napsat blok (self-contained, config contract, presety+osy, i18n `t:won.*`).
2. `node themes/build/compose.mjs horizon` (overlay + locale merge → dist/horizon-dev).
3. MCP `validate_theme` na dist → GREEN (autoritativní, ne IDE diagnostika).
4. Review kódu: žádné hacky, čistý, a11y, responsive, editovatelné, blank-safe.
5. Zapsat locale (en.default.schema + cs.schema + storefront en/cs) v `won-base/locales`.
6. Log + (později) Playwright spec (běží ráno na dev storu).

## Aplikované regresní lekce (z shopify-dev memory)
- Carousel: `touch-action: pan-x pan-y`, JS drag jen myš, progress z reálného `scrollLeft` ratia
  (ne index), `columns = min(setting, count)`, center jen když se vejde. Nikdy needitovat `slideshow.js`
  → vlastní `<won-carousel>`.
- Nadpisy: povinný richtext + 4 size/width settings + `replace '</p><p>','<br>'`.
- Padding jen přes spacing snippet (won-spacing), responzivní scale 0.7 mobil.
- `visible_if` NEJDE na `collection` (jen basic + vyjmenované specialized) — ověřeno MCP docs.
- object-fit: contain na packshotech ve fixním boxu.

## Progres — 25 komponent, VŠE MCP GREEN (Shopify Theme Check), portabilita Horizon+Skeleton
Foundation + tooling:
- [x] `assets/won-tokens.css`, `snippets/won-spacing.liquid`, `manifest.json`
- [x] `build/compose.mjs` (overlay + deep-merge locale; tolerantní k `/* */` komentářům i **trailing commas**)
- [x] Locale `locales/{en.default,cs}.schema.json` + `locales/{en.default,cs}.json` (multi-language cs+en)

Sekce (page-level):
- [x] `won-carousel` (slider/grid/marquee; manual+collection; presety product/content/marquee)
- [x] `won-band` (hero split/overlay/media+text/CTA)
- [x] `won-features` (USP/benefits/trust; hostuje `won-feature`)
- [x] `won-accordion` (FAQ stacked/split + contact blok; hostuje `won-accordion-row`)
- [x] `won-newsletter` (signup/leadmagnet; `{% form 'customer' %}`)
- [x] `won-collection-tiles` (grid/mosaic; hostuje `won-tile`)
- [x] `won-media-compare` (before/after slider, `<won-compare>` web component)
- [x] `won-comparison` (my vs konkurence tabulka; yes/no → check/cross; zvýrazněný sloupec)
- [x] `won-app-slot` (hostuje `@app` bloky; onboarding placeholder + deep-link když prázdné) — MOAT vazba
- [x] `won-articles` (blog grid/featured z blog pickeru; datum/perex)
- [x] `won-page-header` (title + subheading + volitelné bg image/overlay)
- [x] `won-stats` (KPI čísla z „Hodnota : Popisek" řádků)
- [x] `won-contact` (`{% form 'contact' %}`; form / split s info+mapou)
- [x] `won-tabs` (PDP záložky, `<won-tabs>` web component + klávesnice; hostuje `won-tab`)

Bloky (nestable):
- [x] `won-slide`, `won-feature`, `won-accordion-row`, `won-tile`
- [x] `won-highlights`, `won-param-table`, `won-nutrition-table`, `won-video`, `won-delivery-note`
- [x] `won-dosage` (timeline „kdy užívat")
- [x] `won-tab` (jedna záložka: title + richtext obsah)

### Regresní lekce nalezená za běhu
- **HTML table tagy nesmí být otvírané/zavírané napříč Liquid `{% if %}` větvemi.** won-comparison nejdřív
  otvíral `<tbody>` uvnitř `{% if forloop.first %}` a zavíral za smyčkou → theme-check LiquidHTMLSyntaxError
  „close tbody before table". Fix: oddělit hlavičku (`rows[0]`) od těla (`for … offset: 1`), `<thead>/<tbody>/<table>`
  staticky vyvážené. (Do shared regression-logu distiluju ráno přes /shopify-dev-learn.)

## PORTABILITA PROVEN ✅
`compose.mjs skeleton` + MCP validace: won-carousel / won-band / won-feature / won-nutrition-table
**GREEN i na čistém Skeletonu** → base-agnostic vrstva potvrzena na obou tratích (Horizon i Skeleton).
Bug nalezen a opraven: compose padal na Skeleton locale s trailing commas → readJson teď strippuje i je.

## Zbývá dostavit
- Presety pro celé stránky (page recipes → templates/*.json) — HP/PDP/PLP/blog (ráno + vizuální kontrola)
- Viz `MORNING-REPORT.md` pro plný ranní plán.

## DEFERRED na ráno (nutná browser verifikace — nejrizikovější oblast dle regression-logu)
- **won-sticky-atc** (puppet hlavního tlačítka + morph save/restore + 2× IntersectionObserver)
- **won-price-per-unit** (cena/porce z variant dat — variant morph past)
- **won-qty-discount** (množstevní tiery z variant dat)
Tyhle 3 se dělají RÁNO s `shopify theme dev` + Playwright red→green — stavět je blind proti
regresním lekcím (price sync / variant morph) by bylo nezodpovědné.

## LIVE BROWSER QA (dev store, Playwright) — první běh
Homepage recept `themes/demo/horizon/templates/index.json` (17 sekcí, všech 25 komponent, real data
z `automated-collection`), `shopify theme dev` na 127.0.0.1:9292. Nálezy (statika byla green, tyhle
jdou vidět jen za běhu):
- **[FIX] won-tokens.css se vůbec nenačítal** → kontejnery bez okrajů, tlačítka jako holý text. Compose
  teď vkládá `{{ 'won-tokens.css' | asset_url | stylesheet_tag }}` do `<head>` složeného motivu (1 link).
- **[FIX] won-tabs: prázdné labely tabů** — sekce nemůže číst `block.settings` potomků renderovaných přes
  `content_for` (`section.blocks` → `@theme`, settings size 0). Přestavěno: panel nese `data-title`, nav
  staví JS, bez JS panely stacked s `<h3>` (SEO/no-JS OK).
- **[FIX] won-slide bordered/elevated karta bez vnitřního paddingu** — obsah lepil na okraj. Přidán padding
  na `__body` (médium je sourozenec → zůstává full-bleed).
- **[OPEN] i18n defaulty**: `won.defaults.*` jsou jen ve `*.schema.json` (editor), ne ve storefront
  `en.default.json`/`cs.json` → nevyplněná pole se renderují anglicky/prázdně (nutriční labely, newsletter
  placeholder). Nutné rozhodnutí o locale strategii.
- **[PROCES] po `compose.mjs` vždy restart `theme dev`** (recompose maže dist → watcher závodí →
  „theme block file does not exist"). Jednosouborový `cp` do dist syncuje OK.
- Kontaktní formulář, produktový carousel (real data), FAQ, stats, comparison, story bloky, blank-safe
  stavy (blog „No articles yet.", app-slot onboarding) — vizuálně OK desktop i mobil (390px).
- Neověřeno (chce data): won-media-compare potřebuje before/after obrázky; produktové karty závisí na kolekci.
Detailní gotchas v paměti [[won-theme-liquid-gotchas]].

## Druhé kolo QA (po feedbacku)
- **[FIX] won-carousel progress lišta neodrážela scroll** — palec měl v CSS fixní `inline-size: 30%`.
  JS teď počítá šířku palce = `clientWidth/scrollWidth` (viditelná frakce) a pozici = scroll ratio v px;
  když není co scrollovat, `[data-won-progress]` se skryje. Ověřeno Playwrightem (start 66 % = viditelná
  frakce, konec = pravý okraj). **Regrese zapsána do shopify-dev regression-logu** (pravidlo pro všechny
  horizontálně scrollovatelné bloky). Viz [[won-theme-liquid-gotchas]].
- **[KOREKCE i18n — žádný bug]** Schema locale soubory lokalizují i `default` hodnoty settingů podle
  **aktivního jazyka storu** (Shopify docs). Máme `en.default.schema.json` + `cs.schema.json`, takže
  na českém storu se defaulty vezmou česky; anglicky se zobrazují jen proto, že dev store běží v EN.
  Storefront fixní texty (a11y/kontakt) jsou správně v storefront locale. Architektura locale je OK.
- **[DEMO] HP: odstraněna duplicitní sekce „Proč Won"** (won-features usp) — won-features je už ukázán
  jako trust bar; zůstává jedna „Proč zvolit Won" (won-comparison).
- **[DEMO] Přidána PDP** `themes/demo/horizon/templates/product.json` — native Horizon buybox + won USP
  + Detail (param/nutrice/dávkování/delivery v won-band) + taby + porovnání + FAQ + související carousel.
  Vizuálně ověřeno, všechny won PDP bloky renderují čistě.

## Otevřené / k ranní diskuzi
- Browser verifikace celé knihovny + Lighthouse (ráno, dev store).
- Marquee: plynulá smyčka potřebuje JS duplikaci itemů (zatím scroll+reset).
- Configurator / problem-chooser: theme-native vs app — zatím theme-native.

## Třetí kolo (feedback: hero, add-to-cart, re-skin, roadmapa)
- **[FIX] Hero posílen** + konverzní prvky: offer eyebrow, velký nadpip, social-proof řádek (★4,9/5 od 25 000+), 2 CTA. **Pořadí:** kategorie („Objevte nabídku") přesunuty NAD trust strip.
- **[FEAT] Quick-add na produktové kartě (won-pcard)** — floating pill nad médiem, **hover-reveal na desktopu / vždy viditelné na mobilu** (`@media (max-width:1024px),(hover:none)`), single-variant = instant AJAX `/cart/add.js`, multi-variant = odkaz na PDP, sold-out stav. Base-agnostic: dispatchne `cart:refresh`+`won:cart:added`, vizuální „Added ✓". Ověřeno Playwrightem: košík 0→1, správná varianta, desktop opacity 0 / mobil 1. Pattern odvozen z Enervit+Therabeast (`tb-cart-qty.js`), ale bez závislosti na Horizon internals. Karta rozdělena (media-link + info-link) aby button nebyl vnořen v `<a>`.
- **[FIX] won-tile blank state** — místo Horizoních „tašek" (`placeholder_svg_tag`) čistý brandový radiální gradient + tmavý čitelný label. Kategorie teď vypadají záměrně (supplement look).
- **[FIX] App-slot copy** — už NE Won Toasts (ten je overlay notification engine, ne inline blok); teď Won Companion (cross-sell inline app blok).
- **[OPEN] Produktové obrázky = data storu (snowboardy ze Shopify sample datasetu)** — theme je nemůže nahradit. Nutná úprava produktů na dev storu (přejmenovat + placeholder obrázky) přes Admin API, nebo přidat reálné supplement produkty. Čeká na odsouhlasení (mění data storu).

## FÁZE A — PDP prodejní jádro (probíhá, autonomně)
Cíl: nejlepší supplement PDP na Shopify, config-driven. Vše MCP green + živě ověřeno na dev storu.
- **[HOTOVO] Reskin dev storu** snowboardy → supplementy přes `shopify app execute --path apps/b2b-companion`
  (má write_products) — 16 produktů přejmenováno + obrázky odstraněny; e2e/mg/gift chráněny. Karty na brandový gradient.
- **[HOTOVO] won-price-per-unit** (Price Intelligence): cena/100 g/kg/porci z ceny × referenčního množství
  (metafield `won.net_weight_g`/`won.servings` nebo manuál). Blank-safe. Na PDP: „$69.99 / 100 g", „$21.21 / porce".
- **[HOTOVO] won-variant-picker** (crown jewel): sekce-buybox, čte globální `product`. Osy jako buttons/dropdown
  NEBO pack-karty (BloomRobbins formát/duration). JS `<won-variant-picker>` resolvuje variantu (match dle options),
  synchronizuje cenu/compare/cenu-za-jednotku/dostupnost/obrázek (dispatch `won:variant:media`), qty stepper,
  AJAX `/cart/add.js` + „Added ✓", volitelná tabulka variant („zobrazit v tabulce"). Money předformátováno server-side
  (žádná JS money matematika). Ověřeno: variant resolve, qty 2, košík +2, správná varianta, table toggle.
- **[HOTOVO] won-badges** (snippet, card+PDP): z tagů `badge:<Label>` + metafield `won.badges`; keywords → barva
  (akce/sleva→sale, novinka/new→new, bio/vegan→eco). Globální CSS v won-tokens. Integrováno do won-pcard (vlevo nahoře).
  Demo tagy přidány přes CLI (5 produktů).
- **[ZBÝVÁ Fáze A]** won-stock-signal (skladem/dodání/expirace z metafieldů/inventory), won-sticky-atc
  (Horizon má nativní — hlavně pro báze bez něj), won-bundle/won-qty-discount.
- Screenshoty: won-price-per-unit.jpeg, won-variant-picker.jpeg, won-badges.jpeg, won-reskin-bestsellers.jpeg.

## VRSTVA 0 + FÁZE B (PLP) — hotovo, živě ověřeno
- **[HOTOVO] won-product-card** (snippet) — jedna karta všude (carousel, PLP, cross-sell): badges +
  quick-add + volitelná cena/jednotku. won-carousel refaktorován, aby ji renderoval (inline karta pryč).
- **[HOTOVO] won-cart.js** (globální asset, wired v <head> přes compose) — deleguje `[data-won-add]`
  → AJAX `/cart/add.js`, „Added ✓", dispatch cart:refresh. Karta funguje kdekoli bez per-section JS.
  Pcard CSS přesunuto do won-tokens.css (globální).
- **[HOTOVO] won-collection** (sekce, PLP) — `{% paginate %}` grid sdílených karet + **facety z
  `collection.filters`** (Shopify Search & Discovery: Availability + Price s počty) auto-submit přes
  `<won-facets>`, sort z `collection.sort_options`, stránkování, cena/porce na kartách, empty state.
  `templates/collection.json`. Ověřeno: 6 karet, filtr klik → `?filter.v.availability=1`, HP carousel
  quick-add stále funguje přes globální handler.
- **Bug opraven:** `collection.title | ... | t` překládal titul → „Translation missing". Fix: `{{ collection.title }}`
  přímo (merchant text nesmí přes `| t` — stejná lekce jako atc_label).
- Screenshoty: won-plp.jpeg.

## FÁZE A DOKONČENA + retence (vše MCP green + živě ověřeno)
- **won-rating** (snippet) — hvězdy z metafieldů `won.rating`/`won.rating_count`, CSS clip fill, na kartě i PDP. Blank-safe.
- **won-stock-signal** (block) — skladem/poslední kusy/vyprodáno z inventory + `won.delivery`/`won.expiry` metafieldů.
- **won-shipping-bar** (section) — progress dopravy zdarma z `cart.total_price` vs práh; JS re-fetch /cart.js na `won:cart:added`/`cart:refresh`, Intl.NumberFormat (žádný money_format brace v JS — theme-check lekce: literál `{{` v regexu v {% javascript %} = false „Liquid in JS").
- **won-sticky-atc** (section) — fixed lišta, IntersectionObserver na buybox (objeví se po scrollu), zrcadlí `won:variant:change` z variant-pickeru (cena+variant id), ATC přes globální `[data-won-add]`. Ověřeno: skrytý→viditelný, variant mirror.
- Demo data přes CLI (b2b-companion): 5 badge tagů, 18 metafieldů (rating/count/delivery/net_weight_g/servings).
- Ověřeno naživo: karty s badges+hvězdami+cena/porce, PDP shipping bar + stock + sticky mirror, PLP filtry.
- Screenshoty: won-cards-enriched.jpeg, won-plp.jpeg, won-variant-picker.jpeg.

### Stav vůči Aktin/GymBeam baseline
PRODEJNÍ STROJ HOTOV: **PDP** (variant-picker+cena/porce+badges+rating+stock+sticky+taby+nutrice+porovnání) +
**PLP** (facety+sort+stránkování+obohacené karty) + **sdílená karta všude**. To je jádro, kterým se z „koukám na
GymBeam" stává „GymBeam je baseline". ZBÝVÁ (potřebuje appky/obsah, ne komponenty): Fáze C app-sloty
(reviews/subscription/loyalty/search — degradují na onboarding), Fáze D shoppable recepty/magazín (Aktin content moat),
+ won-bundle/qty-discount (bundle app/line-item props).
