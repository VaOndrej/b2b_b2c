# Won knihovna: brána kvality a co z ní vypadlo

Stav: 2026-09-08 — 86/86 prochází bránou (2 varování `THIN`).

## Co bylo špatně na mém postupu

Jediná automatická kontrola byla „výška sekce do 8 % originálu". Tou projde:

- blok, ve kterém zbyl jen nadpis (`product_carousel`),
- tabulka s rozjetými sloupci (`comparison_table`),
- marquee, který třikrát opakuje totéž.

Zbytek jsem ověřoval okem na třech čtyřech sekcích z 86. To není ověřování, to je
vzorkování — a proto jsem opakovaně tvrdil „hotovo" nad věcmi, které hotové nebyly.

## Brána

`src/wireframe/won-library/verify.mjs` — projede celý payload, měří obsah a
strukturu, spadne nenulovým kódem. Pět pojmenovaných tříd, aby šlo iterovat
podle čísel místo podle dojmu:

| kód | co hlídá |
|---|---|
| `EMPTY` | blok nemá dost obsahu, aby z něj šlo něco poskládat |
| `LOSS` | proti theme dev se v převodu ztratil text nebo médium |
| `COLUMNS` | opakované položky nemají zarovnané sloupce |
| `OVERFLOW` | dítě přesahuje rodiče → ve Figmě překryv |
| `DUPLICATE` | kontejner opakuje tutéž sekvenci (marquee track) |

Přesahy se měří na skutečně vyrenderovaném HTML, ne ze statických dat — jinak by
kontrola nevěděla nic o zalomení textu. Renderer je proto vyčleněný do
`preview-render-lib.mjs` a sdílený s porovnávacím listem, aby brána hlídala
přesně to, co se ukazuje.

## Výsledek prvního běhu: 52/86 prošlo

### EMPTY (6) — chybí vstupní data, ne převod
- `won-carousel--product-carousel` — preset má `source: collection`, ale žádnou
  kolekci. V theme dev je prázdný taky. **Fix:** content pack doplní demo
  kolekci s produkty.
- `won-page-header`, `won-announcement-bar` — z podstaty jednořádkové.
  **Fix:** vlastní práh, obecný na ně nesedí.

### COLUMNS (10) — chyba převodu, nejvyšší priorita
Každý řádek tabulky/mřížky si odvozuju zvlášť, takže sloupce driftují
(`comparison_table` až 937 px). **Fix:** když jsou sourozenci řádky se stejným
počtem dětí, odvodit sloupcový model společně — jedna sada x pro všechny řádky,
jinak spadnout na absolutní pozicování.

### OVERFLOW (19) — dvě různé věci pod jedním kódem
- **Pseudo dekorace** (`::after` o 16–60 px, FAQ): chyba v mém umístění.
- **Karusel / marquee** (`won-slide__body`, `won-marquee__group`, až 1617 px):
  rail je schválně širší než sekce a posouvá se. Ve wireframu to nedává smysl —
  blok má ukázat první slide a náznak dalšího. **Fix:** vlastní pravidlo pro
  rail, ne obecný layout.

### DUPLICATE (5) — marquee a `footer__pay`
Track se duplikuje kvůli plynulé smyčce. **Fix:** poznat opakovanou sekvenci a
nechat jen první průchod.

### LOSS (2) — `comparison_table` ztrácí 15 znaků
Text v buňkách mizí. Podezření na `inlineRun` nebo na ořez klipem.

## Pořadí oprav

1. `COLUMNS` — rozbíjí tabulky a mřížky, čistá chyba převodu.
2. `OVERFLOW` u pseudo dekorací — čistá chyba převodu.
3. `DUPLICATE` + `OVERFLOW` u railů — jedno společné pravidlo pro karusel/marquee.
4. `EMPTY` — data do content packu.
5. `LOSS` — dohledat, kde se text ztrácí.

Brána se pouští jako poslední krok řetězu a nesmí se obcházet.


## Druhé kolo: brána měřila špatnou věc

První verze kontrolovala **data payloadu**. Tvrdila, že comparison tabulka je
v pořádku, protože naměřená x sedí — jenže auto-layout položí obsah jinam, takže
v renderu se sloupce rozjížděly. Stejně tak pustila blok, který místo obsahu
ukazoval `Liquid error`, protože „text tam je".

Co se změnilo:

- **COLUMNS a OVERLAP se měří na vyrenderovaném DOM**, ne nad payloadem.
- **`ERROR`** — text obsahující `Liquid error` nebo `Translation missing` je pád.
  (Hláška se předtím nenašla, protože jsem hledal v textu ořezaném na 40 znaků.)
- **`OVERLAP`** hledá překryv mezi textovými vrstvami. Původní verze
  přeskakovala absolutně umístěné prvky — tedy přesně ty, kde překryv vzniká.

## Nalezené a opravené vady

| vada | příčina | oprava |
|---|---|---|
| `won-collection` ukazoval Liquid chybu | sekce stránkuje `collection.products`, na homepage není `collection` skutečná kolekce | třetí šablona `collection`, fotí se na `/collections/automated-collection` |
| `won-shoppable-image` ukazoval Liquid chybu | motiv volá `'lifestyle' \| placeholder_svg_tag`, což není platný Shopify placeholder — **vada motivu** | content pack dosazuje existující `won-lifestyle-1.svg` |
| comparison měl rozjeté sloupce | každý řádek si odvodil vlastní auto-layout | řádkům se auto-layout vypne, buňky si udrží naměřené x |
| product carousel byl prázdný | preset nemá kolekci | demo kolekce v content packu |

První pokus o opravu sloupců přepisoval geometrii podle mediánu a rozbil tím
formuláře, které tabulka nejsou. Správné řešení geometrii nemění — naměřené
sloupce zarovnané už jsou, jen je nesmí rozházet auto-layout.

## Třetí kolo: zbylé čtyři

| vada | co to bylo | oprava |
|---|---|---|
| patička `COLUMNS` 438 px | falešný poplach: horní a spodní pruh patičky jsou obojí plná šířka o dvou buňkách, ale 300+720 vs 420+271 spolu nesouvisí | sloupec musí mít napříč řádky i podobnou šířku |
| `won-facet__list` `COLUMNS` 28 px | totéž | totéž |
| sticky ATC `OVERLAP` 17 px | motiv název produktu ořezává třemi tečkami; naměřená šířka je ta ořezaná, ale hug sizing text roztáhl na plnou délku a překryl cenu | `text-overflow: ellipsis` se veze do payloadu, takový text drží naměřenou velikost (`textTruncation: 'ENDING'` ve Figmě) |

## Vada motivu — opravená

`sections/won-shoppable-image.liquid:40` volá
`{{ 'lifestyle' | placeholder_svg_tag: … }}`. Shopify placeholder `lifestyle`
neexistuje, takže sekce bez obrázku vyrenderuje Liquid chybu do storefrontu.
**Opraveno v motivu** (`lifestyle` → `lifestyle-1`), obcházka v content packu
zrušena, aby se testovala skutečná cesta motivu.


## Čtvrté kolo: ověřování přímo ve Figmě (2026-09-08)

Do té doby jsem ověřoval jen HTML render — proxy, která neuvidí, že si rám ve
Figmě hugnul výšku nebo že tlačítko 44 px vyšlo 46 px. Obojí musel nahlásit
Ondřej.

`src/wireframe/won-library/verify-figma.mjs` teď čte **skutečný soubor** přes
Figma REST API a porovnává ho s payloadem: šířka komponenty, smrsknuté vrstvy
(`SIZE`), chybějící dekorace textu (`DECORATION`).

**Placený plán potřeba není** — REST na čtení funguje s osobním tokenem
(scope „file read"). Dev Mode MCP by paid seat chtěl, ale na tohle není potřeba.

První běh potvrdil obě hlášené vady tvrdými čísly:

    frame/won-tile__media     294x167   ← hugla ze 391 (jen odznak + padding)
    media/won-tile__media     294x391   ← ostatní dlaždice
    frame/won-carousel__arrow  44x46    ← má být 44x44

**Pozor na kvótu API.** První verze tahala podstromy po dávkách (22 požadavků)
a vyčerpala limit; Figma pak vrací 429 s `Retry-After` v řádu dnů. Opraveno na
JEDEN dotaz `GET /v1/files/:key`. Na absurdní `Retry-After` se nečeká, skončí se
hláškou.

## Křehké místo: slučování inline textu

Tři kola po sobě šla oprava a z ní nová vada:

1. přeškrtnutá cena se ztrácela → zakázáno slučovat potomka s dekorací
2. tím se rozbily podtržené odkazy ve větách (10× `OVERLAP`) → slučuje se dál
   podtržení, nesloučí se jen přeškrtnutí
3. uzel s vlastním textem i nesloučeným potomkem dostal šířku celého rodiče
   (2× `OVERLAP`) → rozsah vlastního textu se měří přes `Range`

Brána to pokaždé chytila. Kdo tu logiku bude měnit, ať počítá s tím, že se
změna projeví na druhém konci (ceny ↔ odkazy ve větách).
