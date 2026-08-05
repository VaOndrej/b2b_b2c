# Won Theme — ranní report (noční autonomní build)

## Co je hotové
**25 generických composable komponent** postavených nad čistým Horizonem jako base-agnostic
vrstva `won-base`, **každá jednotlivě MCP-validovaná GREEN** (Shopify Theme Check), a
**portabilita ověřená i na Skeletonu** (stejné soubory projdou na obou basech).

### Sekce (page-level, 15)
`won-carousel` · `won-band` · `won-features` · `won-accordion` · `won-newsletter` ·
`won-collection-tiles` · `won-media-compare` · `won-comparison` · `won-app-slot` ·
`won-articles` · `won-page-header` · `won-stats` · `won-contact` · `won-tabs`

### Bloky (nestable, 11)
`won-slide` · `won-feature` · `won-accordion-row` · `won-tile` · `won-highlights` ·
`won-param-table` · `won-nutrition-table` · `won-video` · `won-delivery-note` ·
`won-dosage` · `won-tab`

Všechny mají: **presety + ortogonální osy** (tvůj „16 variant v jednom bloku"),
**color-scheme kaskádu** (globál → volitelný per-block override), **richtext nadpisy**
(mandatorní vzor), **cs + en locale**, a jsou **self-contained** (vlastní `<won-carousel>`,
`<won-compare>`, `<won-tabs>` web componenty — nikdy needitují sdílený `slideshow.js`).

## Jak si to ráno pustíš
```bash
# 1. složit motiv (Horizon = klientská trať)
node themes/build/compose.mjs horizon      # → themes/dist/horizon-dev
# 2. live preview (potřebuje přihlášený dev store)
shopify theme dev --path themes/dist/horizon-dev
# Skeleton (produktová trať) stejně: compose.mjs skeleton → dist/skeleton-dev
```

## Co ještě potřebuje TEBE / dev store (ráno)
1. **Live browser verifikace celé knihovny + Lighthouse.** Přes noc šla jen statická validace
   (MCP theme check) — neřekl jsem „funguje", dokud to neuvidíme v prohlížeči. Playwright specy
   red→green napíšu ráno, až bude dev store.
2. **3 odložené cart/price/variant bloky** (nejrizikovější oblast dle regression-logu — stavět je
   blind by bylo nezodpovědné): `won-sticky-atc`, `won-price-per-unit`, `won-qty-discount`.
   Dělají se ráno s `shopify theme dev` + Playwright red→green.
3. **Page-recipe templates** (`templates/*.json` pro HP/PDP/PLP/blog) — poskládat bloky do
   demo stránek podle EshopAudit recipes. Rychlé, ale chce to vizuální kontrolu.
4. **Rozhodnutí k odsouhlasení** (v BUILD-LOG): marquee plynulá smyčka (JS duplikace itemů),
   configurator/problem-chooser theme-vs-app, reviews Won app vs 3rd-party (Air), hero preset = sport.

## Reálné bugy nalezené a opravené za běhu (ne v prohlížeči — staticky)
- `compose.mjs` padal na Skeleton locale s **trailing commas** → readJson teď strippuje komentáře i je.
- `visible_if` **nejde na `collection`** setting (jen basic + vyjmenované specialized) — ověřeno MCP docs.
- **HTML table tagy** (`thead/tbody/table`) nesmí být otvírané/zavírané napříč Liquid `{% if %}` větvemi
  → won-comparison rozdělen na `rows[0]` hlavičku + `for … offset:1` tělo.

## Nezveřejňovat jako „hotové"
Nic z tohohle není browser-ověřené. JS web componenty (`<won-carousel>` drag/autoplay,
`<won-compare>` slider, `<won-tabs>` klávesnice) prošly theme-check, ale **runtime chování se musí
potvrdit v prohlížeči ráno**. Marquee je zatím scroll+reset, ne plynulá smyčka.
