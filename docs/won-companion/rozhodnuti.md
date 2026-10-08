# Won Companion — rozhodnutí z brainstormingu

Pracovní log rozhodnutí (od 2026-09-28, aktualizace 2026-10-01). Nejnovější rozhodnutí
Ondřeje mají přednost před staršími zápisy; produktová roadmapa je synchronizovaná.
Jde o návrh, nikoli implementovanou nebo otestovanou aplikaci.
Související: [`konkurence.md`](konkurence.md), karta Won Companion v [`../product-roadmap.html`](../product-roadmap.html).

Produktový audit A–O a návrh master specifikace:
[`product-blueprint-v1.md`](product-blueprint-v1.md) (2026-10-01).
Rozpracovává interní E2E etapy MVP 0–12 při zachování společného uvedení produktu.
Produktové defaulty a tarifní tabulka byly po auditu schválené 2026-10-01,
s výslovnou opravou: Děkujeme a Stav objednávky patří pouze do Pro. Rozsah editoru,
zjednodušení automatizací a nastavitelnost četnosti jsou také schválené; podrobnosti
níže. Žádná část tím není označena jako implementovaná nebo provozně ověřená.

## Produkt

- **Další appka po Won Discounts** je Won Companion. Won Discounts se v tomhle brainstormingu nemění.
- **Staví se celá roadmapa najednou**, ne MVP po kouscích (Ondřej, 2026-09-28).
- **Pozicování:** levnější segment než Candy Rack, první distribuce jsou vlastní klienti (severka, Podlaha 1).
- **Samostatná doporučovací appka, bez závislosti na Won Discounts** (2026-10-01).
  Doporučuje existující produkty a větší varianty, přidává je nebo nahrazuje řádek košíku.
  Ceny, slevy i marketingové označení zvýhodnění nastavuje merchant ve svém obchodě.
  Companion slevy nezakládá, nevlastní jejich pravidla ani ochranu marže.
- Zachovat: doporučování z celého košíku, raději nic než špatné doporučení, respektování
  odmítnutí, původní košík tématu a distribuci přes vlastní klienty.

## Plochy (rozhodnuto 2026-09-28)

| Plocha | Stav |
|---|---|
| Okno po přidání do košíku (mobil: panel zespodu) | ano |
| Doporučení v košíku a draweru | ano |
| Blok na PDP (relevantní produkty) | ano |
| Merchantem určené doplňky A → B/C | ano, na PDP produktu A a po jeho přidání do košíku; nejde o zákaznický skladač balíčku |
| Prázdný košík (nejprodávanější, naposledy prohlížené) | ano |
| Stránka Děkujeme + Stav objednávky | ano, pouze Pro (potvrzeno 2026-10-01) |
| Stránka po platbě (one-click do téže objednávky) | ano, jako **beta** |

## Funkce navíc ke kartě (rozhodnuto 2026-09-28)

- Náhrada za vyprodané (podobné skladem).
- Krátký důvod u doporučení, píše merchant.
- Nativní signály Shopify pro start bez objednávek (Search & Discovery complementary, Product Recommendations API).
- Znovu koupit pro přihlášené zákazníky.

## Odlišení od Candy Racku (2026-09-29)

- **Kontrola pravidla na minulých objednávkách: ano, opraveno 2026-10-01.** Za posledních
  60 dní (`read_orders` bez `read_all_orders`) ukáže pozorované společné nákupy, například
  „Ze 180 objednávek obsahovalo 42 produkt A; v 11 z nich byl také B.“ Nejde o přehrání
  historie košíku, odhad zobrazení nabídky ani důkaz, co by zákazník koupil bez doporučení.
  Čísla v příkladu jsou ilustrativní. Přínos je závislý na následném měření.
- **Zisk, přebytek skladu a trvanlivost — zjednodušení schváleno 2026-10-01:** zásoba,
  prodeje a případně hrubá marže jsou podklady pro rozhodnutí merchanta; merchant může
  prioritizovat relevantní produkty. Automatické řízení trvanlivosti se odkládá.
  Žádný slib automatické optimalizace zisku nebo rozpoznání přebytku bez potřebných dat.
- **Doplň balík do váhové hranice dopravy — odklad schválen 2026-10-01.** Automatické
  doplňování do váhové hranice a příslib stejného dopravného nejsou součástí první verze.
- **Doplňky A → B/C: Basic (původní Free), upřesněno 2026-10-01.** Merchant přiřadí
  doplňkové produkty k A; aplikace je zobrazí na PDP A nebo po jeho přidání do košíku.
  Toto nahrazuje nejednoznačný „skladač vlastní sady“ i původní předpoklad rozpoznávání
  složení sad. Companion nevytváří bundle ani zákazníkovi neskládá nový balíček.
  Existující balení lze doporučit jako běžný produkt, bez správy jeho složení/ceny.
- **Zamítnuto** (neopakovat návrhy): texty bez AI jako compliance argument, hlídání účinných látek,
  znovu koupit podle dojití, předinstalace ve Won tématu jako hlavní odlišení, garance přírůstku
  s vrácením peněz, automatická optimalizace na přírůstek, síťový start napříč obchody, mikro-otázka v okně,
  záchrana při odebrání z košíku (downsell), sponzorovaná doporučení od značek.

## Další funkce (rozhodnuto 2026-09-29)

- **„Kupte spolu“ i z přidání do košíku, ne jen z objednávek: ano, Pro.** Sběr přes Web Pixel
  se souhlasem zákazníka. Přidání není nákup a může znamenat porovnávání alternativ.
  Přínos pro malé obchody není ověřený; způsob vážení signálu je otevřený.
- **Přesun od konkurence jedním klikem: ano.** Search & Discovery doplňkové produkty načte appka sama;
  Candy Rack / Selleasy přes jejich export, pokud existuje (ověřit). Jednorázový import,
  nikoli obousměrná synchronizace; pravidla opakovaného importu níže.
- **Neukazovat, co už zákazník má: ano.** Přihlášenému zákazníkovi nedoporučí nedávno koupený produkt;
  uvolněné místo dostane další kandidát v pořadí.
- **Vzhled převezme z tématu: ano, Basic (původní Free).** Rozsah editoru schválen
  2026-10-01: řízené varianty karet a úpravy barev, rozestupů, obrázků a textů; Pro
  pokročilejší kompozice a vlastní CSS. Běžné řazení doporučených produktů patří do
  Basic bez ohledu na způsob ovládání (šipky/přetažení). Žádný obecný page builder.
- **Zamítnuto:** doporučení na pokladně prodejny (POS).

## Zapínání funkcí (Ondřej, 2026-09-29)

- **Každá funkce z tohoto brainstormingu má vlastní vypínač v nastavení a je opt-in.**
- Aby první spuštění nebylo prázdné: onboarding nabídne doporučenou sadu funkcí a zapne ji jedním
  tlačítkem (stejný vzor jako „Co chceš řešit?“ ve Won Discounts).
- **UX podle výsledku, ne seznamu technických funkcí** (2026-10-01): „Nabídnout doplněk“,
  „Nabídnout větší balení“, „Nahradit vyprodané“. Před zapnutím konkrétní náhled z katalogu,
  hromadné potvrzení/opravování vztahů, jednotlivé vypínače zůstávají v detailu.
  Schválená priorita: explicitní znovunákup obchází pouze potlačení nedávno koupeného;
  ostatní ochrany platí. Historie default 60 dostupných dní, merchant může zkrátit.

## Pravidla doporučení a souběh ploch (potvrzeno 2026-10-01)

- **Četnost nastavuje merchant (potvrzeno 2026-10-01).** Výchozí návrh tří karet a
  jednoho automatického post-add dialogu za návštěvu není pevný limit. Merchant může
  upravit počet nabídek, četnost a interval opakování v podporovaném rozsahu plochy.
  Jedna akce stále automaticky otevře nejvýš jednu plochu; nesmí vzniknout řetězení
  dialogů po přidání přes Companion ani okamžité zopakování odmítnutí na jiné ploše.

- **Výměnu za větší balení nastavuje merchant** (zákazník aplikace), jednotlivě pro produkt
  i hromadně. Appka může ze známých velikostí variant navrhnout zdrojovou/cílovou variantu
  a počty balení, ale merchant návrh potvrdí nebo upraví. Žádný univerzální tichý přepočet
  „tři malé = jedno velké“. Nakupující vidí konkrétní výměnu a cenu před jejím potvrzením.
- **Doplňky vybírá merchant:** A → B/C. Pokud se A často kupuje s D, analytika navrhne
  merchantovi přidat D; nepublikuje nový vztah bez jeho potvrzení. Ruční vztahy jsou Basic,
  datové návrhy zůstávají Pro. „Často společně“ je pozorování, ne důkaz přírůstku.
- **Jedna akce nakupujícího otevře automaticky nejvýš jednu plochu.** Koordinace platí
  pro modal/drawer i další nabídky a souběh s toasty. Výslovná merchantova nabídka má
  přednost před automatickou. Odmítnutí platí napříč plochami; nabídku neopakovat hned
  jinde. Různé nabídky nesmějí současně měnit tentýž řádek košíku.
- **Import je jednorázové převzetí.** Následným místem správy vztahů je Companion.
  Opakovaný import ukáže rozdíly a konflikty před potvrzením, nepřepisuje ruční úpravy.
  Aktualizace cen a dostupnosti z obchodu tím není dotčená.
- **Ruční oprava a zamítnutí mají paměť.** Další přepočet nesmí vrátit odmítnutý vztah
  ani přepsat merchantovu úpravu. Opětovné povolení je vědomá akce merchanta.

## Výchozí technická rozhodnutí (2026-09-29, Ondřej může rozporovat)

- **Košík tématu, žádný vlastní drawer.** Doporučení se vkládají do existujícího košíku a draweru
  tématu. **Komunikace BETA; vlastní testovací matice pouze Dawn a Horizon** (2026-10-01).
  Ostatní témata bez příslibu ověřené kompatibility. „Otestovali jsme“ lze publikovat až
  s výsledkem testů Companiona na konkrétních verzích témat, ne převzetím testů jiných appek.
  App blok na stránce košíku je omezený fallback, nenahrazuje nabídku v draweru.
- **Sdílené jádro košíku `@won/core/cart` postaví Companion jako první krok.** Navrhne se tak,
  aby ho později převzal Stepper i embed Won Discounts. Na `packages/core` se sahá až po doběhnutí
  Won Discounts.

## Architektura (rozhodnuto 2026-09-29): C, kombinace

- **Prohlížeč:** základ doporučení z metapolí, výběr v JS extension tématu. Rychlé vykreslení
  a odolnost vůči výpadku serveru jsou cíle k ověření podle skutečné datové cesty.
- **Server na pozadí:** „Kupte spolu“ z objednávek a košíků, zisk a sklad, zkouška pravidla na minulých
  objednávkách. Výsledky zapisuje do metapolí.
- **Živý dotaz na server (app proxy):** jen personalizace přihlášeného zákazníka („neukazovat, co už má“).
- Ověřit při specu: jak JS získá data pro produkty v košíku (Storefront API s veřejným čtením metapolí
  vs. app proxy), limity velikosti metapolí.
- Veřejný payload nesmí obsahovat nákupní ceny ani soukromou historii zákazníků.
  Ceny/dostupnost zobrazovat pro správnou variantu, měnu a kontext zákazníka.
- **Uloženo ≠ publikováno** (potvrzeno 2026-10-01): admin rozlišuje uloženou konfiguraci
  a její publikování pro storefront. Otevřená stránka smí používat stará pravidla jen po
  omezenou dobu; před další nabídkou podle této lhůty ověří jejich platnost. Při překročení
  platnosti a neúspěšném ověření novou nabídku nezobrazí, původní košík dál funguje.
  Schválený cíl maximálního stáří ověření konfigurace je 60 sekund; mechanismus doloží technický prototyp;
  okamžité vzdálené vypnutí bez tohoto mechanismu není slíbené.

## Rychlost nastavení (Ondřej, 2026-09-29)

- **Žádná funkce nesmí znamenat 10 minut konfigurace.** Nejvýš 1 minuta na produkt nebo sadu.
- Vzor: appka sama najde a navrhne, merchant potvrdí jedním tlačítkem nebo opraví výběrem.
- Platí pro všechny funkce, i ty z karty (startovní pravidla z katalogu, detekce většího balení
  z variant, náhrada za vyprodané z kolekce a typu).
- Měřit i celkový čas nastavení obchodu; minuta krát stovky produktů není rychlý onboarding.

## Ověřeno v shopify.dev (2026-09-28)

- **Děkujeme + Stav objednávky:** checkout UI extension, všechny tarify kromě Starter. Rozšíření nesmí
  měnit objednávku; na Děkujeme objednávka ještě neexistuje. Doporučení = nová objednávka.
  Dokoupení přes úpravu objednávky na Stav objednávky: jak se doplácí rozdíl, ověřit prototypem.
- **Stránka po platbě:** beta, na živém storu nutná žádost o přístup. Jen platba kartou (ne Apple Pay,
  Google Pay, Klarna, dárková karta, jiné metody). Ne u cel + více měn, ne u lokálního doručení.
  Jen 1 appka na store, max. 3 přijaté nabídky, jen Online Store kanál.

## Ceník (nahrazeno rozhodnutím 2026-10-01)

- **14 dní zdarma, potom Basic $10/měsíc nebo Pro $30/měsíc.** Dva tarify, nikoli postupné
  zdražování téhož tarifu. Žádný trvalý Free; bez meteringu objednávek nebo tržby.
- **Basic přebírá funkce původního Free; Pro přebírá původní Pro** (výslovně potvrzeno
  Ondřejem 2026-10-01). Přejmenování a zpoplatnění základu nepřesouvá jeho funkce do Pro.
  Původní ruční doporučování, bigger-pack, základní vzhled a guardraily tedy patří do Basic;
  datové FBT, pokročilé cílení, experimentální měření a vlastní CSS do Pro.
- Platí nejnovější změny rozsahu: historická Pro integrace s Won Discounts se nevrací.
  Doplněná tarifní tabulka v blueprintu O.3 je schválená; Děkujeme a Stav objednávky
  patří pouze do Pro, stejně jako one-click post-purchase. Basic zahrnuje ruční
  správu, běžné storefront plochy, základní report, import, diagnostiku a obnovu.
  Trial a změny tarifu mají schválené chování níže; billing zatím není implementovaný.
- Vyšší cena Pro neověřuje ochotu platit ani ekonomiku podpory. Trial má ověřit použitelnost
  a relevanci, neslibuje statisticky průkazný přínos během 14 dní.

## Trial, ukončení a downgrade (potvrzeno 2026-10-01)

- **14denní trial zpřístupní Pro.** Před placeným pokračováním musí být jasně zvolený
  tarif a cena. Neodvozovat souhlas s placeným Pro jen z používání Pro ve zkušební době.
- **Bez platného oprávnění se zastaví nové nabídky**, konfigurace se zachová.
  Již přidané produkty se neodstraňují, běžný košík a checkout pokračují.
- **Krátký výpadek ověření není potvrzené zrušení.** Dříve ověřenému zákazníkovi lze
  zachovat pokračování nejvýše 24 hodin od posledního úspěšného ověření, nikdy za
  známé ukončení oprávnění. Neověřená instalace tím placený přístup nezíská.
- **Pro → Basic = ztráta přístupu k Pro funkcím, ne ztráta uloženého nastavení.**
  Základní funkce pokračují; pravidlo závislé na Pro se celé pozastaví s vysvětlením.
  Odstranění Pro podmínky nesmí pravidlo rozšířit na všechny zákazníky. Případnou
  jednodušší Basic variantu vytváří merchant vědomě. Totéž platí při ztrátě dat potřebných
  pro personalizované pravidlo: nezměnit je potichu na obecné.
- **Implementační pozor:** současný `@won/app-kit/entitlement` má výchozí fallback Free
  a příznak `pro` chápe jako příslušnost do seznamu placených plánů. Companion potřebuje
  rozlišit trial / Basic / Pro / neaktivní stav a dočasnou nejistotu; pouhé přejmenování
  Free na Basic by poskytovalo placený základ bez ověření. Sdílený kód zatím neměněn.

## Ceny a nabídka po platbě (nahrazeno rozhodnutím 2026-10-01)

- **Napojení na Won Discounts není požadované.** Merchant řídí ceny a slevy nativně nebo
  libovolnou jinou aplikací. Companion nevytváří slevu ani neslibuje její uplatnění.
- **Zpřesnění odpovědnosti Ondřejem (2026-10-01):** Companion pomáhá dostat relevantní
  položky do košíku. Merchant si doporučení poskládá nebo použije datové návrhy.
  Companion převezme dostupné produktové údaje a cenu, vykreslí nabídku a přidá
  zvolenou variantu/množství. Nečte ani nereimplementuje pravidla cizích slevových
  aplikací, neověřuje jejich obchodní správnost a nepočítá hypotetickou slevu před
  přidáním. Uplatnění slevy zajišťuje existující mechanismus obchodu; výsledný košík
  se obnoví z Shopify. Správné zobrazení převzatých údajů je naše odpovědnost,
  nastavení a funkčnost slevy odpovědnost merchanta a jeho slevového řešení.
  Sleva vykreslená cizím widgetem na PDP se automaticky nepřenáší do každého nového
  produktového bloku. Bez dostupné výsledné ceny zobrazit produktovou cenu; absence
  předpovědi množstevní slevy není důvod blokovat relevantní doporučení.
- U většího balení nabídne existující variantu za její cenu. Označení slevy/výhodnosti
  určuje merchant; samotný štítek cenu nemění. Bez ověřitelné ceny nesmí Companion
  vydávat vypočtenou úsporu nebo kombinovanou slevu za garantovanou cenu nákupu.
- Post-purchase zůstává plánovaná beta; potvrzení změny objednávky a částku musí ověřit
  Shopify. Zobrazení a potvrzení platformou vrácené částky ověřit prototypem;
  parita s cizími slevovými aplikacemi není požadavkem Companiona ani důvodem stavět
  slevovou integraci. Žádná slíbená ochrana marže Companionem.

## Měření (upřesněno 2026-10-01)

- Oddělit historické společné nákupy, připsané nákupy po interakci a experimentální odhad přínosu.
- Holdout celé aplikace musí potlačit všechny její doporučovací plochy. Experiment jedné plochy
  označit jako experiment této plochy, nepřipsat mu výsledek celé aplikace.
- Hlavní výsledek: tržba na způsobilého návštěvníka; vedle konverze a AOV. Definovat stabilní
  rozdělení před expozicí, pozorovací okno, souhlas a propojení návštěvy s objednávkou,
  vratky/storna a nedostatečná data. Schválený default je 50/50 na 28 dní + 7 dní pro dokončení pozorovacích oken; dostatečnost vzorku ověřit před startem.
- „Zatím nemáme dost dat“ je legitimní výsledek. AOV samo nedokazuje přínos.

## Obchodní automatizace po auditu — zjednodušení schváleno 2026-10-01

| Oblast | Doporučené provedení | Co netvrdit automaticky |
|---|---|---|
| Relevance, náhrady, větší balení | Appka navrhne vztahy, merchant je potvrdí hromadně; zachovat atributy jako příchuť/rozměr a volbu varianty | Stejná kolekce = zaměnitelný výrobek |
| Obchodní priorita | Merchant vybere produkty, které chce více doporučovat; priorita až mezi relevantními kandidáty | Automaticky maximalizujeme zisk |
| Nákupní cena / hrubá marže | Volitelný pomocný signál při úplných datech, nikdy změna ceny | Známe čistý zisk obchodu |
| Sklad | Ukázat zásobu a pozorované prodeje za období, merchant rozhodne o prioritě | Nízké prodeje = přebytek bez znalosti výpadků skladu a sezóny |
| Trvanlivost | Automatické řízení odložit; merchant může produkt ručně prioritizovat | Jedno datum produktu reprezentuje všechny šarže |
| Váhová doprava | Odložit automatický příslib; samostatný prototyp pro přesně vymezené přepravní konfigurace | Dokoupení nezmění dopravné bez ověření konkrétní zásilky |
| Web Pixel | Pomocný signál a návrhy; odlišit vlastní doporučení od spontánních přidání | Společné přidání prokazuje doplňkovost nebo přírůstek |

Ondřej výslovně souhlasil se zjednodušením skladových/maržových podkladů, ruční
prioritou relevantních produktů a odkladem automatické trvanlivosti/váhové dopravy.
Detaily algoritmů a datové limity tím nejsou ověřené ani implementované.

## Pro a potvrzené vztahy po downgrade — A/B schváleno 2026-10-01

- Tarifní rozdělení je schválené s přesunem Děkujeme/Stav objednávky do Pro.
  Skutečnou ochotu průběžně platit za Pro ověří závěrečný pilot.
- Doporučení: hlavní průběžná hodnota Pro jsou nové datové návrhy ke schválení,
  personalizace, pokročilé cílení a vyhodnocování. Jednorázový setup, CSS a grafy samy
  trvalou potřebu Pro neprokazují. Schválené Basic funkce neomezovat zpětně.
- **A — schváleno:** původ vztahu není totéž jako jeho aktuální závislost.
  Merchantem potvrzené pevné A → B bez Pro podmínek zůstává na Basic
  beze změny; po downgrade se zastaví nové Pro návrhy a analýzy. Není nutná kopie
  identického vztahu. Platí také pro vztahy potvrzené během Pro trialu.
- **B — schváleno:** pravidlo se skutečnou Pro závislostí (např. cílení na zákaznický segment) se dál
  pozastaví celé. Žádné odstranění podmínky a rozšíření na všechny. Pro vztahy
  nepublikuje autonomně; nové návrhy dál potvrzuje merchant.

## Uzavření produktových detailů — schváleno 2026-10-01

- **Save/Publish:** jeden společný draft obchodu; explicitně uložit návrh, pak
  publikovat po přehledu všech změn. Stavy musí být v adminu výrazně a srozumitelně
  znázorněné. Varování při odchodu s neuloženou prací a ochrana souběžné editace.
- **Obnova:** posledních 20 publikovaných verzí nejvýše 90 dní, aktuální vždy.
  Obnovení vytvoří draft s kontrolou aktuálních závislostí, ne změnu zákaznických košíků.
- **Historie nákupů:** 60 dostupných dní jako výchozí období; lze zkrátit například
  na 7/30 dní. Explicitní znovunákup je lokální výjimka potlačení již koupeného.
- **Návrhy Pro:** přepočet přibližně denně, minimálně 5 společných objednávek jako
  počáteční filtr, ukázat období/vzorek/popularitu cíle, merchant rozhoduje.
  Zamítnuté páry nevracet při každém přepočtu. Pět objednávek není důkaz relevance.
- **Experiment:** dobrovolně Pro, výchozí rozdělení 50/50, plán 28 dní + 7 dní
  dokončení nákupního okna; předem posoudit návštěvnost a potřebný vzorek.
  Nedostatek dat nevede k tvrzení o průkazném přínosu.
- **Čerstvost:** schválený cíl 60 sekund pro ověření konfigurace před další nabídkou
  nebo akcí; prototyp musí doložit mechanismus. Neúspěšné obnovení po limitu potlačí
  nabídku, nikoli nativní košík. Billing grace 24 hodin je odlišná situace.
- **Data:** konfiguraci chránit při downgrade; po uninstall zastavit a mazat podle
  požadavků platformy. Dostupnou oprávněnou obnovu nabídnout jen jako draft.
  Technická diagnostika 30 dní, audit administrátorských změn 90 dní.
- **Ověření instalace:** při první instalaci a prvním otevření nastavení provést
  bezpečné automatické kontroly dostupných informací a nabídnout řízený test ploch.
  „Nastavení zkontrolováno“ odlišit od „Objednávkový průchod ověřen“. Neznámý stav
  z API nesmí být označený jako funkční. Podrobné navržené provedení v blueprintu H.6.
- **Post-purchase:** časný technický prototyp a ověření přístupu zůstávají; případnou
  konkrétní blokaci řešit samostatně bez tichého škrtnutí společného release scope.
- **Pilot:** plán 5–8 klientů se zachovává, ale čeká až na úplně poslední krok po
  dokončení vývoje a technické/UX brány. Teď žádný nábor ani oslovování klientů.

## Zbývá ověřit při stavbě a na konci

- Datovou cestu, bezpečnou změnu košíku, skutečné převzetí ceny a čerstvost konfigurace.
- Dawn/Horizon a jednotlivé extension plochy včetně přístupu/post-purchase průchodu.
- Které instalační stavy lze zjistit přímo a které potřebují merchantovo potvrzení
  nebo testovací průchod; simulace nenahrazuje skutečnou změnu objednávky.
- Detailní měřicí a datové kontrakty, statistické výpočty a správné plnění mazání.
- Úplně nakonec použitelnost, podporu a placené pokračování u pilotních klientů.
Produktové volby výše jsou uzavřené; nejde o důkaz hotové implementace.
