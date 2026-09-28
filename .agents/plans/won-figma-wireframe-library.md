# Won bloky → Figma wireframe knihovna

Stav: pilot hotový 2026-09-04 (won-hero, won-grid, won-panels)

## Zadání
Kompletní knihovna všech Won bloků ve Figmě ve **wireframe** kvalitě, ze které
designér poskládá wireframe pro klienta. Musí vypadat stejně nebo lépe než to,
co je teď v `shopify theme dev`.

## Rozsah (zdroj: themes/won-base)
- 27 sekcí `won-*` (`sections/`)
- 16 bloků `won-*` (`blocks/`)
- 21 snippetů `won-*` (sdílené primitivy: button, badges, product-card, rating,
  rail-controls, trust, unit-price…)

## Jde to jen z kódu? Ne.
Schema popisuje **nastavení, ne vzhled**. Příklad `won-grid`: `source`
(blocks/articles/stats) × `item_style` (plain/card/bordered) × `mosaic` ×
`columns_desktop 1–6` × `mobile_carousel`. To je desítky vizuálně odlišných
výstupů z jednoho souboru. Layout navíc řeší CSS v `assets/` + tokeny v
`tokens/`, ne schema. A samotné zadání („stejně nebo lépe než theme dev") je
definované vůči vyrenderovanému výstupu — bez renderu není proti čemu měřit.

→ **Kód i render, každý na jinou věc:**
- kód = úplný seznam bloků a **matice variant** (co všechno musí knihovna mít),
- render = **geometrie a proporce** (co to reálně dělá).

## Ale screenshoty samy o sobě taky nestačí
EshopAudit má dvě cesty do Figmy:
1. **SCENE** (`src/figma/dom-to-scene.js` + plugin SCENE režim) — z živého DOM
   vytáhne absolutně umístěné vrstvy 1:1. Přesné, ale **placatá kopie**: žádný
   auto-layout, žádné komponenty. Designér z toho neposkládá wireframe.
2. **Proposal** (`src/wireframe/renderer.js` + plugin default režim) — staví
   nativní auto-layout vrstvy z datového modelu, pojmenované `section/*` a
   `block/*`. Editovatelné, skládatelné. To je ta správná forma deliverable.

Proposal generátor ale dnes umí jen ručně psané „wire typy" (hero, productgrid,
faq…), ne Won bloky.

## Navržený postup
1. **Inventář z kódu** — projít `themes/won-base/{sections,blocks}` a vygenerovat
   matici: sekce → varianty (které kombinace settings dávají jiný vzhled).
   Výstup: `won-blocks-matrix.json`. Rozhoduje, kolik artboardů knihovna má.
2. **Ground truth z theme dev** — postavit v `themes/demo/horizon/templates/`
   „kitchen sink" šablonu se všemi Won sekcemi v každé zvolené variantě,
   `compose.mjs horizon` → `theme dev` → Playwright 390 px a 1440 px:
   screenshot + `dom-to-scene` extrakce geometrie na sekci.
3. **Generátor** — nový `src/wireframe/generators/won-library.js`, který z matice
   + naměřené geometrie vyrobí proposal JSON: jeden `section/won-*` frame na
   variantu, opakované položky jako `block/won-*`.
4. **Doplnit builder v pluginu** — pro Won typy, co dnes v `code.js`
   (`WIRE_TO_SECTION`, `WIRE_ROLE`) nemají mapování.
5. **Ověření** — vedle sebe screenshot z theme dev vs. render z Figmy, sekce po
   sekci. Bez toho se to nehlásí jako hotové.

## Rozhodnuto (2026-09-04)
- **Rozsah**: klíčové varianty (default + ty, co mění vzhled zásadně), ~90–120 artboardů.
- **Breakpointy**: mobil 390 + desktop 1440.
- **Forma**: Figma Components. Na free plánu fungují bez omezení; placené je jen
  publikování knihovny mezi soubory a Dev Mode. Důsledek: **knihovna i klientský
  wireframe musí být v jednom Figma souboru** (free = 3 soubory, 3 stránky/soubor).
- **Postup**: nejdřív pilot `won-hero`, `won-grid`, `won-tabs` celým řetězem až
  do Figmy a porovnání se screenshotem z theme dev. Až to sedí, zbytek dávkově.

## Výsledek pilotu (2026-09-04)

Nástroj: `Tools/EshopAudit/src/wireframe/won-library/` (README tamtéž).
Plugin: nový režim `won-library` v `Tools/EshopAudit/figma-plugin/`.

- **Rozsah knihovny je definovaný sám motivem**: 43 presetů ve 21 živých
  sekcích. 6 sekcí (`won-accordion`, `won-articles`, `won-collection-tiles`,
  `won-features`, `won-stats`, `won-tabs`) je v kódu značeno `DEPRECATED` a
  vynechává se.
- **Pilot: 18 variant × 2 breakpointy = 36 komponent**, všechny do 8 % výšky
  originálu z theme dev. 287 rámů s auto-layoutem, 34 absolutních.
- **Presety posílají bloky bez settings** — v editoru si je merchant vyplní,
  pro knihovnu je to prázdná skořápka. Řeší `content-pack.mjs`.

### Chyby, které pilot odhalil (a proč je dobře, že běžel)

1. `oklab()` — motiv počítá barvy v oklab, parser uměl jen `rgba()` a tiše
   zahazoval výplně. Řeší se převodem přes canvas (zvládne libovolný CSS zápis).
2. `aria-hidden` — filtr na něj mazal každou dekorativní ikonu v motivu.
3. `border-bottom` — čtení jen `border-top` zahazovalo oddělovače akordeonu.
4. Sticky header a search overlay lezly do výřezu screenshotu sekce.
5. Sbalený akordeon je v DOM v plné výšce, jen ořezaný — bez testu na
   `overflow` se do stromu dostal obsah, co na screenshotu není.
6. Inline `<strong>` se rozpadal na vlastní vrstvu položenou přes větu.

### Co zbývá

- Ověřit plugin **uvnitř Figmy** — kód je napsaný a syntakticky zkontrolovaný,
  ale nespuštěný. Do té doby je „postaví se to ve Figmě" nepodložené tvrzení.
- Dojet zbylých 25 variant (18 sekcí) dávkově stejným řetězem.
- Rozhodnout `--style wireframe` vs `--style theme` (obojí funguje).
