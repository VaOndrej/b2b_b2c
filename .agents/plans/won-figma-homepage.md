# HP wireframe ze knihovny Won bloků

Stav: 2026-09-10 — hotovo, 11 sekcí, mobil i desktop. Brána 208/208 + blog rail zvlášť (2/2).

## Sestava (osnova od Ondřeje, sloty 5 a 6 na mně)

| slot | blok | proč |
|---|---|---|
| 0 | `won-announcement-bar` | pruh nad hlavičkou |
| 1 | `native--header` | **není Won blok** — nativní Horizon `header-component` |
| 2 | `won-hero-carousel--hero-peek` | volba Ondřeje: první slide plus náznak dalšího; navíc o 100 px nižší než hero-split |
| 3 | `won-marquee--usp-strip` | pruh, ne mřížka — nekrade výšku hned pod hero |
| 4 | `won-carousel--product-carousel` | rail s náhledem další karty |
| **5** | `won-grid--shop-by-goal` | u doplňků lidé hledají výsledek (spánek, imunita), ne typ produktu |
| **6** | `won-band--media-text` | po rozcestníku zpomalit a vysvětlit hodnotu; comparison tabulka patří na kategorii |
| 7 | `won-grid--category-grid` | Instagram — **Won nemá IG sekci**, mřížka dlaždic je vizuálně totéž |
| 8 | `won-grid--articles-rail` | blog nad patičkou; desktop 3 sloupce, mobil 1 sloupec + rail |
| 9 | `won-newsletter--newsletter-signup` | mezi blogem a patičkou; `signup`, ne `leadmagnet` — ten má řádek pro nabídku (PDF zdarma), což dává smysl jen když magnet existuje |
| 10 | `won-footer--footer` | patička |

Definice: `EshopAudit/src/wireframe/won-library/pages/homepage.json`.

### Per-breakpoint varianty

Mřížka pěti dlaždic je na desktopu jeden řádek, na mobilu 2 036 px stack. Sekce
proto může mít pro mobil jinou variantu (`mobileSlug`):

- slot 5 → `--mobile-carousel-true` (rail, swipe; cílů je pár)
- slot 7 → `--columns-mobile-2` (Instagram se čte jako mřížka, ne rail)

Mobil tím spadl z 6 885 na 3 894 px.

## Co přibylo v nástroji

- `build-page.mjs` — složí stránku z ověřených komponent knihovny
- `preview-page.mjs` — render stránky do PNG (mobil + desktop)
- plugin: režim `won-page` (`meta.kind === 'won-page'`) staví jeden rám na
  breakpoint, sekce pod sebou, mobil a desktop vedle sebe
- capture umí **nativní sekce** motivu přes `nativeSelector` v manifestu
  (header je `header-component`, ne `[id*=header_section]` — ta obálka má na
  mobilu nulovou výšku)
- screenshot už není podmínkou: když selže, strom pro Figmu se stejně vytáhne

## Opravená vada extraktoru: `display: contents`

`header__column` je `display: contents` — nulový rámeček, ale děti se
rozmisťují v mřížce prarodiče. Zahazoval jsem takové obaly podle nulového
rozměru i s obsahem, takže mobilní header byl prázdný. `walk()` teď u
`display: contents` vrací pole dětí místo uzlu.

Po opravě se knihovna přeměřila: **208 komponent, 208/208 prošlo bránou**
(bylo 213 — část variant se po doplnění obsahu stala vizuálně shodnou).

## Vyřešeno: překrývající se karty v railu

Byla to chyba **jen v mém HTML rendereru**, ne v datech ani v pluginu. Absolutně
pozicovaný rám (`layout.mode === 'none'`) nedostával `flex:0 0 auto`. Jako dítě
flex rodiče (karta v railu karuselu) se pak smrštil z 358 px na ~145 a karty
lezly jedna přes druhou. Figma tím netrpí — plugin velikost nastavuje přes
`layoutSizing*`.

Dopad je ale širší: `verify.mjs` měří přesahy a sloupce **nad tímhle
rendererem**, takže všude, kde je absolutní rám uvnitř auto-layoutu, měřil
špatně. Po opravě brána proběhla znovu: 208/208 prošlo, žádný nový nález.

## Délka mobilu

Ondřej: „na mobilu nikdy moc dlouhý scroll." Vybrané nejkratší rozumné varianty:

| slot | mobil | ušetřeno |
|---|---|---|
| bestsellery | `--columns-mobile-2` (486 px místo 698) | 212 px |
| shop by goal | `--mobile-carousel-true` (530 místo 2 036) | 1 506 px |
| Instagram | `--columns-mobile-2` (550 místo 2 036) | 1 486 px |

Celkem **6 885 → 3 683 px**. Níž to s osmi sekcemi nejde: hero 660, patička 697
a Instagram 550 jsou dané a kratší varianty nemají. Kdyby měl být mobil ještě
kratší, musela by ubýt sekce — to je rozhodnutí o osnově, ne o variantě.


## Blog jako rail — vyžádalo změnu motivu

Články byly v `won-grid.liquid` **jiná větev než bloky**: rail wrapper
(`<won-carousel>`, `data-won-track`, `won-rail-controls`) měla jen `blocks`
větev, `articles` ne. Navíc má articles větev `--won-cols-sm: 1` natvrdo, takže
na mobilu vždycky stackovala karty pod sebe (tři články = 1 222 px).

Doplněno **zrcadlením blokové větve** — stejný wrapper, stejná ovládání,
stejná theme-wide nastavení indikátoru. Ke schématu se rozšířilo `visible_if`
u `mobile_carousel` na `blocks or articles`, aby to šlo zapnout i v editoru.

Výsledek: mobil 572 px místo 1 222, desktop 610 px se třemi sloupci.

## Pojmenování vrstev

Sekce v `homepage.json` nese `name` — ve Figmě se vrstva jmenuje
`instagram — won-grid--category-grid`, ne jen slug. Designér vidí účel, slug
zůstává pro dohledání v knihovně.

## Výsledné rozpočty

| | mobil | desktop |
|---|---|---|
| 8 sekcí (před blogem) | 3 683 px | 3 570 px |
| 10 sekcí (hero-peek + blog) | 4 493 px | 3 999 px |
| 11 sekcí (+ newsletter) | 4 704 px | 4 263 px |
| 11 sekcí (blog jako rail) | **4 366 px** | **4 351 px** |

Ondřej 2026-09-10: délka mobilu je takhle v pořádku, **žádný blok se nevyhazuje**.
Kratší varianty knihovna stejně nemá — jediná páka by byla ubrat sekci.
