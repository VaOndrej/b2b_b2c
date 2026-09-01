# Won theme — kompletní E2E testovací matice

Co projít na demo storu, aby se z toho dalo iterovat. Postaveno na
`WonCommerce/Tools/EshopAudit` (94 pravidel v `data/knowledge-base/audit-rules.json`,
váhy v `audit-checklist.md`, mapování blok→pravidlo v `wf-block-catalog.json`).

---

## Proč zrovna takhle

Za jeden den se v této šabloně našlo šest vad. **Ani jedna nebyla vidět na
homepage v defaultním nastavení** — každá seděla v neprošlapané části konfigurační
matice:

| Vada | Kde se schovávala |
|---|---|
| quick add „nefunguje" | fungoval, jen o tom neřekl hostitelskému motivu |
| stepper +/− | globální default byl `button` → jeho test se **skipoval** |
| `dots` indikátor | implementované na 2 ze 4 railů |
| oříznutý packshot | Horizon ignoruje `media_fit`, když `aspect_ratio != adapt` |
| USP strip | rozjede se jen na šířkách, kde se nadpis zalomí |
| sheen na +/− | dvě CSS pravidla o stejnou vlastnost |

Z toho plynou tři pravidla, na kterých ta matice stojí:

1. **Matice, ne procházka.** Testuje se kartézský součin *hodnot nastavení*, ne
   „projdu stránky". Zelená sada v defaultu netvrdí nic o zbytku matice.
2. **`test.skip` navázaný na default = netestovaná funkce.** Každý skip v reportu
   je nález, dokud se neprokáže opak.
3. **Chování, ne přítomnost.** „Třída je v DOM" ≠ „efekt je vidět". Měř computed
   style, geometrii, `animationstart`, stav košíku.

---

## Vrstva 0 — příprava (jednou před během)

```bash
cd ~/Development/WonCommerce/Apps/b2b_b2c
node themes/build/compose.mjs horizon
lsof -ti tcp:9292 | xargs -r kill -9
shopify theme dev -e horizon --port 9292      # počkat na HTTP 200
```

Viewporty: **390** (telefon) · **700** (velký telefon / malý tablet, tady se láme
`--sm-only` chrome) · **1024** (hover afordance) · **1440** (desktop).
Před každým scénářem `fetch('/cart/clear.js', {method:'POST'})` — košík je sdílený stav.

---

## Vrstva 1 — Journey audit (94 pravidel EshopAudit)

Projít jako nakupující, ne jako vývojář. Pro každou stránku odpovědět na
čtyři otázky z `ux-system.txt`: *Vím, kde jsem a co je pro mě? Vím, co dál a láká
mě to? Mám důvod věřit právě tomuhle? Zdržuje mě něco?*

Bodování a váhy podle `audit-checklist.md` (skóre = Σ(score × váha) / Σ(5 × váha)).

### Které oblasti šablona vůbec ovlivňuje

| Oblast (audit-rules) | Pravidel | Šablona to řeší? |
|---|---|---|
| Homepage a navigace | 6 | ANO — won-hero*, won-marquee, won-grid |
| Kategorie a listing | 3 | ANO — won-collection, won-product-card |
| Filtry a řazení | 4 | ANO — won-collection |
| Vyhledávání | 6 | ČÁSTEČNĚ — nativní Horizon, šablona jen umisťuje |
| Produktová stránka | 8 | ANO — won-* PDP bloky |
| Varianty a dostupnost | 3 | ANO — won-variant-picker, won-stock-signal |
| Cena, doprava, vrácení | 3 | ANO — won-price-per-unit, won-shipping-bar, won-policy-* |
| Košík | 4 | ČÁSTEČNĚ — won-cart.js + nativní drawer |
| Checkout | 11 | NE — Shopify. **Vyřadit ze skóre**, jen zaznamenat |
| Mobilní UX | 8 | ANO |
| Důvěryhodnost | 5 | ANO — won-product-trust, won-rating, won-feature |
| Obsah a microcopy | 5 | ANO — defaulty a `info` texty v schématech |
| Výkon a rychlost | 6 | ANO |
| Structured data | 6 | ANO — won-product-schema, won-faq-schema, … |
| Technické SEO | 5 | ČÁSTEČNĚ |
| Přístupnost | 3 | ANO |
| CRO příležitosti | 4 | ANO — offense, ne defense |

**Checkout se neboduje** (nelze změnit), ale pokud pravidlo ukazuje na něco, co
šablona *může* podpořit (např. CHK-005 order summary ↔ won-shipping-bar), zapsat
jako příležitost.

### Mapa blok → pravidla, která má pokrýt

Z `wf-block-catalog.json`, přeložené na won-* názvosloví:

| won blok / sekce | Role ve WF gramatice | Pravidla |
|---|---|---|
| `won-hero`, `won-hero-grid`, `won-hero-carousel` | hero | HP-001, HP-002, COPY-001/004/005, CRO-003 |
| `won-marquee`, `won-grid`+`won-feature` (USP strip) | trustbar / iconfeatures | HP-003, TRU-003, PDP-004, PDP-006, CRO-003 |
| `won-grid`+`won-tile` | categorytiles | HP-005, SEO-002 |
| `won-carousel` (source: collection), `won-tabbed-rail` | productgrid | CAT-002, CAT-003, CRO-001 |
| `won-collection` | filterbar + listing | FLT-001…004, CAT-001, CAT-003, SEO-003 |
| `won-comparison`, `won-band` | comparison / ctaband | CRO-003, CRO-004 |
| `won-panels` (accordion) | accordion / pdptabs | COPY-002, PDP-006, SD-005 |
| `won-grid` (source: articles) | articles | SEO-002 |
| `won-newsletter` | newsletter | CRO-003, CART-004 |
| `won-announcement-bar`, `won-shipping-bar` | announcement | PRC-002, CRO-004 |
| `won-page-header` | breadcrumb | NAV-001, PDP-008, SD-004 |
| PDP sloupec: `won-price-per-unit`, `won-stock-signal`, `won-product-trust`, `won-highlights` | buybox | PDP-001…005, PRC-001, TRU-001, MOB-002 |
| `won-variant-picker` | varianttable | VAR-001, VAR-003, CAT-002 |
| `won-param-table`, `won-nutrition-table`, `won-dosage` | paramtable | PDP-006, SD-001 |
| `won-rating` | reviews | PDP-007, TRU-001/002/005, SD-001 |
| `won-sticky-atc` | mobilní buybox | MOB-002, MOB-007 |
| `won-footer` | footer | TRU-003, SEO-001 |
| `won-shoppable-image`, `won-media-compare`, `won-app-slot` | — | bez přímého pravidla (offense) |

**Nepokryté pravidlo = nález.** Buď chybí blok, nebo existující blok svou roli
neplní. Ověřit (v tomto pořadí): existuje won blok pro breadcrumbs? pro
no-results stav vyhledávání? pro notify-me u vyprodané varianty (VAR-003)?

---

## Vrstva 2 — Konfigurační matice sekcí

Pro **každou** z 27 won sekcí (viz tabulka níže) projít její schéma a vygenerovat
případy:

| Typ nastavení | Co projít | Co ověřit |
|---|---|---|
| `select` | **každou** hodnotu | vizuálně odlišný a smysluplný výsledek |
| `checkbox` | obě | zapnuto vs. vypnuto se liší |
| `range` | min · default · max | žádné přetečení, zalomení, kolaps |
| `color` / `color_scheme` | světlé, tmavé, akcentové | kontrast ≥ WCAG AA (A11Y-001) |
| `image_picker` | nastaveno · prázdné | prázdné = čestný fallback, ne rozbitý layout |
| `richtext` / `text` | prázdné · krátké · velmi dlouhé | nic nevyteče z tlačítka, karty, nadpisu |
| blok-děti | 0 · 1 · max | 0 dětí nesmí být prázdná plocha (theme-block-ux §6) |

Sekce a jejich rozsah (počty ze složeného motivu):

| sekce | nastavení | presety | sekce | nastavení | presety |
|---|---|---|---|---|---|
| won-band | 62 | 2 | won-marquee | 36 | 2 |
| won-carousel | 62 | 3 | won-media-compare | 50 | 1 |
| won-grid | 57 | 10 | won-newsletter | 44 | 2 |
| won-variant-picker | 56 | 1 | won-page-header | 43 | 1 |
| won-panels | 54 | 4 | won-contact | 42 | 2 |
| won-collection | 46 | 1 | won-shoppable-image | 42 | 1 |
| won-comparison | 45 | 1 | won-tabbed-rail | 40 | 1 |
| won-hero-carousel | 44 | 2 | won-announcement-bar | 36 | 1 |
| won-hero | 32 | 4 | won-app-slot | 36 | 1 |
| won-hero-grid | 35 | 1 | won-footer | 35 | 1 |
| won-sticky-atc | 11 | 1 | | | |

Sekce bez presetu (won-accordion, won-articles, won-collection-tiles, won-features,
won-stats, won-tabs) jsou deprecated — v pickeru nejsou, **netestovat**.

**Presety se testují zvlášť:** vlož preset do prázdné šablony a nesahej na nic.
Musí okamžitě vypadat jako hotová sekce (theme-block-ux §6). Preset, který se
vloží prázdný nebo s plovoucími ovládacími prvky, je nález.

---

## Vrstva 3 — Globální matice (Nastavení motivu)

Tohle je ta část, kde se schovávaly dvě z dnešních šesti vad. Každou hodnotu
ověřit **na všech konzumentech naráz**, ne jen na jednom.

| skupina | nastavení | hodnoty | konzumenti, kde to musí platit |
|---|---|---|---|
| Rails | `won_rail_indicator` | per_section · progress · dots · none | won-carousel (slider i grid-rail), won-grid, won-hero-carousel, won-tabbed-rail |
| | `won_rail_arrows` | per_section · always · never | tytéž |
| | `won_rail_arrow_style` | pill · square · soft · minimal | tytéž — computed styl **identický** |
| | `won_rail_arrow_tone` | auto · surface · overlay | `auto` = surface na stránce, overlay přes médium |
| Cards | `won_card_add_mode` | button · stepper | každá karta na HP, PLP, PDP cross-sell |
| | `won_card_add_align` | start · center · end | nesmí kolidovat s badgem |
| | `won_card_add_reveal` | hover · always | `hover` musí mít mobilní ekvivalent |
| Effects | `won_btn_hover` | none · lift · grow · fill · outline | won-btn, karta, formulářová tlačítka |
| | `won_btn_sheen` | off · hover · loop | + přehrání po změně košíku |
| | `won_btn_press` | none · sink | |
| | `won_fx_speed` | fast · normal · slow | |
| Catalog | `won_hide_gift_cards` | on · off | won-carousel, won-collection, won-tabbed-rail |
| Policy | `won_return_enabled` + `_days` + `_country` | on/off × 0/14/90 | won-product-trust, PDP, structured data |
| Animation | `won_countup_default_duration` | 400 · 1600 · 4000 | won-grid (stats) |

**Jak to přepnout bez theme editoru** (headless, opakovatelné):

```bash
node - <<'EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const p='themes/dist/horizon-dev/config/settings_data.json';
const raw=readFileSync(p,'utf8'); const i=raw.indexOf('{');
const d=JSON.parse(raw.slice(i));
d.current.won_rail_indicator='dots';        // ← přepínaná hodnota
writeFileSync(p, raw.slice(0,i)+JSON.stringify(d,null,2)+'\n');
EOF
sleep 8   # theme dev to nasynchronizuje
```

Po skončení `node themes/build/compose.mjs horizon` vrátí dist do demo stavu.

**Výstupem je tabulka „hodnota × rail/karta → co je vidět"**, ne „prošlo".
Přesně takhle se ukázalo, že `dots` byly na půlce railů mrtvá volba.

---

## Vrstva 4 — Datové a stavové okrajové případy

Konfigurace je jen půlka; druhá půlka je, co do bloku přiteče ze storu.

| stav | kde | co musí platit |
|---|---|---|
| kolekce prázdná | won-carousel, won-collection, won-tabbed-rail | čestný empty state, ne rozbitá mřížka |
| 1 produkt v railu | všechny raily | žádné mrtvé šipky/tečky/lišta |
| produkt bez fotky | karta, PDP | placeholder, ne prázdný rám |
| produkt bez popisu | PDP | blok nerenderuje nic (**dnes to tak je** — demo produkty mají prázdný popis) |
| vyprodaný produkt | karta, PDP | označení + neanimuje jako klikatelný (VAR-003) |
| jediná varianta ⇄ více variant | karta, PDP | quick add ⇄ „Vybrat", ppu se přepočítá |
| chybějící metafield | won-price-per-unit, won-rating, won-product-trust | tichý fallback |
| velmi dlouhý název | karta, nadpisy | nezalomí layout |
| gift card | všechny výpisy | skrytá při `won_hide_gift_cards` |
| košík: 0 / 1 / N položek | karta, hlavička, drawer | počítadlo i stepper sedí |
| `prefers-reduced-motion` | celý web | žádná animace, žádný sheen |
| jiné color scheme | všechny sekce | kontrast drží |

---

## Vrstva 5 — Invarianty, které už hlídají testy

Neprocházet ručně, jen spustit — a **číst i skipy**:

```bash
npm run test:smoke        # 241 testů, 2 viewporty
```

Klíčové sady: `won-rail-affordance` (přetéká ⇒ afordance) ·
`won-rail-consistency` (jeden vzhled šipek) · `won-rail-indicator-modes`
(statický guard nad všemi hodnotami) · `won-rail-indicator-scale` (geometrie) ·
`won-cta-effects` (efektová vrstva strukturálně + behaviorálně) ·
`won-settings-coverage` (žádné mrtvé nastavení) · `won-cta-invariants` ·
`won-card-quick-add` · `won-feedback-8`.

---

## Verdikt a klasifikace nálezu

Každá buňka matice končí jedním z:

- **OK** — ověřeno měřením, přiložen důkaz (číslo / screenshot / výstup testu).
- **MRTVÉ NASTAVENÍ** — hodnota nemá viditelný efekt. → oprava zapojení nebo
  hodnota pryč ze schématu.
- **DRIFT** — nastavení platí jen na části konzumentů. → sjednotit do jedné
  implementace (jako `won-rail-controls`).
- **UX NÁLEZ** — funguje, ale porušuje pravidlo z audit-rules. → `id` pravidla,
  závažnost podle jeho `severity`, doporučení podle jeho `recommendation`.
- **PŘÍLEŽITOST** — nic není rozbité, ale chybí schopnost, kterou by dobrý eshop
  měl. Nižší priorita než nález.
- **NEOVĚŘENO** — a proč (chybí data ve storu, potřebuje admin, potřebuje traffic).

Pyramida závažností podle `ux-system.txt`: `critical` 0–1 na stránku, `high`
20–30 %, zbytek `medium` a pár `low`. Při váhání volit **nižší**.

---

## Pořadí běhu

1. Vrstva 5 (levné, hned ukáže regresi) → 2 → 3 (tady je nejvyšší výtěžnost) →
   4 → 1 (nejdražší, potřebuje lidský úsudek).
2. Nálezy seřadit podle `severity × váha oblasti` z `audit-checklist.md`.
3. Opravovat po jednom, **test první, červený, pak fix, pak zelený**.
4. Zápis do `SOURCE/memory/regression-log.md` ve stejné úloze.

## Kdy přestat

Iterace končí, když platí všechno naráz:
- 0 buněk se stavem MRTVÉ NASTAVENÍ nebo DRIFT,
- žádné pravidlo z mapy blok→pravidla není nepokryté bez zdůvodnění,
- skóre podle `audit-checklist.md` ≥ 85 % v každé oblasti, kterou šablona ovlivňuje,
- plná sada zelená a **žádný skip bez zdůvodnění**,
- každý nový nález v posledním kole je `low` nebo `opportunity`.
