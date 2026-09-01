# Won theme — feedback (7 bodů), analýza a plán

Zadání Ondřeje 30. 8. 2026 po prohlídce dev storu. Instrukce byla: **nejdřív pochopit
celek, teprve pak sahat na kód.** Tenhle dokument je ten celek.

Pod každým bodem je **ověřená příčina**, ne domněnka — všechno změřené v prohlížeči
proti běžícímu `shopify theme dev -e horizon`.

---

## Souhrn: co je vlastně za tím

Sedm bodů, ale jen **tři skutečné třídy problému** a jedna chybějící schopnost:

| Třída | Body | Podstata |
|---|---|---|
| **A. Mrtvá CSS kvůli Shopify obalu bloků** | 1 | Selektory s `>` na theme blok nikdy nesednou |
| **B. Rail nemá jednotné a úplné ovládání** | 2, 3 | Chybí afordance + každý blok vypadá jinak |
| **C. Chybí globální (theme-wide) nastavení** | 3, 7 | Rozhodnutí se opakuje per sekce místo jednou |
| **D. Obsah/data, ne kód** | 4, 5, 6 | Styly balení, konverzní CTA, gift card |

A napříč tím **chybějící testovací schopnost**, na kterou Ondřej výslovně ukázal:
E2E, které tyhle věci chytí samo, generickým invariantem, ne výčtem sekcí.

---

## 1. Zaoblené rohy na heru — MRTVÁ CSS

**Příčina (ověřeno v DOM):** Shopify obaluje každý theme blok do `div.shopify-block`.
Slide tedy NENÍ přímý potomek tracku:

```
.won-hero__track > div.shopify-block > article.won-slide
```

Takže tenhle reset **nikdy nesedne** a slide si drží `border-radius: 14px`
z vlastního `--won-radius-md`:

```css
.won-container--full .won-hero--single .won-hero__track > .won-slide { border-radius: 0; }
```

**Rozsah je větší než rohy** — stejnou vadu má 5 selektorů v `won-tokens.css`
(311, 312, 320, 336, 359), včetně `min-height: var(--won-hero-min)`. Část hero
layoutu tedy neplatí vůbec.

**Fix:** nahradit `>` za potomkovský selektor (nebo cílit na `.shopify-block`).
**Test:** guard, který v každém composed motivu najde selektory `> .won-<blok>`
a shodí build — statický, bez serveru.

## 2. Grid, který se mění na rail, nemá šipky

`won-carousel` má celý blok ovládání gated na `layout == 'slider'`. Grid
s `mobile_carousel` se pod 750px mění na scrollovatelný rail, ale šipky nedostane.
(Lištu jsem doplnil 28. 8., šipky ne — dodělat.)

**Ondřejova pointa je důležitější než ten fix:** tohle mělo chytit E2E.
Viz workflow **RAIL-AFFORDANCE** níž.

## 3. Každý rail má jiný posuvník i jiné šipky → do globálního nastavení

Dnes: `won-carousel` a `won-hero-carousel` jsou dvě různé komponenty s vlastním
CSS šipek (`.won-carousel__arrow` = outline na pozadí motivu; `.won-hero__arrow` =
poloprůhledná tmavá s `backdrop-filter`), a indikátor si volí každá sekce sama.

**Návrh — nová globální skupina `themes/build/won-rail-settings.json`:**

| id | typ | volby |
|---|---|---|
| `won_rail_indicator` | select | `per_section` \| `dots` \| `progress` \| `none` |
| `won_rail_arrows` | select | `per_section` \| `always` \| `never` |
| `won_rail_arrow_style` | select | `pill` \| `square` \| `soft` \| `minimal` |
| `won_rail_arrow_tone` | select | `surface` (světlá na pozadí) \| `overlay` (tmavá na médiu) |

Sekce čtou `settings.won_rail_*` a **per-section volba se použije jen když je
globální hodnota `per_section`** — přesně model, který Ondřej popsal
(„custom per blok, nebo jednotné"). Mechanismus na to už existuje: compose krok 2e
injektuje libovolný fragment `won-*-settings.json` do `settings_schema.json`.

**Test:** workflow **RAIL-CONSISTENCY** níž.

## 4. Dva různé styly balení

Není to bug v motivu. Na stránce jsou **dva zdroje obrázků**:
- **theme assety** — nová plochá SVG (hero, promo, kategorie, shoppable) ✅
- **produktové obrázky na kartách** — data storu, pořád starý rastrový styl ❌

Sjednocení = nahrát vyrenderované packshoty na produkty. **Blokované na
`SHOPIFY_ADMIN_TOKEN`** (`render-packs.mjs --raster` je připravený; Shopify
u produktových médií SVG nerenderuje, proto rastr).

## 5. Konverzní CTA v každém bloku, kde to dává smysl

Audit: CTA má 8 z 27 sekcí (hero×3, band, accordion, panels, newsletter, app-slot).
**Nemá ho ani jedna z těch, kde konverze dává největší smysl:** `won-comparison`
(„Proč zvolit Won"), `won-stats`, `won-features`, `won-media-compare`,
`won-tabs`, `won-shoppable-image`, `won-grid`, `won-carousel`.

**Fix:** sdílený footer-CTA pattern přes existující `won-button` snippet +
kanonická id (`cta_button_label` / `_link` / `_style` / `_new_tab`) doplněná do
sekcí ze seznamu. CTA bez labelu nebo bez odkazu nerenderuje nic.
**Test:** rozšířit stávající `won-cta-invariants.spec.ts`.

## 6. Gift card pryč ze všech výpisů

Ověřeno: `/collections/all` vrací 23 produktů včetně „Gift Card".
Shopify má `product.gift_card?` — filtrovat centrálně tam, kde se iteruje přes
produkty (`won-collection`, `won-carousel` se `source: collection`,
`won-tabbed-rail`, doporučené).
**Rozhodnutí k potvrzení:** natvrdo vždy, nebo globální přepínač
`won_hide_gift_cards` (default zapnuto)? Navrhuju přepínač — merchant, který
poukazy prodává, je vyhazovat nechce.

## 7. Produktová karta: quick add se stepperem + pozice tlačítka

Dnes: `.won-pcard__add` je natvrdo `inset-block-end / inset-inline-end` (vpravo dole),
jednorázové „Add to cart", žádný stepper.

**Návrh — globální skupina `themes/build/won-card-settings.json`:**

| id | typ | volby |
|---|---|---|
| `won_card_add_mode` | select | `button` \| `stepper` (+/− s množstvím) |
| `won_card_add_align` | select | `start` \| `center` \| `end` |
| `won_card_add_reveal` | select | `hover` \| `always` |

Stepper po prvním přidání přepne tlačítko na `− 1 +` a dál mění množství
v košíku přes existující `won-cart.js`.

---

## Testovací workflow (Ondřejův explicitní požadavek)

Klíč: **generické invarianty, žádný výčet sekcí** — aby nový blok byl pokrytý
automaticky a „stejná chyba už nikdy nenastala".

### RAIL-AFFORDANCE — `tests/smoke/won-rail-affordance.spec.ts`
Projde **každý horizontální scroller na každé demo stránce** na 390 / 700 / 1440:

1. Pokud `scrollWidth > clientWidth + 1` (rail reálně přetéká) → **musí** mít
   aspoň jednu viditelnou afordanci (šipky / tečky / lišta).
2. Pokud má šipky → klik na „další" **musí** změnit `scrollLeft`.
3. Pokud NEpřetéká → nesmí být vidět žádná afordance (žádné mrtvé ovládání).

Chytí bod 2 i každý budoucí rail bez ovládání.

### RAIL-CONSISTENCY — `tests/smoke/won-rail-consistency.spec.ts`
Na jedné stránce se všemi raily:

1. Když `won_rail_indicator != per_section` → množina použitých typů indikátoru
   napříč raily má **velikost 1** a odpovídá globální hodnotě.
2. Computed styl šipek (border-radius, background, rozměr) je **identický**
   napříč všemi raily.

Chytí bod 3 a zabrání driftu u dalších sekcí.

### BLOCK-WRAPPER-SELECTORS — statický guard
Grep nad composed motivem: selektor tvaru `> .won-<blok>` = chyba, protože
Shopify vkládá `div.shopify-block`. Chytí bod 1 a jeho čtyři sourozence.

---

## Pořadí prací

1. **Testy první** (RAIL-AFFORDANCE, RAIL-CONSISTENCY, wrapper guard) — musí být
   ČERVENÉ proti dnešnímu stavu, jinak nehlídají nic.
2. Bod 1 (mrtvé selektory) — nejmenší, guard ho ověří.
3. Body 2 + 3 (rail: afordance + globální nastavení).
4. Bod 7 (karta: stepper + zarovnání) — stejný mechanismus jako 3.
5. Bod 6 (gift card) — malé, potřebuje rozhodnutí o přepínači.
6. Bod 5 (CTA napříč sekcemi) — nejširší, nejmenší riziko.
7. Bod 4 — čeká na `SHOPIFY_ADMIN_TOKEN`.
