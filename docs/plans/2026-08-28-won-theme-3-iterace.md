# Won theme — 3 iterace k „vypadá to jako kvalitní šablona"

Zadání (Ondřej, 28. 8. 2026): doplnit chybějící recepty ve stejné kvalitě jako
stavíme won- komponenty → projít všech 27 sekcí → design systém + HP.
Obrázky: CSS/Playwright render pipeline (ne fotky — ty nemám čím vygenerovat).

## Kde se pracuje

**Všechno v monorepu.** Deploy repo `won-theme-generic` je artefakt — do něj to
teče přes `theme:publish`. Konkrétně:

| Co | Kam | Proč |
|---|---|---|
| won komponenty | `themes/won-base/{sections,blocks,snippets,assets}` | W1 — won-base vlastní kód |
| demo recepty | `themes/demo/horizon/templates/` | W1 — `templates/*.json` NESMÍ do won-base |
| brand settings_data | `themes/demo/horizon/config/settings_data.json` | totéž; compose krok 4 kopíruje rekurzivně |
| render obrázků | `themes/demo/tools/render-*.mjs` + `scenes/` | dev nástroj, vedle `reskin-products.mjs` |

Recepty jsou **aditivní**: vezmou pristine Horizon šablonu (nativní `main` je
hluboce nakonfigurovaný auto-generovaný blok — nesahat) a **přidají won sekce
kolem ní** do `order`.

## Iterace 1 — chybějící recepty (+ podpora)

### 1a. Render pipeline pro obrázky — ✅ HOTOVO 28. 8.
`themes/demo/tools/render-product-images.mjs` — HTML scéna → headless Playwright
screenshot @2x → WebP/PNG do `themes/won-base/assets/`.

Scény: dóza (tub), sáček (pouch), krabička (box), hero kompozice, lifestyle
podklad pro shoppable/recept. Studiové pozadí, válcové stínování, závit víčka,
etiketa s reálnou typografií, kontaktní stín, jemné zrno.

Výsledek: 10 assetů, **4,8 MB PNG → 940 kB JPEG** (`asset_url` neresizuje ani
nekonvertuje do WebP, takže na váze v `assets/` opravdu záleží). Přejmenování
`.png`→`.jpg` proběhlo zároveň v presetech (won-hero, won-hero-carousel,
won-hero-grid, won-band) i v demo `index.json`.

### 1a-bis. Živá vizuální kontrola — ✅ HOTOVO 28. 8.
`shopify theme dev -e horizon` + Playwright na 1440 a 390. Compose i MCP
`validate_theme` byly zelené celou dobu — všechny tři nálezy jdou vidět jen
v prohlížeči:

1. **Text se překrýval s produktem** na heru i promo kartách, na desktopu
   i mobilu. Příčina byla moje kompozice: subjekt vpravo funguje jen na širokém
   viewportu. Nové pravidlo — subjekt patří do **pravého horního kvadrantu**
   (průnik zón, kam overlay text nesahá ani v jednom ořezu).
2. **Hero neměl na mobilu řešení jednou kompozicí** (text sahá k 66 %, mobilní
   ořez ukazuje 35–65 %). Doplněno `image_asset_mobile` do `won-slide` +
   portrétová scéna `won-hero-product-mobile.jpg`.
3. **`<picture>` tiše rušil `height: 100%`** na vnořeném `<img>` → 44px pruh
   holého pozadí pod hero obrázkem na 390px. Postihovalo to i původní
   `image_mobile`. Fix: `.won-slide__media picture { display:block; ... }`.
   Spec `tests/smoke/won-slide-art-direction.spec.ts`, RED ověřeno.

Shoppable sekce přepnuta na `won-lifestyle-1.jpg` s hotspoty na Whey a Kreatinu.

**Pouch je nejslabší** primitivum — má správnou siluetu i matný povrch, ale
pořád čte spíš jako matná dóza než jako stojací sáček.

**Nejsilnější zbývající vizuální problém není v motivu:** produktové obrázky
na dev storu jsou staré ploché placeholdery v duhové paletě (hnědá/zelená/žlutá/
fialová) a bijí se s novou coral/charcoal soustavou. Jsou to data storu, ne
theme assety — mění se přes Admin API (`themes/demo/tools/reskin-products.mjs`),
což chce výslovné „go".

Assety jdou později vyměnit za reálné fotky přepsáním souboru — jméno je kontrakt,
ne technika.

### 1b. `blocks/won-recipe.liquid` (fáze D)
Poslední chybějící kus fáze D — `won-shoppable-image` (hotspoty) i magazín
(`won-grid` se zdrojem `articles`) už existují.

- suroviny + kroky + navázané produkty
- reuse `won-howto-schema` snippetu (už v repu, dnes ho renderuje jen `won-dosage`)
- reuse `won-product-card` na navázané produkty
- podléhá `theme-block-ux.md`: jeden flexibilní blok s range, `info` u každého
  neobvyklého settingu, corner radius, `t:` klíče v OBOU locale schématech (C4)

### 1c. 9 chybějících receptů
`page` · `blog` · `article` · `search` · `cart` · `404` · `list-collections` ·
`page.contact` · `password`

Vzor u každého: nativní `main` beze změny + won sekce kolem.

## Iterace 2 — průchod všech 27 sekcí
Sekce po sekci proti `theme-block-ux.md` (8 pravidel) + responzivita 390/1440.
Backfill: corner radius, `info` u settingů, kanonická id (`columns_desktop`,
`content_align`, `<name>_button_label`), CTA přes `won-button`, carousel
navigace gated na reálný overflow, `prefers-reduced-motion`.

## Iterace 3 — design systém + HP
- kurátorovaný `config/settings_data.json` (Won paleta, font pairing, 5 color schemes)
  — dnes je bit-identický s vendor Horizonem, takže demo běží na stock barvách
- revize `won-tokens.css` (spacing rytmus, stínová škála, radius škála, tap target)
- přeskládaná `index.json` — 20 sekcí je moc, hierarchie a rytmus

## Důkaz
Každá iterace se uzavírá: `validate_theme` (MCP) + `compose` obou tratí +
Playwright screenshoty na 390 px a 1440 px + committed spec u chování.
