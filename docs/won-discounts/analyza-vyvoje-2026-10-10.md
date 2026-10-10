# Won Discounts: jak se vývoj posouval a jak ho uzavřít před první review

Datum: 10. 10. 2026.

Zdroje: 22 sessions z `~/.claude/projects/-Users-ondrej-Development-WonCommerce-Apps` (28. 9. až 10. 10.). Hlavní podklad je 167 tvých promptů v plném znění, bez duplicit a bez zpráv subagentů, build log, git historie, `pravidla-vzhledu-kolo6-2026-10-10.md`, `won-app-design-doctrine.md`.

Co jsem nedělal: aplikaci jsem nespouštěl a odpovědi AI v sessions jsem nečetl. Počty u témat jsou z ručního čtení tvých promptů, ber je jako přibližné.

## 1. Verdikt

Tvůj dojem sedí. Nejsou to ale drobnosti, které se nedaří opravit. Je to pět stejných druhů připomínek, které se pokaždé objeví na jiné obrazovce.

Příčiny jsou čtyři:

1. Aplikace dostala 4. 10. štítek `Shipped` podle testů. Nikdo ji do té doby neprošel jako obchodník. Celé přebírání UX se děje až potom.
2. Zpětná vazba nemá konec. Proklikáváš aplikaci a každá obrazovka, na kterou dojdeš, vyrobí nové body. Neexistuje seznam, podle kterého by šlo říct „hotovo“.
3. Během ladění přibývají nové funkce. Každá přinese novou plochu, kterou jsi ještě neviděl.
4. Hotovo se měří v dev náhledu a testech. Ty ale hodnotíš to, co vidíš v Shopify adminu a na webu.

## 2. Jak se aplikace posouvala

| Období | Co se dělo | Tvoje role | Výstup |
|---|---|---|---|
| 28. 9. dopoledne | Zadání: sloučení Tiers, Rewards, Outlet a MarginGuard, rozhodnutí, mezery | rozhoduješ produkt | `rozhodnuti.md`, `mezery.md`, prompt pro orchestrátora |
| 28. 9. až 4. 10. | Autonomní stavba MVP 0 až 7 | většinou „Pokračuj“ | 239 commitů, štítek `Shipped` |
| 6. 10. | První průchod aplikací, tři kola feedbacku | zhruba 40 bodů | menu, dlaždice, štítek stavu, výjimky |
| 7. 10. | Audit srozumitelnosti druhou AI, opravy | 5 vlastních bodů a audit | trhy ze Shopify (nález T1), částky podle trhu |
| 8. 10. | Tři velké úkoly: Milníky, Překlady a vzhled u modulů, kontrola kombinací, navigace | zadáváš přes prompty | 45 commitů |
| 9. 10. | Čtyři kola feedbacku | zhruba 25 bodů | marže po produktech, výprodej, milníky jako seznam |
| 10. 10. | Tři kola a dvě doladění | zhruba 32 bodů | hover, vzhledy podle místa, bloky do pruhu, dárkové karty |

Stav kódu: 14 obrazovek adminu, 10 bloků do šablony, zhruba 82 tisíc řádků bez testů. Brána: node 1 884, core 963, cargo 106, vitest 719.

Tři věci z tabulky:

- Počet bodů za den neklesá: zhruba 40, 25, 32. Kdyby se ladily drobnosti, klesal by.
- Tři moduly se po `Shipped` přestavěly od základu: Odměny na Milníky, stránka Vzhled na Překlady a vzhled u modulů, sady množstevních slev na „celý obchod a výjimky“. Výprodej měnil postup třikrát (6. 10., 9. 10., 10. 10.).
- Kola 4 až 7 nejsou v gitu. V pracovním stromu je 96 změněných souborů, 3 242 přidaných řádků a 3 migrace databáze. Poslední commit je z 9. 10. 17:59.

## 3. Co se opakuje

| # | Druh připomínky | Kdy zazněl | Příklad |
|---|---|---|---|
| 1 | Nevidím stav: chybí nebo lže štítek Aktivní | 6., 7., 8., 9. a 10. 10. | 6. 10. „chybí badge aktivní“, 9. 10. „mám ji aktivní, ale nevidím badge“, 10. 10. „mám to aktivní, nebo nemám?“ |
| 2 | Dlouhý scroll: chci dlaždice, boční menu, pryč s rozbalováním | 6., 8., 9. a 10. 10. | boční menu postupně: Nastavení, Překlady, Vyzkoušet košík |
| 3 | Nechápu, co to dělá | Ochrana marže 6×, Výprodej 5×, výjimky množstevních slev 4×, Milníky 4×, Kampaně 3× | 9. 10. „udělej to jak pro hlupáka“, 10. 10. „mě samotného výprodej mate“ |
| 4 | Na webu je to jinak než v aplikaci | 6., 7., 9. a 10. 10. | vzhled se nepropsal, blok skončil na konci HP, odkaz otevřel náhodný produkt |
| 5 | „Ber to obecně a aplikuj všude“ | nejméně 6× | 6. 10. „abych se nemusel 3× opakovat“, 10. 10. „zapiš ta pravidla jako generická“ |

Řádek 5 je klíč. O obecné použití jsi žádal od prvního dne. Pravidla se ale sepsala až 10. 10. a tabulka v `pravidla-vzhledu-kolo6-2026-10-10.md` má sloupec „Kde ještě ne“. Ten říká, kde pravidla neplatí: Přehledy, editor slevy, seznam slev, skončené kampaně, výsledek košíku, košíkový blok. To jsou body příštího kola, známé předem.

Řádek 3 nejsou drobnosti. U Ochrany marže a Výprodeje nesedí samotný koncept. Úprava textu to neopraví, proto se vrací.

## 4. Proč se to neuzavírá

- **Chybí definice hotového.** „Připraveno na review“ není nikde napsané. Každé kolo končí tím, že přijde další.
- **Rozsah roste i teď.** Jen 9. a 10. 10. přibylo: ochrana marže po produktech, dva nové bloky do pruhu, čtyři vzhledy milníků podle místa, výběr slev u výprodeje (změna pokladní funkce v Rustu), vyjmutí dárkových karet, blok analytiky.
- **Půlka „feedbacku“ jsou nové funkce.** Už první feedback 6. 10. obsahoval Milníky, Překlady s exportem a importem, dávky náhodných kódů a minimum kusů na produkt. To je zadání, ne ladění.
- **Práce jde i do modulu, o kterém pochybuješ.** 6. 10. píšeš k Vyzkoušet košík „osobně moc nevidím v tom přínos“. Od té doby dostal předpřipravené scénáře, počítání na serveru, boční menu a karty „Co se stalo / Co s tím“.
- **Naživo se neověřuje.** V build logu je 17× „neověřeno naživo“. Tvoje body typu 4 jsou přesně tyhle případy.
- **Testuješ ty.** Znáš aplikaci dva týdny. Tvoje poslední body jsou z velké části vkus (hover, „působí to flat“). Nejužitečnější jednotlivý vstup za celou dobu byl audit cizíma očima ze 6. 10.: našel, že aplikace nenačítá trhy ze Shopify.

## 5. Co dnes uvidí netechnický klient

Tohle neopraví žádné další kolo vzhledu:

- Aplikace běží jen u tebe přes `shopify app dev`. Railway je připravené, nenasazené.
- Dev obchod má základní měnu USD, zónu New York a produkty `won-e2e-*` za 9 až 22 USD.
- Analytika je WIP, nabídky z objednávek (5b) nejsou otestované.
- Billing nejde vyzkoušet bez veřejné distribuce. Pro review nevadí, Pro lze zapnout ručně.

## 6. Jak to uzavřít

Pořadí je důležité. Každý krok má jasný konec.

1. **Stop funkcím a commit.** Kola 4 až 7 do gitu. Nové nápady jdou do Second Brain se štítkem „po review“.
2. **Napsat scénář review.** Pět úkolů, které klient udělá sám. Návrh:
   1. Průvodce: doprava zdarma a dárek pro CZ a SK.
   2. Množstevní sleva na celý obchod, vidět na stránce produktu.
   3. Sleva kódem.
   4. Výprodej jednoho produktu se štítkem na webu.
   5. Vyzkoušet košík.
   U každého úkolu kroky a co má klient na konci vidět. To je definice hotového.
3. **Rozhodnout, co do review nepatří.** Ochrana marže a Kampaně bych ukázal jako Beta, nebo je pro review schoval. U obou sám píšeš, že jim nerozumíš.
4. **Jeden průchod pravidel místo kol.** Tabulka obrazovka × pravidlo (14 obrazovek, pravidla z doktríny §17 až §20). Každé pole: platí, neplatí, netýká se. Začít sloupcem „Kde ještě ne“. Ty pak kontroluješ tabulku se screenshoty.
5. **Jeden průchod naživo.** Pět úkolů ze scénáře v Shopify adminu a na Horizonu. Tím zmizí 17 položek „neověřeno naživo“, které se scénáře týkají.
6. **Ukázkový obchod.** CZK, české produkty s cenami kolem 500 až 1 500 Kč, jeden dárek, jeden produkt do výprodeje.
7. **Slepý test.** Nová session bez kontextu dostane jen pět úkolů a aplikaci. Zapíše, kde se zasekla a co musela hádat. Teprve potom člověk.
8. **Pravidlo pro body po zmrazení.** Každý bod dostane jednu ze tří značek: brání úkolu ze scénáře, mate v úkolu ze scénáře, vkus. Před review se dělají jen první dvě.

Kdy je hotovo: slepý test projde všech pět úkolů bez zaseknutí a tabulka z kroku 4 nemá u obrazovek ze scénáře žádné „neplatí“.

## 7. Co potřebuju rozhodnout

1. Které moduly jdou do první review. Doporučuju Milníky, Množstevní slevy, Slevy a kódy, Výprodej a Vyzkoušet košík. Ochrana marže a Kampaně jako Beta.
2. Jestli review proběhne u tebe na obrazovce, nebo si ji klient otevře sám. To druhé znamená nasadit na Railway dřív.
