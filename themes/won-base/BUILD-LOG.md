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

## Otevřené / k ranní diskuzi
- Browser verifikace celé knihovny + Lighthouse (ráno, dev store).
- Marquee: plynulá smyčka potřebuje JS duplikaci itemů (zatím scroll+reset).
- Configurator / problem-chooser: theme-native vs app — zatím theme-native.
