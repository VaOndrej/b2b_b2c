# Jednotková cena — nález, oprava, důkazy

Iterace matice `docs/plans/2026-08-30-won-theme-e2e-matrix.md`, buňka
**Vrstva 4 / „chybějící metafield → won-price-per-unit"** + **Vrstva 2 / schéma
won-price-per-unit** + **Vrstva 5 / skip v won-pdp-composition**.

## Nález

Zadání znělo „u kapslí lže cena za jednotku". Skutečný rozsah byl větší: **fikci
tisklo 8 z 8 variantních produktů**, kapsle i prášky.

### Příčina 1 — metafield se čte per varianta, blok četl per produkt

`themes/demo/tools/seed-supplement-catalog.mjs` má v komentáři přesně tohle:

> Váha/porce se u variantního produktu liší kus od kusu — produktový metafield by
> lhal, tak ho tam dáváme jen u jednovariantních.

Data byla modelovaná správně. Blok četl `product.metafields[ns][key]`, takže u
každého produktu s osou Balení / Počet kapslí vrátil čtení prázdno.

### Příčina 2 — schéma mělo `"default": 1000`

Prázdné čtení propadlo na 1000 → `price × 100 / 1000` = `price / 10`, vypsané pod
popiskem „/ 100 g". Číslo, které nic neznamená (**PRC-001**, severity *kritická*:
cena musí být transparentní).

### Příčina 3 — DRIFT: tři kopie téže matematiky

`blocks/won-price-per-unit`, `snippets/won-product-card` a
`sections/won-variant-picker` počítaly jednotkovou cenu každý zvlášť, všechny se
stejnou vadou. `default: 1000` byl ve **čtyřech** schématech.

### Důsledek pro obchod

U prášků to obracelo vlastní hodnotový příběh katalogu:

| produkt | varianta | cena | před opravou | po opravě |
|---|---|---|---|---|
| Whey Protein | 1 000 g | 749,95 | $74.99 / 100 g | $74.99 / 100 g |
| Whey Protein | 2 500 g | 1 699,95 | **$169.99** / 100 g | **$67.99** / 100 g |
| Vitamín D3+K2 | 90 kapslí | 729,95 | $72.99 / **100 g** | $8.11 / porce |
| Vitamín D3+K2 | 180 kapslí | 1 249,95 | $124.99 / **100 g** | $6.94 / porce |

Větší balení vypadalo 2,3× dražší za jednotku. Přesně opak toho, co má
`won-price-per-unit` prodávat.

## Rozhodnutí

Zadání nabízelo „nerenderovat nic" NEBO „u kapslí přepnout na za porci".
Zvoleno **obojí jako žebříček**, protože pokrývá celý katalog a degraduje na ticho:

1. `base` + `metafield` — např. `per_100g` z `won.net_weight_g`
2. `fallback_base` + `fallback_metafield` — default `per_serving` z `won.servings`
3. `amount` — jen když ho merchant výslovně vyplní (žádný default ve schématu)
4. jinak **nic**

Každý metafieldový stupeň se čte **`variant.metafields` → `product.metafields`**.

Prášky tak drží cenu za 100 g, kapsle dostanou cenu za porci (= za kapsli, což je
u doplňků ta veličina, kterou zákazník opravdu porovnává), a produkt bez dat
nezobrazí nic.

## Změny

| soubor | co |
|---|---|
| `themes/won-base/snippets/won-unit-price.liquid` | NOVÝ — jediný resolver, `format: markup\|text` |
| `themes/won-base/blocks/won-price-per-unit.liquid` | deleguje; schéma: `default:1000` pryč, `fallback_base` + `fallback_metafield` |
| `themes/won-base/snippets/won-product-card.liquid` | deleguje (`format: 'text'`), gate na `show_ppu` |
| `themes/won-base/sections/won-variant-picker.liquid` | deleguje per varianta (JSON i tabulka); JS `ppuEl` už nelepí `'/ '` |
| `themes/won-base/sections/won-collection.liquid` | `default: 1000` pryč |
| `themes/won-base/sections/won-carousel.liquid` | `default: 1000` pryč |
| `themes/won-base/locales/{cs,en.default}.schema.json` | nové klíče + přepsané `info` (C4: obojí v jedné změně) |
| `themes/demo/horizon/templates/product.json` | uložené `amount: 1000` pryč, přidán fallback, prefix na „Cena za jednotku:" |
| `tests/smoke/won-unit-price-honesty.spec.ts` | NOVÝ — 3 invarianty |
| `tests/smoke/won-pdp-composition.spec.ts` | odstraněn test s obrácenou premisou (viz níž) |

## Testy

`tests/smoke/won-unit-price-honesty.spec.ts` — psáno jako invarianty, ne výčet:

1. **behaviorální** — kde osa variant nese množství (číslo v názvu varianty), tam
   musí referenční množství implikované vytištěným číslem sledovat to množství.
   Nový produkt je pokrytý bez úpravy testu. Non-vacuity guard: musí projít ≥ 2 produkty.
2. **strukturální — jeden vlastník** — klíče `won.unit.*` smí být jen v
   `snippets/won-unit-price.liquid`. Nová sekce si nesmí napsat vlastní výpočet.
3. **strukturální — žádný vymyšlený default** — žádné `*amount` nastavení
   ve složeném motivu nesmí mít `default`.

Červeně před opravou: **3/3 padly**, test vyjmenoval všech 8 produktů.
Zeleně po opravě: 3/3.

### Odstraněný test (Vrstva 5 nález)

`won-pdp-composition.spec.ts` → `'the unit price tracks the selected variant price'`
tvrdil: *„referenční množství je hodnota na úrovni produktu, takže když se hne jen
cena, musí se jednotková cena hnout o STEJNÝ faktor."*

To je ta vada zapsaná jako kontrakt. Test byl **zelený proti lživé implementaci**
(fiktivní cena se hýbala přesně proporčně) a **spadl by na správné opravě**.
Jeho skutečný záměr (blok nesmí zamrznout na první variantě) je pokrytý
invariantem 1 nového specu: zamrzlý blok implikuje konstantní referenční množství.

## Fikce v uložených datech (druhý průchod)

Odstranění `default` ze schématu nestačilo. Demo karty na HP, PLP i PDP nesly
uložené `"ppu_amount": 33` **bez** `ppu_metafield` — konstantu opsanou z počtu porcí
Whey Proteinu a aplikovanou na celý katalog. Po opravě ji přebíjí metafieldový
stupeň žebříčku, takže výstup se nezměnil (ověřeno: PLP tiskne stejných 9 čísel
před i po), ale byla to mina pro první produkt bez `won.servings`.

Nahrazeno `"ppu_metafield": "won.servings"` ve všech třech šablonách.

**Poučení: strukturální test hlídá `default` ve schématu, ne uložené hodnoty
v curated JSON. Když rušíš default, projdi i šablony.**

## Otevřené — vyžaduje rozhodnutí / zápis do adminu

- ~~Datová mezera u videographer / hidden~~ — **byl to můj měřicí omyl**, ne nález.
  První sken jel přes proxy `theme dev` během reloadu a část requestů tiše selhala.
  Po zopakování s retry: `the-videographer-snowboard` má per-variantu
  `won.net_weight_g` (500/1000/2500) a renderuje $109.99 / $88.59 / $75.99 za 100 g.
  `the-minimal/hidden/draft/archived-snowboard` vracejí 404 — jsou to draft/archived
  fixtures, na storefrontu být nemají.
  **Stav po opravě: 27 z 27 publikovaných variant má poctivou jednotkovou cenu,
  0 fikcí, 0 nechtěných ticha.**
- `selling-plans-ski-wax` má `won.servings = 60` na PRODUKTU a tři cenově různé
  varianty (24,95 / 49,95 / 9,95). „Sample" varianta tak ukáže cenu za porci
  odvozenou ze 60 porcí. Lžou data, ne blok. Řeší per-varianta metafieldy.
- Cesty k metafieldům (`won.net_weight_g`, `won.servings`) jsou dnes v defaultech
  schématu a v defaultu snippetu. **Příležitost**, ne nález: u klientského storu
  s jiným namespace by bylo lepší mít je jako globální nastavení motivu
  (C8 — cross-cutting patří na jedno místo), ne opakovaně per sekce.

---

# Druhá iterace — žebříček do globálního nastavení (schváleno)

Zadání: *„dej to do generic theme nastavení, případně jako list, co by si klient mohl
doplnit jak by potřeboval a vzít to univerzálně, že to nemusí nutně být jenom serving v g."*

## Co bylo špatně po první iteraci

Cesta k metafieldu i jednotka byly zadrátované v **5 souborech** (default schématu bloku,
default snippetu, tři sekce). Klient s jiným namespace nebo s jinou jednotkou — mililitry,
prací dávky, kusy — by musel editovat Liquid.

## Řešení

Jedno globální nastavení **`won_unit_price_rules`** (textarea, skupina „Cena za jednotku").
Fragment `themes/build/won-unit-price-settings.json`; compose 2e ho injektuje sám, bez
editace compose.

```
<metafield namespace.key> | <za kolik jednotek> | <popisek>
```

Shipovaný default:

```
won.net_weight_g | 100 | t:won.unit.per_100g
won.servings | 1 | t:won.unit.per_serving
```

Klient dopíše, co potřebuje:

```
won.volume_ml | 100 | 100 ml
won.washes    | 1   | prací dávka
won.pieces    | 1   | kus
```

- Pravidla se zkoušejí shora dolů; vyhraje první metafield (**varianta → produkt**)
  s kladným číslem. `unit = price × jednotek ÷ hodnota`.
- Popisek s prefixem `t:` projde `| t`, cokoli jiného se vypíše doslova → **jednotka
  nemusí být g ani porce a nepotřebuje locale klíč**.
- **Jen metafieldové cesty.** Literální množství je zakázané a hlídá to test — jinak by se
  celý katalog počítal z jednoho vymyšleného čísla, což je přesně vada z první iterace.

Per-sekční `ppu_base` / `ppu_amount` / `ppu_metafield` / `fallback_*` **zrušeny**, nahrazeny
jedním volitelným `ppu_rules` (override; prázdné = pravidla motivu). Použij ho jen tam, kde
ta jedna sekce chce jinou jednotku než zbytek eshopu.

## Nové invarianty (červené → zelené)

1. Žebříček je **globální textarea**, jeho default má aspoň jedno pravidlo, každé pravidlo
   je metafieldová cesta (ne literál), s kladným počtem jednotek a s popiskem.
2. **Žádný `.liquid` mimo komentáře** nesmí obsahovat metafieldovou cestu z pravidel.
3. Každý popisek jednotky vyrenderovaný na storefrontu musí pocházet z deklarovaných pravidel.

## Důkaz, že merchantova editace dosáhne všude

`won_unit_price_rules` přepnuto v `settings_data.json` na
`won.net_weight_g | 1000 | kg` + `won.servings | 1 | kapsli`:

| kde | před | po |
|---|---|---|
| PDP prášek | $74.99 / 100 g | **$749.95 / kg** |
| PDP kapsle | $8.11 / serving | **$8.11 / kapsli** |
| PLP karty | $119.99 / 100 g · $13.99 / serving | **$1,199.90 / kg · $13.99 / kapsli** |

Popisek „kapsli" není nikde v kódu ani v locales. Stav vrácen composem.

## Třetí iterace — past uzavřena, a byla větší

Podezření znělo: „nový globální setting se nepropíše do existujícího `settings_data.json`."
Test to změřil a rozsah byl horší — chyběl **každý z 16** `won_*` globálů, ne jen ten nový:
`won_card_add_mode`, `won_rail_indicator`, `won_rail_arrows`, `won_rail_arrow_style`,
`won_rail_arrow_tone`, `won_btn_hover`, `won_btn_sheen`, `won_btn_press`, `won_fx_speed`,
`won_return_enabled/_days/_country`, `won_hide_gift_cards`, `won_card_add_align`,
`won_card_add_reveal`, `won_unit_price_rules`.

Na každém klientském storu, který už `settings_data.json` měl, běžely won sekce na Shopify
defaultech místo na našich — tiše, od prvního publishe.

**Oprava:** `publish.mjs` má nový krok „won globals, additive" — přečte `won_*` settings
s `default` z buildového `settings_schema.json` a **po klíčích** je doplní do `current`.
Merchantovu hodnotu nikdy nepřepíše, zachová úvodní komentář souboru, běží až po
`--reseed-demo` (tam je to no-op) a hlásí se v dry-runu.

**Poučení: `owner: merchant` na souboru neznamená, že celý jeho OBSAH patří merchantovi.
Klíč, který merchant nikdy neviděl, je náš.**

Hlídá `tests/smoke/won-publish-global-settings.spec.ts` — integračně, přes reálný
`publish.mjs --apply` do dočasného repa, s jednou hodnotou předem nastavenou merchantem.

### Nápověda pro merchanta

`won.global.unit_price_about` teď explicitně říká, že oddělovač je **svislá čára `|`, ne
lomítko**, a ukazuje čtyři příklady včetně nemetrických jednotek:

```
won.net_weight_g | 100 | t:won.unit.per_100g
won.volume_ml    | 100 | 100 ml
won.washes       | 1   | prací dávka
won.pieces       | 1   | kus
```

`won.info.unit_price_rules` dovysvětluje pořadí pravidel, vzorec, chování `t:` popisku,
parkování řádku přes `#` a proč tam pevné číslo nepatří.

### Zůstává otevřené

- Stejná díra může být u `templates/*.json` — sekce přidaná do demo šablony po prvním
  publishi se na klientský store nedostane. Neprověřeno; u šablon je merge nebezpečnější
  (pořadí bloků).
- Nápověda v theme editoru není vizuálně ověřená (headless neprojde admin bot-check).
