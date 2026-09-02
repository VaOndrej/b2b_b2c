# Vrstva 1 — vyhledávání (HP-004, SRH-004) a karta ve výsledcích

Datum: 2026-09-02 · Rozsah: `themes/won-base`, `themes/build`, `tests/smoke`

## 1. Search v hlavičce — hotovo

### Nález
Horizon vykresluje vyhledávání jako **ikonu lupy**. `sections/header.liquid:9-13` natvrdo
nastaví `search_style = 'modal'`, `snippets/search.liquid` z toho udělá `<search-button>`,
který otevře `#search-modal`. Jediný `input[name="q"]` na stránce sedí uvnitř zavřeného
`<dialog>` — zákazník nemůže začít psát, dokud ikonu nenajde a neklikne.

- **HP-004** (vysoká): „Vyhledávací pole musí být plně viditelné bez klikání na ikonu."
- **SRH-004** (vysoká): pole má být viditelné **a sticky** i při scrollu, na desktopu i mobilu.
- **SRH-006**: searcheři konvertují +200 %. Ikona je tedy ztráta tržeb, ne úspora místa.

### Proč ne přepsat `snippets/search.liquid`
Konvence **C7** zakazuje vytvořit soubor, jehož jméno koliduje s base motivem. Řešení proto
jde přes **compose krok 2f**, který v `dist` přesměruje dvě volací místa v `sections/header.liquid`
na `won-search`. Ten buď vykreslí pole, nebo předá render zpátky Horizonu (`render 'search'`).
Base zůstává nedotčený, návrat k původnímu chování je jedno nastavení.

### Co se stalo
| soubor | co |
|---|---|
| `themes/won-base/snippets/won-search.liquid` | nový; pole nebo ikona podle `won_header_search_style` |
| `themes/build/won-search-settings.json` | globální skupina „Won — Vyhledávání v hlavičce" |
| `themes/build/compose.mjs` (2f) | přepojí 2 volání v `header.liquid`, zavře modal v `theme.liquid` |
| `themes/won-base/locales/*.json` | 10 schema klíčů + storefront placeholder (cs + en) |
| `tests/smoke/won-header-search.spec.ts` | 7 testů × 2 breakpointy |

### Rozhodnutí, která stojí za zápis
1. **Pole je `predictive-search-component`, ne prostý formulář.** Komponenta funguje i mimo
   dialog (`get dialog()` vrací `null` a všechny dialogové větve jsou `if (dialog)`), takže
   našeptávač zůstal zachovaný i mimo modal — jinak by přechod na pole vyhodil SRH-001.
2. **V režimu `field` se modal nerenderuje vůbec.** Jinak by na stránce byly dvě vyhledávání
   a po prvním dotazu **dvě `#predictive-search-results`** (morph vloží markup sekce, která
   to id má natvrdo). CSS tím netrpí: `{% stylesheet %}` se kompiluje do jednoho
   `compiled_assets/styles.css` pro celý motiv, ne podle toho, co se na stránce vykreslí —
   ověřeno tím, že bundle obsahuje `.search-page-input` i na homepage, kde se ten blok nerenderuje.
3. **Skryté inputy `type=product` a `options[prefix]=last`.** `sections/search-results.liquid:29`
   plní grid jen `where: 'object_type', 'product'`, ale počítá `search.results_count` přes
   všechny typy — bez `type` se rozejde počet a mřížka. Bez `prefix` neprojde částečné slovo
   („krea" najde našeptávač, ale ne výsledková stránka).
4. **Mobil: vlastní řádek uvnitř sticky hlavičky.** Mobilní grid hlavičky má 5 sloupců
   `44px 44px 1fr 44px 44px`; pole vedle loga má 44 px. Přidán druhý grid řádek `search`.
5. **`margin-inline: 0` a `width: 100vw` na mobilu.** Base dává `predictive-search-component`
   `margin-inline: auto`; mobilní grid hlavičky je 401 px široký na 390px viewportu
   (střední `1fr` track roste na min-content názvu obchodu — **Horizonův vlastní přetok**,
   kvůli kterému je oříznutá i ikona košíku), takže auto margin pole odsadil o 6 px doprava.

### Důkaz
- `tests/smoke/won-header-search.spec.ts` — 14/14 zelených (7 testů × desktop + mobil).
- **Red-proof:** `won_header_search_style: 'icon'` v `dist/config/settings_data.json` →
  6/6 spadne, modal i `search-action` se vrátí, `#predictive-search-results` je jedno.
- Screenshoty: `tmp/shots/header-search-{desktop,mobile}.png`, `-typed.png` (našeptávač
  s produktovou kartou a cenou).
- Geometrie: mobil komponenta 0→390 (přesně viewport), lišta 16→374; desktop pole 334 px,
  lišta 387 px. `document.scrollWidth == innerWidth` na obou → žádný vodorovný přetok.
- MCP `validate_theme`: `won-search.liquid`, `theme.liquid`, `settings_schema.json` a obě
  locale ✅. `header.liquid` hlásí 2 chyby + 2 varování — **identické na nedotčeném
  `themes/bases/horizon/sections/header.liquid`**, tedy Horizonovy, ne moje.

## 2. Karta ve výsledcích vyhledávání — hotovo

### Nález
`sections/search-results.liquid` vykresloval `content_for 'block', type: '_product-card'` —
nativní Horizon dlaždici. Kolekce přitom jedou přes `won-collection.liquid:82` →
`won-product-card`. Výsledky vyhledávání byly jediná výpisová plocha bez hodnocení, ceny za
jednotku a quick-addu — přesně tam, kde je zákazník s nejvyšším nákupním záměrem.

### Oprava
Compose krok **2g** vymění v `dist` jen dlaždici:
`{% render 'won-product-card', product: product, aspect: 'portrait', show_ppu: true %}`.
Filtry, řazení, stránkování i infinite scroll zůstávají Horizonovy, `ref="cards[]"` na `<li>`
(počítá ho `results-list.js`) je netknuté. Ověřeno na dotazu s výsledky: Availability, Price,
Sort, „1 item" i přepínač zobrazení se renderují dál.

Stejné volání má i `sections/product-recommendations.liquid`, `sections/product-list.liquid`,
`blocks/product-recommendations.liquid` a `sections/main-collection.liquid` — demo šablony je
nepoužívají, takže zůstaly nedotčené (jedna oprava = jedna změna).

### Důkaz
- `tests/smoke/won-listing-parity.spec.ts` 2/2. **Red-proof:** vrácení `_product-card` v dist →
  spadne s „shows rating in the collection but not in search results".
- Screenshoty `tmp/shots/search-results-{desktop,mobile,real}.png`.
- MCP `validate_theme` na `sections/search-results.liquid` ✅.

### Past, na kterou jsem šlápl
První verze testu porovnávala **celé mřížky** („kolik dlaždic má hodnocení") a četla dlaždice
z celého dokumentu. Mobilní menu drawer (`menu-drawer__featured-content-list`) renderuje
`resource-card` s odkazem na produkt A cenou → sonda porovnávala won kartu proti navigační
miniatuře a hlásila falešný nález. Opraveno na: **jeden produkt sám se sebou**, sonda scopovaná
na `#MainContent`.

## 3. Otevřené nálezy z téhle dávky

1. **Na `/search` jsou teď dvě vyhledávací pole** — hlavičkové a to ze sekce `search-header`
   (blok `_search-input`). Před změnou bylo v hlavičce jen lupa, takže se to nebilo. Řeší se
   jednou položkou v `themes/demo/horizon/templates/search.json` (merchant data, ne kód) —
   ale je to rozhodnutí, ne bug: některé eshopy velké pole na výsledkové stránce chtějí.
2. **Stránkové pole neposílá `options[prefix]=last`.** `blocks/_search-input.liquid` má hidden
   `type=product`, ale ne `prefix`; `search-page-input.js` řeší jen Escape, Enter jede nativním
   submitem. Takže „krea" z hlavičky produkt najde, ze stránkového pole ne. Fix = další compose
   krok, který do toho bloku doplní hidden input.

## 4. Dobráno („oprav vše, co jsi vynechal") — 2026-09-02

| co bylo otevřené | stav | důkaz |
|---|---|---|
| dvě pole na `/search` | opraveno (compose 2h) | `won-search-inputs.spec.ts` |
| stránkové pole bez `options[prefix]=last` | opraveno (compose 2i) | tamtéž, red: `prefix: null` |
| compose přepisoval 554 souborů → dev server throttlován | opraveno (staging + `syncTree`) | `won-compose-idempotence.spec.ts`, `sync: 17` místo 554 |
| C3 upload gate nikdy neproběhl | proběhl | `shopify theme push -e horizon --development --json` → exit 0, `tmp/c3-push.json` |
| dots počítaly stránky (4 slidy = 3 tečky) | opraveno | `won-rail-dots.spec.ts`, red: 2/3/5 teček |
| prohozené demo packshoty | opraveno a nahráno na dev store | `tmp/shots/packshots-live-*.png`, `won-packshot-labels.spec.ts` |

### Packshoty — nahráno 2026-09-02

18 packů (dřív 9), 1 produkt = 1 packshot, jméno na obalu odpovídá názvu produktu.
Zapsáno na `b2b-b2c-store-development.myshopify.com` po výslovném go omezeném na tento store:
**16 produktů + 4 kolekce**, každý nahradil právě 1 obrázek.

- Záloha před zápisem: `tmp/backup-products-2026-09-02.json` (27 produktů, 22 s obrázkem, URL + alt).
- Ověřeno re-dumpem (`tmp/after-products.json`): 16/16 produktů má očekávaný soubor.
- Storefront: `tmp/shots/packshots-live-{desktop,mobile}.png`.
- E2E fixtures a Gift Card `PROTECT()` vynechal — na storefrontu mají dál původní stock fotky.
- `won-pack-recovery.png` zůstal nepoužitý: produkt Recovery Amino na storu není.
- Admin token: `shpat.md` v kořeni repa (je v `.gitignore`), načítat přes
  `export SHOPIFY_ADMIN_TOKEN="$(grep -o 'shpat_[A-Za-z0-9]*' shpat.md)"`.

**Pozor:** `seed-store-images.mjs --apply` je destruktivní — `replaceProductMedia()` napřed volá
`productDeleteMedia` na všechna stávající media produktu. Sloupec "replaces N existing image(s)"
v dry-runu je proto potřeba přečíst, ne přeskočit.

### Co dál zůstává otevřené

- `selling-plans-ski-wax`: `won.servings=60` je na produktu, ale platí i pro variantu „Sample" —
  store data, admin write.
- Quick-add coverage stojí na jediném single-SKU produktu (druhý vrací 404) — store data.
- Plné bodování EshopAuditu podle `audit-checklist.md` (≥ 85 % na oblast) zatím nespočítané.
