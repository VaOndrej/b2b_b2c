# Won generic: vizuální audit zdrojové knihovny — 10. 9. 2026

> Aktualizace11.9.: implementace oprav a závěrečné ověření jsou v [remediation reportu](2026-09-11-won-remediation.md). Níže zůstává původní auditní baseline.

**Rozsah:** 176 případů ve 30 alternativních šablonách, 528 kombinací s viewporty. Skutečně prohlédnuto 525 zobrazených stavů; tři device-scoped stavy jsou správně skryté. [Úplná matice s PNG a URL](2026-09-10-won-visual-matrix.md) · [CSV](2026-09-10-won-visual-matrix.csv).

## 1. Verdikt a ověřené prostředí

Knihovna dokáže sestavit editorial PDP se skutečným nativním nákupem. Nelze ji však označit za vizuálně bezchybnou ve všech variantách: reálný render odhalil chybu externího videa, rozjeté before/after obrázky, kolize badge a slabé přednastavení některých úzkých sloupců. Samotná existence schema nastavení ani zelený test nebyly použity jako vizuální důkaz.

- Zdroj: `themes/won-base`; QA data: `themes/demo/horizon/templates/*won-qa*.json`.
- Build: `node themes/build/compose.mjs horizon`; preview: `shopify theme dev -e horizon`, `http://127.0.0.1:9292`.
- Každá zachycená stránka musí potvrdit `Shopify.shop === b2b-b2c-store-development.myshopify.com` a `Shopify.theme.role === development`. Ověřené ID: **161957216497**.
- Žádný Enervit, Royalbay, jiný store, publikace, změna katalogu ani přiřazení šablon. Generic consumer ani upstream nebyly ručně upraveny.
- Referenční screenshot TheraBeast z Downloads byl skutečně prohlédnut. Srovnání hodnotí skladbu, hierarchii a poměry, nikoli shodu fotografií nebo textů. Figma nebyla použita. QA recenze jsou označené jako ukázky, ruční rating je 0; existující hvězdičky produktových karet pocházejí z dev dat a nebyly během auditu vytvořeny ani změněny.
- Původní stav dist je zálohován byte-for-byte: `/private/tmp/won-qa-preaudit-horizon-20260910`, 571 souborů. Po prvním buildu se z původních souborů změnil pouze manifest; nesouvisející existující source změny byly zachovány.

## 2. Pokrytí a metodika

Zdrojový inventář a přesné varianty: [QA manifest](../../themes/won-base/examples/qa/manifest.json). Spuštění: [QA README](../../themes/won-base/examples/qa/README.md). Inventář zahrnuje 21 aktivních Won sekcí a všech 20 veřejných Won bloků. Šest sekcí bez presetů je označeno jako legacy: accordion, articles, collection-tiles, features, stats a tabs. Jejich kompatibilitní render není součástí aktivní matice.

Každá ukázka má vlastní QA označení mimo produkční komponentu. Obsahové ukázky používají alternativní šablonu skutečné stránky `/pages/contact`; produktové a kolekční případy mají příslušný kontext. Žádná default merchant šablona se nepřepisuje.

Screenshoty jsou pořízeny v Playwrightu při 390, 768 a 1440 px. Během samotného výřezu je skryta pouze globální sticky hlavička, která by jinak překryla část scrollované komponenty; layout komponent ani její ovládání se tím nemění. Obrázky jsou před výřezem vyžádány eager a jejich načtení se zaznamenává. Nejde o pixel-diff. Každý pozitivní vizuální záznam musí mít skutečně prohlédnutý obrázek. Samotný status `captured-not-reviewed` není schválení.

Chybějící hosted video, app block, metafield nebo článek s obrázkem jsou samostatné limity. Placeholder dokládá pouze prázdný stav. Swatch bez barevných dat dokládá textový fallback, nikoli barevné swatche. Ovládání formulářů se testuje bez odeslání zprávy či přihlášení k newsletteru.

## 3. Nálezy podle závažnosti

### P1 — externí video nevyrenderuje přehrávač (implementace, opraveno)

`won-video`, `video_type=external`, qa128. Shopify vypisuje `external_video_tag does not support VideoUrlDrop`, iframe neexistuje. Nastavení `video_url` není objekt produktového média `external_video`. Oprava renderuje iframe podle ověřených `type` a `id` YouTube/Vimeo, se sémantickým title. Dostupnost přehrávání konkrétního externího videa se hodnotí odděleně.

Důkaz před opravou: [video.png](../../tmp/theme-audit-runs/2026-09-10-catalog/video.png). Platformní podklad: [Shopify input settings](https://shopify.dev/docs/storefronts/themes/architecture/settings/input-settings), [external_video](https://shopify.dev/docs/api/liquid/objects/external_video).

### P2 — before/after porovnává různě velké obrazy (implementace, opraveno)

`won-media-compare`, qa034/qa158 a další poměry. U stejného souboru na obou stranách je viditelný schod motivu u dělítka. Before mělo `100vw`, after šířku kontejneru (na 1440 px naměřeno 1440 proti 1320 px). Oprava ponechává obě vrstvy ve stejných rozměrech a mění pouze clip-path podle pozice slideru. Klávesnicová změna 50→51 fungovala i před opravou.

Důkaz: [stejný obrázek před opravou](../../tmp/theme-audit-runs/2026-09-10-catalog/qa158-before-1440.png).

### P2 — spodní badge může zakrýt název dlaždice (implementace, neopraveno)

`won-tile`, overlay label + bottom_left badge, qa120 na 390 px. Oba prvky vlastní stejný dolní prostor; badge je nad textem. Doporučení: vyhradit společnou spodní obsahovou oblast s přirozeným tokem, aby fungoval i víceřádkový nadpis/badge. Pouhé pevné odsazení by dlouhý obsah spolehlivě nevyřešilo.

### P2 — samostatný Won variant picker nesplňuje všechny 44px cíle (implementace, neopraveno)

Mobilní invariant zachytil quantity tlačítka a table toggle; quantity button má zdrojově šířku 40 px. Invariant také hlásí samotné radio inputy v packs konfiguracích; tento signál je třeba hodnotit spolu s větší klikací oblastí labelu, není automaticky další prokázanou chybou. Týká se samostatné sekce, nikoli úspěšně ověřeného nativního nákupu v editorial PDP. Doporučení: sjednotit skutečný interaktivní box na `--won-tap` a opakovat layout ve všech režimech.

### P2 — slabé konfigurace nadpisů a kontrastu (konfigurace / UX presetů)

Na 768 px qa003 rozděluje „ingredients“ na „ingredient“ a samostatné „s“; qa030 vytlačuje čárku na nový řádek. Příčinou je velký nadpis kombinovaný s úzkým procentním max-width. Split testimonial qa005 má v tomto breakpointu velmi úzkou textovou polovinu. Doporučení: menší mezilehlý rozměr nadpisu, širší limit textu a dřívější skládání split karty. Také qa067–069 a vnořená editorial skladba qa165 na 768 tvoří příliš úzké textové sloupce. Desktop qa162 má zase velké prázdno pod kratším sloupcem benefitů; na tento rozdíl navazuje návrh poměru sloupců.

Overlay qa027/qa097 má bílý text na bílé etiketě; qa037 má tmavý text přes tmavé části fotografie. To samo o sobě není důkaz chyby rendereru: je nutné nastavit vhodný scrim/schéma. Cílené qa157 ukazuje minimální transparentní slide se světlým vlastním schématem na tmavém rodiči; výsledný černý text je nečitelný. Minimal transparentní povrch vyžaduje jiné barevné párování; elevated varianta slouží jako kontrolní případ.

### P2 — velká mosaic dlaždice zmizí na tabletu a desktopu (implementace, neopraveno)

`won-grid` mosaic + `won-tile` large, qa019. Na 768 a 1440 má médium výšku 0 px, přestože soubor je načten. Na390 má výšku 477 px. Shopify `.shopify-block` wrapper je skutečný grid item, zatímco span leží na vnitřním odkazu; large média navíc kombinují `aspect-ratio:auto` s `height:100%` bez pevné výšky rodiče. Merchant ztratí hlavní fotografii a vznikne prázdné místo. Doporučení: řešit span na skutečném grid itemu a určit výšku/ratio média bez kruhové procentní závislosti. [768 PNG](../../tmp/theme-audit-runs/2026-09-10-catalog/screenshots/qa019-768.png), zdroj [won-tile](../../themes/won-base/blocks/won-tile.liquid), [won-grid](../../themes/won-base/sections/won-grid.liquid).

### P2 — corner sticky CTA přesahuje viewport (implementace, neopraveno)

qa135, `bar_style=corner`: při 768 px pravý okraj CTA 773,72 px; při 1440 px 1451 px. Na 390 px CTA přesahuje vlastní kartu, zůstává ale uvnitř viewportu. Nejde pouze o ořez locator screenshotu. Kombinace floating shell, obecného `.won-container`, jeho insetů a nesmršťujícího se CTA neudrží obsah uvnitř. Doporučení: v kompaktním floating režimu zrušit globální container sizing/inset a nechat shell obalit vlastní řádek. [Celá stránka768](../../tmp/theme-audit-runs/2026-09-10-catalog/sticky-page-768.png), [měření](../../tmp/theme-audit-runs/2026-09-10-catalog/interactions.json).

### P2 — chevrony editorial review carouselu nejsou viditelné (implementace / barevná konfigurace, neopraveno)

qa161 na 390/768: bílá kruhová tlačítka na cyan pozadí jsou vidět, jejich chevrony prakticky zmizí. Ovládání tak není jasné, i když scroll funguje. Doporučení: ověřit kontrast ikony vůči **vlastnímu povrchu tlačítka**, nikoli jen proti rodičovskému schématu. [Mobil](../../tmp/theme-audit-runs/2026-09-10-catalog/screenshots/qa161-390.png). Přesnou vlastnost způsobující dědění tento audit nedokazuje.

### P3 — circle anotace, zarovnání tabulky a text otevřeného toggle

- qa102: circle anotace chybí, zatímco qa101 underline se zobrazuje. Podezření je na pseudo-element se záporným z-indexem; doporučena kontrola stacking contextu. [PNG](../../tmp/theme-audit-runs/2026-09-10-catalog/screenshots/qa102-1440.png).
- qa149: reálná nutriční data se vykreslí, ale levě zarovnaná záhlaví jsou na desktopu daleko od pravě zarovnaných hodnot. Jde o subjektivní čitelnost tabulky, nikoli chybějící data.
- qa156: i po otevření tabulky tlačítko říká „Show variants table“. Přepnout label na „Hide…“ a zachovat správný expanded stav. [Otevřená tabulka](../../tmp/theme-audit-runs/2026-09-10-catalog/states-qa156-390.png).
- qa055/113/114: mobilní odpovědi v disclosures mají podle review odlišné zarovnání od levého summary; sjednotit záměr v presetu.

## 4. Opravy a opakované ověření

Zdrojové opravy jsou omezené na `blocks/won-video.liquid`, `sections/won-media-compare.liquid` a lokalizovaný fallback title v EN/CS. QA generátor byl opraven pro rozdíl inline_richtext/richtext, platnou existující stránku, skutečné SVG icon cases a správné PPU pravidlo. Produkční block texty ani merchant default templates se nemění.

Po finálním source buildu byly oba cílené regresní testy úspěšné (2/2, 27,3 s). Compare má při pozicích 0/50/100 stejné rozměry obou vrstev na 390/768/1440; keyboard 50→51 funguje. [Mobil po opravě](../../tmp/theme-audit-runs/2026-09-10-catalog/compare-fixed-390.png) · [desktop po opravě](../../tmp/theme-audit-runs/2026-09-10-catalog/compare-fixed-1440.png). Všechny tři snímky byly prohlédnuty.

Externí YouTube iframe nejen existuje: po stisku Play bylo naměřeno `paused=false`, `currentTime=2.34`, `readyState=4`. [Přehrávání](../../tmp/theme-audit-runs/2026-09-10-catalog/youtube-playing.png). Vimeo iframe a ovládání se vykreslí, ale konkrétní veřejné video při Play vrací **Rights issue**; jeho úspěšný playback není potvrzen. [Vimeo limit](../../tmp/theme-audit-runs/2026-09-10-catalog/states-qa175-play.png).

Opakovaný sběr dotčených případů: 57/57 page-viewport testů PASS; následné upřesnění collector diagnostiky 18/18 PASS. Collector nyní rozlišuje výchozí otevřený disclosure, číselný peek režim a očekávaně skryté sticky. Původní nesprávné hlášení těchto kontrol nebylo označeno jako produktová chyba. Externí MCP validace byla automatickou kontrolou zamítnuta kvůli možnému exportu privátních souborů; použita místní oficiální CLI validace a skutečný Shopify upload/render. Nebyla obcházena jiným vzdáleným uploadem zdrojových souborů.

## 5. Prioritizovaná rozšíření knihovny

Nejdřív opravit výše uvedené regresní a konfigurační problémy. Nevytvářet další samostatný FAQ, review, expert, benefits či editorial-cards blok: jejich odpovědnost již pokrývá existující kompozice.

| Priorita / náročnost | Scénář a konkrétní přínos | Typ a základ k reuse | Pole / Shopify zdroje | Desktop a mobil |
|---|---|---|---|---|
| P2 / S–M | Dlouhé benefity vedle portrétu potřebují lépe rozdělit prostor, aby nevznikal nevyužitý vysoký sloupec. | Varianta `won-group` pro dva sloupce. Existující skupiny nyní používají stejné fr; samotný band nenahradí dva nezávislé stacky. | Poměr 1:1, 2:3, 3:2; existující child blocks a jejich dynamic sources. | Nerovné desktop sloupce, na mobilu jeden sloupec v DOM pořadí; bez nového breakpointového datového modelu. |
| P2 / M | Doporučené produkty vedle disclosures mohou vytvořit kratší čitelný seznam než velké vertikální packshot karty. | Řádková varianta společného `won-product-card` snippet/bloku. Reuse ceny, badges, dostupnosti a cart runtime. | `layout=card/row`, velikost média; stávající product reference, cena/PPU/availability. | Malé médium vlevo, obsah a CTA vedle; na mobilu zalamovací řádka s nejméně 44 px ovládáním. |
| P2 / S–M | Instruktážní či portrétní video musí zachovat titulky a celý obraz. | Konfigurace existujícího `won-video`, žádný nový blok. Současné poměry jsou 16:9/4:3/1:1 a hosted cover. | `fit=contain/cover`, poměr 9:16 nebo adaptivní; existující hosted/video_url a heading. | Rozumný max-width portrétu a stejný necropovaný obsah na mobilu. Hosted playback nelze potvrdit bez dostupného média. |

Tyto tři návrhy jsou zatím pouze návrhy; žádný nový typ bloku ani větší redesign nebyl implementován.

## 6. Příkazy a výsledky kontrol

- `node themes/won-base/examples/qa/generate.mjs` — generuje pouze alternativní source/demo QA šablony.
- `node themes/build/compose.mjs horizon` — první QA build PASS; původní dist obsah zachován kromě manifestu.
- `npx shopify theme dev -e horizon` — preview správného development storu.
- `npm run test:smoke -- --reporter=line` — baseline přerušen kvůli řízenému QA buildu:118 passed,1 failed,11 skipped,1 interrupted,269 did not run. Nejde o zelený celý gate. Selhání `won-feedback-8` očekávalo prázdný košík po decrementu, naměřilo2 položky; bez cílené reprodukce není klasifikováno jako jistá regrese produktu.
- `WON_EDITORIAL_QA=1 npm run test:smoke -- --reporter=line` — **369 passed, 32 skipped, 3 failed (18,9 min)**. Decrement stepper selhal na desktopu i mobilu; burst-toast test na desktopu. [Úplný log](../../tmp/theme-audit-runs/2026-09-10-catalog/final-smoke.log).
- Izolované opakování desktopových selhání: `npm run test:smoke -- --grep 'card quick-add renders a stepper once the line exists|a burst across different cards is capped at the configured maximum' --project=desktop --reporter=line` — **1 passed, 1 failed (25,5 s)**. Toast tentokrát prošel; decrement selhal opakovaně. [Log](../../tmp/theme-audit-runs/2026-09-10-catalog/isolated-failures.log).
- `WON_CATALOG_QA=1 npm run test:smoke -- --grep 'QA catalogue' --project=desktop --reporter=line` — collector s vlastními viewporty390/768/1440; kladný exit sám o sobě neznamená vizuální PASS, viz per-case výsledky.
- `npx shopify theme check --path themes/dist/horizon-dev --output json` — před opravami 64 souborů s offenses, hlavně 16134 MatchingTranslations, dále starší UndefinedObject/UniqueStaticBlockId a deprecated won-stats ParserBlockingScript. Žádný QA template offense; nepovažovat za čistou full-theme bránu.
- Finální `theme check`: 64 souborů s offenses; 16163 MatchingTranslations (+29 kvůli novému EN/CS klíči title, který ostatní upstream jazyky nemají), ostatní počty stejné. Žádný offense v `won-video`, `won-media-compare` ani QA šablonách. Lokalizace ostatních jazyků zůstává technickým dluhem.
- `node tmp/theme-audit-runs/2026-09-10-catalog/targeted.mjs` — native variant ID48665842909425, cena88595 centů odpovídá$885.95, správné přidání, restore HTTP200 a identický prázdný košík; sold-out submit disabled.

### Interakce, konzole a assets

Cílené skripty [interactions.mjs](../../tmp/theme-audit-runs/2026-09-10-catalog/interactions.mjs), [interaction-states.mjs](../../tmp/theme-audit-runs/2026-09-10-catalog/interaction-states.mjs) a [final-media.mjs](../../tmp/theme-audit-runs/2026-09-10-catalog/final-media.mjs) se spouští pomocí `node <cesta>` proti 9292:

- Kontakt a newsletter (oba presety): 12/12 kombinací odmítlo neplatný email a přijalo syntakticky platný; žádný formulář nebyl odeslán.
- Carousely qa168–172: 15/15 kliknutí Next změnilo pozici. Autoplay-on samovolně postoupil na všech šířkách; off zůstal stát. Hover timer správně zastaví. Loop-always se vrací; mobile-only loop na 390 funguje a na 768/1440 je koncová šipka správně disabled. U autoplay 1440 kolidoval pokus měřit konec se samotným časovačem; tento konkrétní wrap není samostatně prokázán.
- Hotspoty qa043/145/146: 9/9 tap/hover/focus stavů zobrazilo kartu; 13 doplňkových screenshotů hotspotů, tabulek a Vimeo bylo skutečně prohlédnuto. [Review stavů](../../tmp/theme-audit-runs/2026-09-10-catalog/review-interaction-states.json).
- Expanded/tab-switch a carousel invariant/scroll záznamy jsou v per-case JSON; po opravě diagnostiky nezůstává neúspěšná per-case kontrola. To neřeší samostatné page-level tap-target nálezy.
- `assertResponsiveSane`: 23/30 QA stránek na 390 PASS, 7 FAIL kvůli malému ovládání Won variant pickeru. To je otevřený nález, nikoli omluvený zeleným collectorem.
- Žádná finální zachycená CSS/JS/image/font asset odpověď nemá HTTP≥400. Konzole přesto obsahuje Shop.app CSP/403 a přerušené analytické requesty. Jeden page error na page5/390 hlásí nenalezený header section v section-rendering response. Není prokázána příčina v Won komponentě a nelze tvrdit čistou konzoli. [Souhrn signálů](../../tmp/theme-audit-runs/2026-09-10-catalog/coverage-summary.json).

Samostatná cílená reprodukce stepperu (`node tmp/theme-audit-runs/2026-09-10-catalog/cart-repro.mjs`) následně v nových kontextech na 390/1440 našla po dvou decrementech správně 0 položek, ihned i po 500/1500/3000 ms čekání; oba košíky byly obnoveny. [Data reprodukce](../../tmp/theme-audit-runs/2026-09-10-catalog/cart-repro.json). Výsledky jsou rozporné: není potvrzena trvalá chyba košíku ani přesná příčina testové nestability. Smoke selhání se tím nemažou a zůstávají důvodem neuzavřeného gate.

## 7. Limity a kritický self-audit

- Hotové a ověřené: správný dev store/theme, skutečný render a prohlédnuté screenshoty v matici, cílený nativní nákup a obnova košíku.
- Hotové, ale ne plně ověřené: schopnosti vyžadující hosted média, app blocks, chybějící param metafield/obrázky článků; Vimeo playback selhal na externích právech. Tyto stavy nelze vydávat za funkční obsahové varianty.
- Vědomý kompromis: barevné swatche mají pouze textový fallback (produkt má option balení), plné admin add/reorder/reload a všechny možné hover/keyboard interakce každé kombinace nebyly pokryty. Vizuální PASS není plné funkční schválení. Dále nezkouší se kartézský součin barev, paddingů, ikon a všech globálních theme settings. Nové QA stránky mohou být dlouhé, jde o katalog, nikoli návrh délky merchant stránky.
- Theme Editor add/remove/reorder/reload přes přihlášený admin není ekvivalentem storefront preview a nebyl tímto auditem prokázán.
- Nezelený celý smoke gate a další neopravené nálezy jsou uvedeny výslovně; audit neznamená schválení k publikaci.


Roadmapa `docs/product-roadmap.html` byla synchronizována: katalog, obě ověřené opravy i otevřené nálezy jsou uvedené bez tvrzení o uzavřeném release gate. Zdrojové opravy, demo šablony a dokumentace zůstávají v pracovním stromu; žádný publish ani commit nebyl proveden.

Ověření před předáním: odkazy reportu, matice a README se lokálně rozliší bez chyb; `git diff --check` u dotčených source oprav, lokalizací a roadmapy prošel. Dva nové Playwright soubory byly formátovány Prettierem.
