# Won Discounts: Překlady a vzhled u modulů — měření a rozhodnutí o úložišti

Stav: **změřeno 8. 10. 2026 na `main` `dd48a75`, před první řádkou stránky.** Patří k úkolu 8
([zadání](prompt-ukol8-9.md), plán třetího kola body 11 až 14).

## Co se rozhodlo

| Otázka | Rozhodnutí |
|---|---|
| Kde jsou texty po jazycích | Každý jazyk má vlastní úložiště (`won_discounts` / `tx_<kód jazyka>`). Web načte jen jazyk stránky. Z nastavení pro web klíč `texts` zmizí. |
| Kde jsou čtyři sady vlastního CSS | V nastavení pro web (`storefront_config`), každá pod kořenem svého prvku. Vlastní úložiště nepotřebují. |
| Oprávnění ke čtení jazyků | `read_locales` (dotaz `shopLocales`). |
| Limit velikosti | Nezvedá se. 128 000 B na úložiště, rezerva 4 000 B jako dnes. |

## Limity Shopify (ověřeno v dokumentaci 8. 10. 2026)

- Metapole typu `json`: **128 kB** (shopify.dev „Metafield limits“). Platí pro každé metapole zvlášť.
- Metapole aplikace (vlastník `AppInstallation`, prostý jmenný prostor) čte rozšíření v Liquidu přes `app.metafields`.
  Klíč jde zadat proměnnou v hranatých závorkách: `app.metafields.won_discounts[klic].value`
  (shopify.dev „Liquid objects: metafield“: hranaté závorky vždy hledají metapole podle klíče).
- `shopLocales` vyžaduje `read_locales` nebo `read_markets_home`. Vrací kód jazyka, název, `primary` a `published`.
  Dnešní `read_markets` na něj nestačí.

## 1. Texty po jazycích

Měřeno nad soubory rozšíření (`extensions/won-discounts-storefront/locales/`), 38 upravitelných textů
(bez `outlet.left`, který doplňuje Shopify).

| Případ | Velikost jednoho jazyka |
|---|---|
| Všechny texty přepsané textem dlouhým jako výchozí (česky) | 1 712 B |
| Totéž slovensky / anglicky | 1 728 B / 1 657 B |
| Všechny texty dvakrát delší než výchozí | 2 719 B |
| Nejhorší případ: 38 × 500 znaků, latinka bez diakritiky | 19 743 B |
| Nejhorší případ: 38 × 500 znaků s diakritikou (2 B na znak) | 38 743 B |
| Nejhorší případ: 38 × 500 znaků, čínština (3 B na znak) | 57 743 B |

Zbytek nastavení pro web: prázdný obchod 158 B, velký obchod na Pro (8 sad úrovní, doprava, 5 dárkových stupňů
se 4 variantami, 50 kolekcí v ochraně marže, 4 měny) **3 754 B** bez textů a vlastního CSS; s 10 kampaněmi asi 5 kB.

Kolik jazyků by se vešlo do jednoho společného nastavení (124 000 B po rezervě, minus 5 kB zbytek a 20 kB CSS):

| Délka textů | Jazyků |
|---|---|
| jako výchozí (1,7 kB) | 57 |
| nejhorší případ s diakritikou (38,7 kB) | 2 |
| nejhorší případ, čínština (57,7 kB) | 1 |

**Proč vlastní úložiště na jazyk:**
- Limit 500 znaků na text dovoluje jazyk, který sám zabere 57,7 kB. Dva takové se do společného nastavení nevejdou a
  Pro má jazyků neomezeně. Samostatný jazyk se do 128 kB vejde vždy, takže uložení textů nemůže narazit na limit.
- Celé nastavení pro web se dnes tiskne do každé stránky jako JSON. Texty všech jazyků by tak nesla každá stránka;
  s vlastním úložištěm nese stránka jen svůj jazyk a v JSON nastavení texty nejsou vůbec.

**Jak to bude:**
- Uložené nastavení: `locales` je mapa `kód jazyka → { klíč: text }` v pořadí, v jakém obchodník jazyky přidal.
  Dnešní `cs` / `sk` / `en` jsou tři záznamy téže mapy, čtou se beze změny.
- Na web: jeden zápis `tx_<kód>` na jazyk, který má aspoň jeden změněný text a tarif ho pouští. Jazyk bez textů
  nebo nad limit tarifu své úložiště nemá (smaže se), web pak ukáže výchozí text rozšíření.
- Rozšíření: `app.metafields.won_discounts['tx_' + request.locale.iso_code]`, pak vlastní soubory jazyků.
- **Změna chování:** dnes stránka v jazyce mimo cs / sk / en dostane obchodníkovy anglické texty. Nově dostane jen
  texty svého jazyka, jinak výchozí text rozšíření. Obchod s texty jen v cs / sk / en na stránkách v těchto jazycích
  nepozná rozdíl.

## 2. Čtyři sady vlastního CSS

Limit je 4 000 znaků, jak je obchodník napsal. Na web jde CSS s kořenem prvku před každým selektorem, takže roste
podle toho, kolik má pravidel a jak dlouhý je kořen.

| Napsané CSS (4 000 znaků) | Dnešní společný kořen (92 znaků) | Kořen jednoho prvku (10 znaků) |
|---|---|---|
| běžné (pravidla kolem 85 znaků) | 8 400 B | 4 464 B |
| nejhustší možné (571 pravidel po 7 znacích) | 57 100 B | 10 278 B |

Čtyři sady pod kořeny prvků: běžně kolem **18 kB**, v nejhustším případě kolem **41 kB** (test v jádru: 40 až 50 kB) (4 × 10,3 kB; kořeny
`.won-tiers`, `.won-ms`, `.won-outlet`, `.won-campaign` mají 10 až 13 znaků). S 5 kB zbytku je to nejvýš 46 kB
ze 124 000 B. **Vejdou se, vlastní úložiště nedostanou.** Kontrola velikosti před uložením zůstává na serveru.

Dnešní jedna sada pod společným kořenem může mít až 57 kB; po rozdělení má i nejhustší sada pětinu.

**Jak to je (upřesněno při implementaci):**
- Uložené nastavení: tabulka si nechává dnešní `appearancePreset`, `accent` a `custom` (nic se nepřepisuje),
  `storefront.looks` nese ostatní tři prvky (`milestones`, `outlet`, `campaign`): hotový vzhled, barvu zvýraznění
  a (Pro) vlastní barvy a CSS. Nastavení bez `looks` je staré: jeho barvy se jednou zkopírují k žebříčku, který je
  četl; načíst a uložit podruhé už dá stejný výsledek.
- Na web: jedna šablona stylů jako dnes (`appearance.css`), složená ze čtyř částí.
- **Co se při převodu může změnit:** dnešní CSS platí pod všemi prvky Won. Pravidlo, které míří mimo tabulku
  (košík, štítek výprodeje, kampaň), po převodu k tabulce přestane platit. Podle zadání se CSS reálně používá jen
  u tabulky; převod má test na skutečném tvaru nastavení a na webu se ověří před a po.

## Dluh zjištěný při měření (neřeší se v úkolu 8)

- Vlastní CSS je na stránce dvakrát: jednou v JSON nastavení, jednou ve značce stylů. Skripty ho z JSON nečtou.
  Po rozdělení je to běžně 2 × 18 kB místo dnešních 2 × 8 kB jen tehdy, když obchodník vyplní všechny čtyři sady.
  Odstranit to jde přesunem CSS do vlastního úložiště; zapsáno v build logu.

## Jak měření zopakovat

Výpočet běží nad jádrem (`buildStorefrontConfig`, `scopeCss`) a nad soubory jazyků rozšíření. Hlídají ho testy
`packages/core/tests/discounts/storefront-texts.test.ts` (velikost jazyka v nejhorším případě) a
`looks.test.ts` (velikost čtyř sad v nejhustším případě).
