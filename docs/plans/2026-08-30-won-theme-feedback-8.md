# Won theme — feedback 8 (6 bodů): příčiny, fixy, důkazy

Zadání Ondřeje 30. 8. 2026 (druhé kolo téhož dne). Všechny příčiny **změřené
v prohlížeči** proti běžícímu `shopify theme dev -e horizon`, ne odhadnuté.

Testy napsané **před** fixem, ověřené jako červené, pak zelené:
`tests/smoke/won-feedback-8.spec.ts` (6 invariantů × 2 viewporty).

---

## Souhrn: co bylo vlastně za tím

Čtyři z šesti bodů byly funkce, které **existovaly, prošly zelenou sadou
a nefungovaly** — pokaždé z jiného důvodu. To je ta zajímavá část.

| # | Symptom | Skutečná příčina |
|---|---|---|
| 1 | Posuvník scrollu „je špatně" | Šipky a lišta byly **dva blokové řádky**, ne jedno ovládání |
| 2 | Quick add „nefunguje" | Přidalo se, ale nikdo to **neřekl hostitelskému motivu** → počítadlo 0 |
| 2b | +/− nejde | Stepper byl **defaultně vypnutý**, jeho test se proto skipoval |
| 3 | USP strip nezarovnaný | Různě zalomené nadpisy; v 1440 se to **neprojeví** |
| 4 | Obrázek moc nahoře | Horizon **ignoruje `media_fit`**, když `aspect_ratio != adapt` → `cover` ořízl víčko |
| 5 | Chybí popisek produktu | Blok byl **poslední** ve sloupci (a produkty mají prázdný popis) |
| 6 | „Klíčové přednosti" pryč | Dublovalo trust strip hned pod sekcí |

---

## 1. Ovládání railu = jedna řada, ne dvě

`.won-carousel__arrows` a `.won-carousel__progress` byly sourozenci na úrovni
bloku, každý s vlastním `margin-top`. Šipky se zarovnaly doprava, lišta o řádek
níž doleva a s cappem 240 px → indikátor vypadal jako zbloudilá čárka pod první
kartou. Naměřeno na 1200 px: šipky `y=1617 h=44`, lišta `y=1685 h=2`.

**Fix:** sdílená `.won-rail__controls` (`assets/won-tokens.css:477`) —
`display:flex; align-items:center`, pořadí indikátor → tečky → šipky, šipky
drží `margin-inline-start:auto`. Prázdná řada se skryje přes
`:not(:has(> *:not([hidden])))`, `--sm-only` varianta nad 750 px.

Zapojeno ve **všech čtyřech** railových sekcích, aby to nemohlo znovu
rozjet: `won-carousel:116,129`, `won-grid:104`, `won-hero-carousel:55`,
`won-tabbed-rail:84`.

> Hero má ovládání jako absolutní pás přes médium. Lišta se tím posunula
> z prostředka doleva (aby to byla stejná řada jako všude jinde). Kdyby to
> vadilo, je to jeden řádek CSS zpátky.

## 2. Quick add — přidávalo, ale nikdo to neviděl

Ověřeno: `/cart/add.js` vrací 200, řádek v košíku vznikne. `won-cart.js` ale
posílalo jen vlastní `cart:refresh`, které **v Horizonu nikdo neposlouchá**.
Počítadlo v hlavičce zůstalo na 0, drawer se nepřekreslil → z pohledu
nakupujícího se nestalo nic.

**Fix** (`assets/won-cart.js:32`): posílat i Horizonův `cart:update`
(`assets/events.js`, `ThemeEvents.cartUpdate`) s `detail.data.itemCount`.
Z toho čte `cart-icon`, `component-cart-items` i drawer; bez `sections`
spadnou zpátky na `renderSection`, což je bezpečné.

### 2b. Stepper +/− byl celou dobu vypnutý

`won_card_add_mode` mělo default `button`, takže stepper se nikdy nevykreslil
— a `won-card-quick-add.spec.ts` svůj stepper test **skipoval**. Zelená sada
tvrdila víc, než ověřovala.

- default přepnut na `stepper` (`themes/build/won-card-settings.json`),
- „+" se po přidání už **neblokuje** na 1,6 s (potvrzovací timer „Přidáno"
  patří jen do režimu prostého tlačítka — jinak druhé klepnutí tiše propadne),
- popisek „Do košíku" ⇄ „+" přepíná CSS podle
  `[data-won-stepper][data-won-qty-value]` (`won-tokens.css:318`),
- stepper s množstvím **zůstane viditelný** i v režimu reveal=hover
  (`won-tokens.css:322`) — množství, které nakupující nevidí, není zpětná vazba,
- `syncSteppers(cart)` promítne košík do **všech** karet na stránce; stejný
  produkt je na HP v několika railech.

## 3. USP strip — rezervované řádky nadpisu

Naměřeno na 1200 px: nadpisy 20 px vs. 40 px vysoké → popisky se rozešly o 20 px.
Na 1440 px se všechny nadpisy vejdou na řádek, takže test na jedné šířce nic
nechytí; invariant se proto ověřuje na 780 / 1000 / 1200 / 1440.

**Fix:** setting `feature_title_lines` na won-grid (default 2,
`won-grid.liquid:327`) → `--won-feature-title-lines` →
`min-block-size: calc(N * 1lh)` na `.won-feature__title`
(`blocks/won-feature.liquid:76`). `1lh` = vlastní řádkový box nadpisu, takže to
sleduje velikost písma, ne natvrdo pixely.

**Vědomý kompromis:** není to `subgrid`. Subgrid by se sám dopočítal, ale musel
by projít přes `div.shopify-block`, přes tři varianty pozice ikony a přes
row-gap sdílený s mřížkou karet — křehké. Rezervace řádků je deterministická;
u třířádkového nadpisu si merchant hodnotu zvedne.

## 4. PDP packshot — Horizon ignoroval `media_fit`

V `templates/product.json` bylo `aspect_ratio: "1"` **a** `media_fit: "contain"`.
Snippet `product-media-gallery-content.liquid:152` ale dělá:

```liquid
if block_settings.aspect_ratio != 'adapt'
  assign product_media_container_class = ... | append: ' media-fit-cover'
```

→ `media_fit` se zahodí, obrázek se ořízne. V schématu je to vidět jako
`visible_if: aspect_ratio == 'adapt' and constrain_to_viewport == true`,
v uloženém JSONu ne. Naměřeno: `object-fit: cover`, přirozený rozměr 620×723
v boxu 660×660 → uřízlé víčko i podstavec.

**Fix (data, ne kód):** `aspect_ratio: "adapt"` v demo šabloně. Vzduch kolem
packshotu dělá token `--won-media-inset` (6 %, `won-tokens.css:57`) aplikovaný
**jen** na `.product-media-container.media-fit-contain` (`won-tokens.css:335`) —
u `cover` by padding jen odhalil pozadí.

## 5 + 6. Sloupec PDP

Nové pořadí (`themes/demo/horizon/templates/product.json`):

```
group (titul + cena + cena za 100 g)
popis produktu          ← přesunuto sem z konce sloupce
stock signal (skladem + doručení)
divider → varianty → buy buttons
won-product-trust
```

`won-highlights` („Klíčové přednosti") z demo šablony **odstraněn** — dubloval
trust strip hned pod sekcí. V pickeru zůstává, merchant si ho může přidat zpět.

---

## Testy

`tests/smoke/won-feedback-8.spec.ts` — generické invarianty, žádný výčet sekcí:

1. každý rail, kde je vidět lišta i šipky, je má na **stejné vertikální ose** (±6 px),
2. quick-add změní **počítadlo v hlavičce** (bez reloadu),
3. stepper: 0 → 1 → 2 → 1 → skrytý, a košík s tím souhlasí; **reálný klik**, ne `force`,
4. v každé řadě `won-feature` začínají popisky na stejném řádku, na 4 šířkách,
5. hlavní PDP médium má `object-fit: contain` a nenulový padding,
6. staticky nad demo šablonou: popis je hned za cenovou skupinou, `won-highlights` tam není.

Ověřeno červené proti stavu před fixem (5/6 spadlo hned, 6. po doplnění šířek).

**Výsledky:** feedback-8 12/12 zelené · plná sada `npm run test:smoke`
**218 passed / 0 failed** / 28 skipped (skipy jsou předchozí) · `theme check`
0 errors · MCP `validate_theme` 12/12 souborů.

Screenshoty: `tmp/feedback-8/` (1440 + 390).

---

## Sebeaudit — co je nedodělané, nejisté nebo kompromis

Řazeno podle závažnosti.

1. **Bod 5 je hotový, ale na 6 ze 7 demo produktů nebude nic vidět.**
   Produkty mají v adminu **prázdný popis** (`descLen=0`); jediný, který popis má,
   je „Protein Blend — Výhodný set" — na něm je umístění vidět
   (`tmp/feedback-8/5-pdp-description-desktop.png`) a text je pořád starý
   snowboardový. Do adminu jsem nezapisoval (pravidlo „žádný zápis bez go").
   Ověření: `curl -s http://127.0.0.1:9292/products/the-videographer-snowboard.js | python3 -c "import json,sys;print(len(json.load(sys.stdin)['description']))"`
2. **Změnil jsem globální default motivu** (`won_card_add_mode` → `stepper`) na
   základě tvé volby. Motivy, kde je hodnota uložená explicitně, se nezmění;
   změní se jen ty, které nastavení nikdy nesáhly.
3. **Zarovnání USP stripu je heuristika, ne výpočet** (viz kompromis v bodu 3).
   Třířádkový nadpis v řadě ho rozhodí, dokud merchant nezvedne
   `feature_title_lines`.
4. **Odsazení packshotu není merchantské nastavení**, je to token
   `--won-media-inset`. Vědomě — nechtěl jsem přidávat control do nativního
   Horizon bloku.
5. **Lišta hero carouselu se posunula** z prostředka doleva (jedna řada ovládání).
   Vizuální změna, kterou jsi nežádal; udělal jsem ji kvůli jednotnosti railů
   z feedbacku 7. Snadno zpět.
6. **Neověřeno: chování v theme editoru** (přidat/odebrat/přeuspořádat bloky, jak
   vypadá nový control `feature_title_lines`). Headless neprojde bot-checkem
   adminu — tohle je na tebe.
7. **Neproběhl `shopify theme push --json`** (server-side validační brána z
   theme-map). Použil jsem MCP `validate_theme`, abych nezapisoval do storu bez
   „go". Push chytá pár chyb navíc (duplicitní `content_for 'blocks'`, presety
   mimo rozsah) — pokud chceš, pustím ho.
8. **Drobnosti:** `:has()` a jednotka `1lh` jsou evergreen-only (Chrome 109+ /
   Safari 16.4+ / Firefox 120+). Košíkový drawer se po quick-addu **neotevírá** —
   zpětná vazba je počítadlo + stepper. Nežádal jsi to, jen ať to není překvapení.
