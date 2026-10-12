# Won Discounts — matice před první review

Stav k 12. 10. 2026, commit `b9a4a9a` + opravy z tohohle zadání ([`prompt-uzavreni-pred-review.md`](prompt-uzavreni-pred-review.md)).
Průchod je z dev náhledu (`/dev/preview/<stránka>`, fixtury), 1 440 a 390 px, Free i Pro, prázdný i naplněný stav.
Screenshoty „před“: [`evidence/pred-review-2026-10-10/pred/`](evidence/pred-review-2026-10-10/pred/) (236 kusů, `<název>--<šířka>.jpg`;
pohled pod dlaždicí je `<název>--view-<dlaždice>--<šířka>.jpg`). Screenshoty po opravě: `evidence/pred-review-2026-10-10/po/`.

Co průchod **nepokrývá**: aplikaci uvnitř Shopify adminu (náhled běží bez Shopify) a web. Web je tabulka B a krok 3.

## Tabulka A, admin

Sloupce:

| Sloupec | Pravidlo |
|---|---|
| P1 | Vybraná dlaždice se pozná rámečkem a ikonou, bez šipky (§20a) |
| P2 | Dlaždice je širší než vyšší, krátká věta (§20b) |
| P3 | Část, která jen ukazuje, má „Jen přehled“, větu a žádné Uložit (§20c) |
| P4 | Víc věcí v sekci = karty s hlavičkou a tlačítkem, hlavní akce není v rozbalovacím řádku (§20d) |
| P5 | Kroky formuláře jsou samostatné karty (§20e) |
| P6 | „Buď, nebo“ jsou dvě karty, co platí, ukazují značky (§20f) |
| P7 | Upozornění říká „Co se stalo“, „Co s tím“ a má tlačítko (§20g) |
| P8 | Dlouhá stránka má boční menu, nebo není dlouhá (§20h) |
| P9 | Odkaz na blok, který v šabloně je, ho otevře a nic nepřidá (§20i) |
| P10 | Na co jde kliknout, reaguje na myš |
| §17 | Sekce začíná stavem: co je nastavené, lidsky |
| §18b | Nic bez obsahu nebo akce |
| §18g | Rozbalovací je jen to, co se nastavuje zřídka |
| §18h | Pro funkce je hotová nebo není vidět, žádné vymyšlené ukázky |
| §18i | Ovládací prvek dělá, co říká, a Uložit ukládá to, u čeho stojí |
| §19a | Stav (Aktivní / Neaktivní / Vyžaduje pozornost) je pravdivý a všude stejný |
| §19b | Pro je označené jednou v sekci |
| §19c | Každý kus na webu říká, kde v šabloně je |
| §19f | Jeden druh navigace na jeden význam |

P10 je ověřené ve druhém průchodu skutečným najetím myší: 63 prvků na 14 stránkách (lišta, dlaždice, karty volby,
řádky, odkazy), každý změnil vzhled, žádný vybraný nereagoval. Nastavení, Přehledy a Tarif nemají žádný vlastní
klikací prvek mimo tlačítka Shopify.

**Druhý průchod po opravách (12. 10.):** všech 236 snímků znovu, žádný vodorovný posuv na 390 px, žádná chyba v konzoli,
žádná stránka nevrátila chybu. Výška stránek: Vyzkoušet košík 3 943 → 2 629 px, vzhled na Free 2 138 → 1 445 px;
Přehled s upozorněními je o 190 až 340 px delší (karty „Co se stalo / Co s tím“, viz C14).

| Obrazovka nebo pohled | Screenshot | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | §17 | §18b | §18g | §18h | §18i | §19a | §19b | §19c | §19f |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Přehled, prázdný obchod | `overview-off-pro` | — | platí | — | — | — | — | — | — | — | platí | platí | platí | — | platí | — | platí | platí | — | — |
| Přehled, naplněný | `overview-free` | — | platí | — | — | — | — | platí (byl 2) | — | — | platí | platí | platí | — | platí | — | platí | platí | — | — |
| Přehled, chyba zápisu | `overview-failed` | — | platí | — | — | — | — | platí (byl 2) | — | — | platí | platí | — | — | — | — | platí | platí | — | — |
| Průvodce, kroky 1 až 3 | `onboarding-3` | — | — | — | — | — | — | — | — | — | platí | platí | platí | platí | — | — | platí | — | — | — |
| Průvodce, kroky 4 a 5 | `onboarding-4` | — | — | — | — | — | — | — | — | — | platí | platí | platí | — | — | — | platí (byl 1) | — | — | — |
| Slevy a kódy, seznam | `discounts` | — | — | — | platí (byl 3) | — | — | — | — | — | platí | platí | platí | platí | — | — | platí | — | — | platí |
| Slevy a kódy, prázdný | `discounts-empty` | — | — | — | — | — | — | — | — | — | platí | platí | platí | — | — | — | platí | — | — | platí |
| Editor slevy | `rule-editor-new-code` | — | — | — | — | platí (byl 4) | — | — | platí | — | platí | platí | — | platí | — | platí | platí | platí | — | platí |
| Editor slevy, kódy a dávky | `rule-editor-batch` | — | — | — | — | — | — | — | platí | — | platí | platí | — | — | platí | platí (byl 5) | — | platí | — | — |
| Množstevní slevy · Pro celý obchod | `tiers-free` | platí | platí | — | — | — | — | — | — | — | platí | platí | — | — | — | platí | platí | — | — | platí |
| Množstevní slevy · Tabulka na webu | `tiers-free--view-table` | platí | platí | — | — | — | — | — | platí (byl 8) | platí | platí | platí | — | platí | platí (byl 8) | platí (byl 7) | platí | — | platí | platí |
| Množstevní slevy · Výjimky | `tiers-exceptions--view-exceptions` | platí | platí | — | platí | — | — | — | — | — | platí | platí | — | — | platí | platí | platí | platí | — | platí |
| Množstevní slevy, prázdný | `tiers-empty` | platí | platí | — | — | — | — | — | — | — | platí | — | platí | — | — | — | platí (byl 6) | — | — | platí |
| Milníky · Stupně | `rewards-pro` | platí | platí | — | platí | — | — | — | — | — | platí | platí | — | — | — | platí | platí | — | — | platí |
| Milníky · Milníky na webu | `rewards-free--view-web` | platí | platí | — | — | — | — | — | — | platí (byl 19) | platí | platí | — | — | — | — | platí (byl 9) | — | platí | platí |
| Milníky · Vzhled a vlastní CSS | `rewards-pro--view-look` | platí | platí | — | — | — | — | — | platí | — | platí | platí | — | — | platí (byl 8) | platí (byl 7) | platí | — | — | platí |
| Milníky, prázdný | `rewards-empty` | platí | platí | — | — | — | — | — | — | — | platí | — | platí | — | — | — | platí (byl 6) | — | — | platí |
| Výprodej · Výprodeje | `outlet-pro` | platí | platí | — | platí | — | platí | platí | — | platí | platí | platí | — | platí | — | — | platí (byl 10) | — | platí | platí |
| Výprodej · Nový výprodej | `outlet-pro--view-new` | platí | platí | — | — | platí | platí | — | — | platí | platí | — | — | platí | — | platí | platí | — | platí | platí |
| Výprodej · Štítek na webu | `outlet-pro--view-web` | platí | platí | — | — | — | — | — | platí | platí | platí | platí | — | — | platí | platí | platí (byl 10) | — | platí | platí |
| Výprodej · Pravidla výprodeje | `outlet-pro--view-info` | platí | platí | — | platí | — | platí | — | — | — | platí | platí | — | — | — | platí | platí | — | — | platí |
| Výprodej, Free | `outlet-free` | platí | platí | — | — | — | — | — | — | — | platí | — | — | — | platí | — | platí | platí | — | platí |
| Kampaně · Kampaně | `campaigns-pro` | platí | platí | — | platí (byl 11) | — | — | — | — | — | platí | platí | platí | — | — | — | platí | — | — | platí |
| Kampaně · Nová kampaň | `campaigns-pro--view-form` | platí | platí | — | — | platí (byl 13) | — | — | — | — | platí | — | — | — | — | platí | platí | — | — | platí |
| Kampaně · Kampaň na webu | `campaigns-pro--view-places` | platí | platí | — | — | — | — | — | — | platí | platí | platí | — | — | — | platí | platí (byl 12) | — | platí | platí |
| Kampaně, Free | `campaigns-free` | platí | platí | — | — | — | — | — | — | — | platí | — | — | — | platí | — | platí | platí | — | platí |
| Ochrana marže · Hranice | `margin-pro` | platí | platí | — | — | — | — | — | — | — | platí | platí | — | — | — | platí | platí | — | — | platí |
| Ochrana marže · Nákupní ceny | `margin-pro--view-costs` | platí | platí | platí (byl 15) | — | — | — | — | — | — | platí | platí | — | platí | — | platí | platí | — | — | platí |
| Ochrana marže · Podle kolekcí | `margin-pro--view-collections` | platí | platí | — | platí | — | — | — | — | — | platí | platí | — | — | — | platí | platí (byl 14) | platí | — | platí |
| Ochrana marže · Podle produktů | `margin-pro--view-products` | platí | platí | — | platí | — | — | — | — | — | platí | platí | platí | — | — | platí | platí | platí | — | platí |
| Ochrana marže · Snížené slevy | `margin-pro--view-impact` | platí | platí | platí | — | — | — | — | — | — | platí | platí | — | — | — | platí | platí | platí | — | platí |
| Ochrana marže, vypnutá | `margin-off` | platí | platí | — | — | — | — | — | — | — | platí | platí | — | — | platí | — | platí | platí | — | platí |
| Vyzkoušet košík · Časté kombinace | `try-cart-warnings` | — | — | — | platí | — | — | platí | platí (byl 16) | — | platí | platí | — | — | — | — | platí | — | — | platí |
| Vyzkoušet košík · Košík a výsledek | `try-cart-warnings` | — | — | platí | — | — | — | platí (byl 17) | platí | — | platí | platí | — | — | — | platí | — | — | — | — |
| Vyzkoušet košík, Free | `try-cart-free` | — | — | — | — | — | — | — | — | — | platí | — | — | — | platí | — | — | platí | — | — |
| Překlady | `translations-pro` | — | — | — | — | — | — | — | platí | — | platí | platí | — | platí | — | platí | platí | platí | — | platí |
| Přehledy, Pro | `analytics-pro` | — | — | — | — | — | — | — | — | — | platí | platí | platí | — | — | — | — | — | — | — |
| Přehledy, Free | `analytics-free` | — | — | — | — | — | — | — | — | — | platí | platí | — | — | platí (byl 18) | — | — | platí | — | — |
| Nastavení | `settings-pro` | — | — | — | — | — | — | — | platí | — | platí | platí | — | — | — | platí | platí | — | — | platí |
| Nastavení · Tarif | `plan-free` | — | — | — | — | — | — | — | — | — | platí | platí | — | — | platí | — | — | platí | — | — |

## Tabulka B, web

Stav po kroku 3. Datum v poli říká, kdy pole prošlo živým během na dev obchodě. `neověřeno` není `platí`.

| Blok | Horizon | Dawn | Mobil 390 px | Náhled = web | Stav v aplikaci = skutečnost | „Otevřít v editoru“ | Prázdný stav |
|---|---|---|---|---|---|---|---|
| `won_discounts_embed` (vložení, košík, pruh nahoře přepínačem) | platí (12. 10.) | platí (12. 10.) | platí (12. 10.) | platí (vzhledy Milníků, 9. 10. a Pro 12. 10.) | platí | neověřeno, editor | platí |
| `quantity_tiers` (tabulka) | platí (12. 10.) | platí (12. 10.) | platí (12. 10.) | platí (převod vzhledu, stejné pixely, 9. 10.) | platí | neověřeno, editor | platí |
| `rewards_progress` (Milníky na stránce) | platí (12. 10.) | platí (12. 10.) | platí | platí | platí v náhledu (byl 9), naživo neověřeno | neověřeno, editor | platí |
| `cart_rewards` (Milníky a kód v košíku) | platí (12. 10.) | platí (12. 10.) | platí | neověřeno (vzhledy podle místa, kolo 7) | platí (byl 19: odkaz nic nepřidává) | neověřeno, editor | platí |
| `card_tiers` (cena na kartě, BETA) | platí (9. 10.) | platí (9. 10.) | platí | — | platí | — | platí |
| `outlet_badge` (štítek výprodeje) | platí (12. 10., jen u vybrané varianty) | platí (12. 10.) | platí (12. 10.) | neověřeno | platí v náhledu (byl 10), naživo neověřeno | neověřeno, editor (`previewPath`) | neověřeno (`outlet.sample` je vidět jen v editoru) |
| `campaign_banner` | neověřeno od MVP 6 | neověřeno | neověřeno | neověřeno | platí v náhledu (byl 12), naživo neověřeno | neověřeno, editor | neověřeno |
| `top_bar` | neověřeno (Horizon nemá kam) | neověřeno | neověřeno | neověřeno | neověřeno | neověřeno, editor | neověřeno |
| `announcement_milestones` | neověřeno (nový, kolo 7) | neověřeno | neověřeno | neověřeno | neověřeno | neověřeno, editor | neověřeno |
| `announcement_campaign` | neověřeno (nový, kolo 7) | neověřeno | neověřeno | neověřeno | neověřeno | neověřeno, editor | neověřeno |

Co je v tabulce B `neověřeno`, jde ověřit jen v editoru šablon, nebo na to není živý test. Všechno je v seznamu
„Ověř sám“ v oddílu Krok 3.

## Tabulka C, scénáře obchodníka

Počty kliknutí jsou z náhledu, od úvodní stránky po hotový výsledek, bez psaní do polí. Výběr produktu v okně Shopify
počítám jako 2 kliknutí. Přesnost ±1.

| # | Scénář | Kliknutí před | Kde jsem se zasekl (před) | Co jsem musel hádat (před) | Kliknutí po a co se změnilo |
|---|---|---|---|---|---|
| 1 | První spuštění až po běžící slevu | 9 | Nikde. | Kroky 4 a 5 mají štítek „Vypnuto“: je něco vypnuté, nebo jen nehotové? (nález 1) | 9. Kroky 4 a 5 jsou bez štítku, dokud nejsou hotové. |
| 2 | Doprava zdarma a dárek pro CZ a SK, vidět na webu | 15 | Nikde. | Prázdné Milníky svítí červeně dřív, než cokoli nastavím (6). Dlaždice říká „Aktivní“, řádek pod ní „Na webu chybí“ (9). | 15. Prázdné Milníky nesvítí červeně; dlaždice počítá chybějící místo. |
| 3 | Množstevní sleva, výjimka, tabulka na produktu | 16 | Nikde. | V pohledu „Tabulka na webu“ jsou dvě tlačítka Uložit, to první neukládá nic z toho, co vidím (7). | 16. V pohledu „Tabulka na webu“ je jediné Uložit (vzhled). |
| 4 | Sleva kódem, dávka náhodných kódů | 7 | **U dávky kódů:** chybí tlačítko, „100“ v poli vypadá jako vyplněná hodnota (5). | Že kódy vzniknou až po Uložit celé slevy. | 7. Pod polem je věta, že kódy vzniknou při Uložit; bez zaseknutí. |
| 5 | Výprodej se štítkem, kombinace s množstevní slevou | 11 | Nikde. | Žlutý pruh „Prodané kusy se zatím nepočítají“ (viz „Po review“). | 11. Beze změny. |
| 6 | Kampaň s bannerem a odpočtem | 10 | **Po naplánování:** formulář o banneru neříká nic, je pod třetí dlaždicí (13). | Jestli je banner na webu: dlaždice říká „Aktivní“, blok je ale na špatném místě (12). | 10 (+1 na banner z posledního kroku). Poslední krok říká, kde je banner, a vede tam. |
| 7 | Ochrana marže: obchod, kolekce, produkt, kde zasáhla | 12 | Nikde. | Jestli nastavení kolekce platí: dlaždice nemá štítek stavu (14). | 12. Dlaždice kolekcí má štítek Aktivní. |
| 8 | Vyzkoušet košík | 5 | Nikde. | Proč je stejné upozornění pětkrát pod sebou (16). Co s řádky ve výsledku: „Otevřít slevu“ je odkaz na konci věty (17). | 5. Nález je jednou, výsledek říká „Co s tím“. |
| 9 | Druhý jazyk v Překladech, export a import | 6 | Nikde. | Nic. | 6. Beze změny. |
| 10 | Trhy a měny, chybějící částka | 4 | Nikde. | Na Přehledu řádek neříká „co s tím“, jen tlačítko „Doplnit hodnotu“ (2). | 4. Na Přehledu je u každé věci „Co s tím“ a hlavní tlačítko. |
| 11 | Tarif: Free, Pro, přechod zpět | 2 | Nikde. | Nic. | 2. Beze změny. |

## Seznam nálezů

Druh: 1 nevidím stav, 2 dlouhá stránka, 3 nechápu, co to dělá, 4 web je jinak než aplikace, 5 pravidlo platí jen někde.
Značka: **A** brání, **B** mate, **C** vkus.

Nález A není z průchodu adminu žádný. Může přibýt z kroku 3 (web).

Všech 19 nálezů B z průchodu a nález 20 jsou opravené, každý má test v `apps/won-discounts/tests/ui/pred-review.test.ts`
(a kde je potřeba kliknutí, v `tests/e2e-preview/admin.pred-review.spec.ts`).

U opravených nálezů je screenshot po opravě ve složce `po/` pod stejným názvem.

### B, mate

| # | Kde | Druh | Co obchodník vidí | Proč je to špatně | Screenshot | Stav |
|---|---|---|---|---|---|---|
| 1 | Průvodce, kroky 4 a 5 | 1 | „4. První sleva · Vypnuto“, „5. Hotovo · Vypnuto“ | „Vypnuto“ je slovo pro přepínač. Krok není vypnutý, jen ještě není hotový. | `onboarding-4` | opravený |
| 2 | Přehled, „Vyžaduje pozornost“ | 5 | Řádek „Pozor · …“ a obyčejné tlačítko | Pravidlo P7 (co se stalo, co s tím, hlavní tlačítko) platí jen ve Vyzkoušet košík. | `overview-free` | opravený |
| 3 | Slevy a kódy, seznam | 5 | Řádky se slovem „Upravit“ bez rámečku, „Nová sleva ze vzoru“ rozbalovací | P4: hlavní akce řádku nevypadá jako tlačítko, recepty jsou schované v rozbalení. | `discounts` | opravený |
| 4 | Editor slevy | 5 | Pět sekcí pod sebou bez čísel | P5: formulář, který se vyplňuje popořadě, nemá kroky. Výprodej a Kampaň je mají. | `rule-editor-new-code` | opravený: čtyři sekce nesou „Krok n / 4“. Nejsou to karty `StepCard`: editor je i formulář úprav, drží stavový řádek sekce a boční menu (§19f). |
| 5 | Editor slevy, „Vygenerovat kódy“ | 3 | Pole „Kolik kódů“ se šedým „100“, žádné tlačítko | Nejde poznat, že se má napsat počet a uložit slevu. Šedé „100“ vypadá jako vyplněné. | `rule-editor-batch` | opravený |
| 6 | Množstevní slevy a Milníky, prázdný obchod | 1 | Dlaždice „… na webu · Vyžaduje pozornost · 1 věc k vyřešení“ | Červená dřív, než je co ukazovat. Obchodník nic nepokazil. | `tiers-empty`, `rewards-empty` | opravený |
| 7 | Množstevní slevy → Tabulka na webu, Milníky → Vzhled | 3 | Tlačítko „Uložit“ stránky nad sekcí vzhledu, která má vlastní „Uložit vzhled“ | Dvě Uložit, první neukládá nic z toho, co je v pohledu vidět (P3, §18i). | `tiers-free--view-table`, `rewards-pro--view-look` | opravený |
| 8 | Sekce vzhledu na Free (tabulka, milníky, štítek, banner) | 2 | Celý zamčený formulář Pro včetně anglického zadání pro AI | Stránka má 2 100 px, půlka je šedá a nejde použít. §18h: zamčená funkce je jedna věta a odkaz na tarif. | `tiers-free--view-table` | opravený |
| 9 | Milníky → Milníky na webu | 1 | Dlaždice zelená „Aktivní“, řádek „Stránka produktu“ červený „Na webu chybí“ s hlavním tlačítkem | Dvě místa si odporují: je to v pořádku, nebo ne? | `rewards-free--view-web` | opravený |
| 10 | Výprodej, dlaždice „Štítek na webu“ | 1 | Žádný štítek stavu, jen červené „1 věc k vyřešení“ | Ostatní dlaždice „na webu“ štítek mají. | `outlet-pro` | opravený |
| 11 | Kampaně, seznam | 5 | Karty bez hlavičky, stav jako text „Aktivní · datum“, tlačítka dole | P4: běžící výprodej má kartu s hlavičkou, štítkem a tlačítkem, kampaň ne. | `campaigns-pro` | opravený |
| 12 | Kampaně, dlaždice „Kampaň na webu“ | 1 | „Aktivní · 1 místo je na webu“ | To jedno místo má štítek „Na webu, špatné místo“, zákazník banner nevidí. Zelená nad blokem, který nikdo nevidí (§20i). | `campaigns-pro--view-places` | opravený |
| 13 | Kampaně → Nová kampaň | 3 | Tři kroky bez zmínky o banneru a odpočtu; úvod je tam dvakrát | Kde se zapíná banner, se obchodník nedozví. | `campaigns-pro--view-form` | opravený |
| 14 | Ochrana marže, dlaždice „Podle kolekcí“ a „Podle produktů“ | 1 | „Vlastní nastavení: Podzimní kolekce a Doplňky“ bez štítku | Nastavení platí, dlaždice to neříká. | `margin-pro` | opravený |
| 15 | Ochrana marže → Nákupní ceny | 5 | Štítek „Jen přehled“ na dlaždici, pod ní ale chybí pruh „tady nic nezapínáte“; seznam je rozbalovací | P3 platí u Snížených slev, tady ne. | `margin-pro--view-costs` | opravený |
| 16 | Vyzkoušet košík, Časté kombinace | 2 | Pět karet, v každé tytéž dva nálezy; ke košíku je to 2 500 px | Stejná věta pětkrát, formulář až pod tím. | `try-cart-warnings` | opravený |
| 17 | Vyzkoušet košík, „Co se uplatní“ | 5 | Žlutý pruh s odrážkami, „Otevřít slevu“ jako odkaz na konci věty | P7 platí o sekci výš, tady ne. | `try-cart-warnings` | opravený |
| 18 | Přehledy na Free | 5 | „Ukázka, ne vaše čísla“ se dvěma vymyšlenými řádky | Rozhodnutí z 6. 10.: vymyšlené ukázky se neukazují (§18h). | `analytics-free` | opravený |
| 19 | Milníky na webu, „Stránka košíku“ | 4 | „Na webu“ a „Otevřít úpravu vzhledu“ | Polohu košíkového bloku aplikace nečte (P9, sloupec „Kde ještě ne“). | `rewards-free--view-web` | nebyl to nález: odkaz u bloku, který v košíku je, jen otevírá editor a nic nepřidává (test). Polohu na stránce košíku aplikace záměrně neposuzuje, blok tam nejde přehlédnout. |
| 20 | Všechny stránky (nalezeno při screenshotech po opravě) | 4 | Uprostřed českého slova znak „�“ („vět�ší slevu“, „vr�áceno“) | Při odesílání stránky se před písmeno s diakritikou na hranici bloku vložil nulový bajt (React 18.3.1 na Node 26.10; samotný text je v pořádku). Které slovo to postihne, se mění s délkou stránky. | `po/margin-pro--1440` (po opravě) | opravený |

### C, vkus (neopravuje se, k rozhodnutí)

| # | Kde | Co |
|---|---|---|
| C1 | Přehled, „Co Won hlídá a co přinesl“ | Řádek „Připravujeme“. Odporuje §18h, ale vznikl v kole z 9. 10. jako součást bodu 2. Nechat, nebo schovat? |
| C2 | Přehled, dlaždice Výprodej na Pro | Štítky „Pro“ a „Vyžaduje pozornost“ se lámou na dva řádky. |
| C3 | Průvodce, krok 2 | „Pokračovat“ je nevýrazné vedle černého „Přesunout do Won“. |
| C4 | Pole s datem | Zástupný text „YYYY-MM-DD“ a datum „November 27, 2026“ anglicky; u kampaně čas „2026-09-28 14:00“. V Shopify adminu se může řídit jazykem účtu, v náhledu to nejde poznat. |
| C5 | Množstevní slevy → Pro celý obchod | Čtyři odstavce vysvětlení vedle náhledu. |
| C6 | Ochrana marže → Hranice | „Jak to funguje“, příklad, dva odstavce a nápověda pod každým polem. Hodně textu, ale příklad s čísly tam je. |
| C7 | Přehledy | Stránka je celá přehled a nemá „Jen přehled“ (P3). Neleží na cestě žádného scénáře. |
| C8 | Editor slevy, „Pro koho platí a kombinace“ | Na Pro je sekce sbalená (§18g) a kombinace nejsou karty volby (P6). Neleží na cestě žádného scénáře. |
| C9 | Vyzkoušet košík, Free a prázdný | Boční menu s jedinou položkou „Košík“. |
| C10 | Výprodej → Pravidla výprodeje | Dlouhý výčet „Povolená / Nepovolená“; totéž jde přepnout i v Nastavení. |
| C11 | Milníky na mobilu | Náhled žebříčku je nad formulářem stupňů. |
| C12 | Dlaždice pohledů u Pro částí (Marže, Výjimky, Nový výprodej) | Na tarifu Pro nemají štítek „Pro“. Rozhodnutí „štítek Pro vždy vidět“ jsem vyložil jako pravidlo pro dlaždice úvodní stránky a pruh pod nadpisem; tam platí. Má platit i tady? |
| C13 | Výprodej → Vratky | „Uložit“ je tam světlé, jinde tmavé. |
| C14 | Přehled, „Vyžaduje pozornost“ | Po opravě nálezu 2 jsou upozornění karty (dvě vedle sebe). Při pěti upozorněních začínají dlaždice modulů až pod první obrazovkou (§19d). |
| C15 | Výprodej → Výprodeje, Kampaně | Stránka má dlaždice a přes 1,5 obrazovky, boční menu nemá: dlaždice a boční menu se podle §19f neskládají. |

## Krok 3, ověření naživo (12. 10. 2026)

Dev obchod `b2b-b2c-store-development`, `shopify app dev` puštěný touhle session (Free, potom `WON_DEV_PLAN=pro`),
jen přes runbook: seed nanečisto → naostro → Horizon + Dawn → úklid → kontrola čistoty. Screenshoty a data z běhů:
[`evidence/pred-review-2026-10-10/nazivo/`](evidence/pred-review-2026-10-10/nazivo/).

| Běh | Horizon | Dawn | Úklid |
|---|---|---|---|
| `rewards` (Free): pruh, košík, dárek, slovenské částky, pokladna Bogus | 8 z 8 | 8 z 8 | `cleanup` 0, `verify-clean` 0 |
| `tiers` (Free): tabulka, přepnutí varianty, košík, pokladna Bogus, 390 px | 7 z 8 | 7 z 8 | `cleanup` 0, `verify-clean` 0 |
| `outlet` (Pro), první běh: cena výprodeje, košík, pokladna Bogus | 4 z 5 | 4 z 5 | ceny vrácené a ověřené, `cleanup` 0, `verify-clean` 0 |
| `outlet` (Pro), opakování s přepsaným testem: navíc štítek jen u vybrané varianty, bez názvu varianty | 5 z 5 | 5 z 5 | ceny vrácené a ověřené, `cleanup` 0, `verify-clean` 0 |
| `rewards-pro`: žebříček, výběr ze tří dárků | 4 z 4 | 4 z 4 | `cleanup` 0, `verify-clean` 0 |
| `tiers-pro`: výjimky pro produkty a kolekce | 6 z 6 | 6 z 6 | `cleanup` 0, `verify-clean` 0 |
| `margin-pro`: hranice obchodu, kolekce a produktu v košíku a pokladně | 0 z 6 | 2 z 6 | `cleanup` 0, `verify-clean` 0 |
| `shapes` (Pro): tvary slev v pokladně | 4 z 4 | 4 z 4 | `cleanup` 0, `verify-clean` 0 |

Co neprošlo a proč:

- **`tiers`, krok „slovensko (EUR)“ a celý `margin-pro`:** testy porovnávají košík se záznamem běhu pokladní funkce
  v `apps/won-discounts/.shopify/logs`. Dev relace puštěná z téhle session ty záznamy nestahuje (v jejím výstupu se
  opakuje „Error while polling app logs“; poslední soubory ve složce jsou ze 7. 10.). Části testu před tím krokem
  prošly (tabulka v eurech, cena na stránce nikdy neslibuje víc než košík). Není to chyba aplikace, je to chybějící
  vstup pro test. Ověří se z Ondřejova terminálu, kroky jsou v seznamu níž.
- **`outlet`, test stránky produktu:** test byl zastaralý. Čekal štítek u varianty hned po otevření a s názvem
  varianty; od 9. 10. se štítek ukazuje jen u vybrané varianty a bez názvu. Test je přepsaný
  (`tests/e2e/storefront.outlet.spec.ts`) a opakovaný běh prošel 5 z 5 na obou šablonách.
- **`margin-pro` na Dawnu** navíc čtyřikrát dostal od obchodu HTTP 401 (obchod po sérii běhů odmítal stránky).
- **`costs-clear` skončil 1** u `tiers` a `tiers-pro`: úklid obnovil ze zálohy nastavení, které v obchodě bylo před
  během (1 sleva, ochrana marže zapnutá, množstevní slevy). S ochranou zapnutou skript nákupní ceny záměrně nemaže.
  Obchod je ve stavu před během.

### 17 položek „neověřeno naživo“ z build logu

| # | Položka (kde v build logu) | Stav | Důkaz nebo důvod |
|---|---|---|---|
| 1 | Kolo 7: `previewPath` v editoru, nové bloky v editoru, vzhledy podle místa na webu | nejde ověřit bez Ondřeje | editor šablon; pro vzhledy podle místa není živý test |
| 2 | Dárkové karty: hodinová úloha proti obchodu, pokladna s dárkovou kartou | nejde ověřit bez Ondřeje | dev obchod nemá dárkovou kartu jako produkt, test neexistuje |
| 3 | Kolo 6: výběr bloku v editoru, pokladna s částečně kombinovaným výprodejem | nejde ověřit bez Ondřeje | editor; výprodej „bez dalších slev“ v košíku a pokladně prošel (`outlet`), částečná kombinace živý test nemá |
| 4 | Kolo 3, bod 4: blok „Top bar“ v editoru (Horizon nemá kam) | nejde ověřit bez Ondřeje | editor šablon |
| 5 | Kolo 3: pokladna s hranicí marže podle produktu, blok v editoru | nejde ověřit bez Ondřeje | `margin-pro` potřebuje záznamy funkce (viz výš); editor |
| 6 | Dotažení, body 5 a 6: klikání v aplikaci uvnitř Shopify adminu | nejde ověřit bez Ondřeje | do `admin.shopify.com` se Playwrightem nepřihlašuje (B4); v náhledu 38 z 38 |
| 7 | Dotažení, bod 4: „Povolit čtení jazyků“ v Shopify adminu | nejde ověřit bez Ondřeje | dialog oprávnění je jen v adminu |
| 8 | Dotažení, část B: kontrola kombinací v běžící aplikaci (uložení → dlaždice, denní úloha) | nejde ověřit bez Ondřeje | admin |
| 9 | Dotažení, část C: vlastní CSS košíku a pruhu na webu (Pro), blok kampaně bez zaškrtávátka v editoru | **ověřeno** (texty a vzhled Milníků na Pro), zbytek bez Ondřeje nejde | `looks.sh rewards-pro … --texts --looks milestones=checklist+blink`: 2 z 2 na Horizonu i Dawnu, úklid 0; vlastní CSS košíku živý test nemá, blok kampaně je editor |
| 10 | Úkol 8 A: čtení `tx_<jazyk>` na webu, `read_locales`, klikání na stránce Překlady | **ověřeno** (texty), zbytek bez Ondřeje nejde | texty podle jazyka naživo na Horizonu i Dawnu 9. 10. (`evidence/dotazeni-8-9/`); oprávnění a klikání jsou admin |
| 11 | Úkol 8 B: nové vzhledy na webu, odpočet u výprodeje, bliknutí | **ověřeno** (Milníky), zbytek neověřeno | vzhledy Milníků a bliknutí naživo 9. 10.; vzhledy Výprodeje a Kampaně živý test nemají |
| 12 | Úkol 9: kontrola kombinací v běžící aplikaci | nejde ověřit bez Ondřeje | admin (totéž co 8) |
| 13 | Navigace a stav: Horizon a Dawn, screenshot věty v aplikaci | **ověřeno** | tabulka a žebříček na obou šablonách dnes (`tiers`, `rewards`); věta je na screenshotech náhledu |
| 14 | Kolo 3 (6. 10.): klikání u výjimek v běžící aplikaci | nejde ověřit bez Ondřeje | admin; v náhledu kryto testem prohlížeče |
| 15 | Úkol 7: pokladna Bogus na Dawnu v profilu `rewards`; boční košík na Dawnu; limit po trzích na Free | **ověřeno** (pokladna, limit), boční košík ne | Dawn 8 z 8 včetně pokladny a slovenských částek; zkušební kopie Dawnu boční košík nemá |
| 16 | Barva zvýraznění tabulky na webu | **ověřeno** | převod vzhledu a barvy naživo 9. 10., tabulka dnes na obou šablonách |
| 17 | Čtení trhů v dev obchodě po změně oprávnění; čtení skutečného tématu (úvodní stránka, košík, pruh) | **ověřeno** (trhy), čtení tématu neověřeno | seed dnes četl trhy Česko a Slovensko a testy prošly se slovenskými částkami; polohu bloků v živém tématu ukazuje jen admin |

### Ověř sám (Ondřej), přesné kroky

**1. Marže a slovenský kurz proti záznamům pokladní funkce (terminál, asi 40 minut).** Dvě okna terminálu.

```
cd ~/Development/WonCommerce/Apps/b2b_b2c
NODE_ENV=development WON_DEV_PLAN=pro npm run dev -w won-discounts
```

Ve výstupu se nesmí opakovat „Error while polling app logs“. Ve druhém okně:

```
cd ~/Development/WonCommerce/Apps/b2b_b2c
node apps/won-discounts/scripts/e2e/margin-collection.mjs --fixture margin --live
bash apps/won-discounts/scripts/e2e/runbook/profile.sh margin-pro overeni pro
node apps/won-discounts/scripts/e2e/margin-collection.mjs --fixture margin --delete --live
cat "${TMPDIR:-/tmp}/won-discounts-runs/overeni/progress.txt"
```

Má tam být `margin-pro e2e exit=0` a `margin-pro verify-clean exit=0`. Potom první okno zastav, pusť
`npm run dev -w won-discounts` (bez `WON_DEV_PLAN`) a ve druhém
`bash apps/won-discounts/scripts/e2e/runbook/profile.sh tiers overeni free`; čekáš `tiers e2e exit=0`.

**2. Editor šablon (Shopify admin → Won Discounts, tarif Pro).** U každého kroku: editor se otevře, blok je vybraný
v levém stromu a žádný druhý blok nepřibyl.

1. Výprodej → Štítek na webu → tlačítko v hlavičce. Otevře se produkt, který je ve výprodeji (ne výchozí produkt
   šablony), s blokem „Sale badge“. Když žádný výprodej neběží, blok v editoru ukáže označenou ukázku.
2. Množstevní slevy → Tabulka na webu → odkaz do editoru. Vybraný blok „Quantity tiers“.
3. Milníky → Milníky na webu → řádek „Pruh nahoře“. V editoru jde do záhlaví přidat blok „Announcement: Milestones“
   (Dawn). Na Horizonu záhlaví bloky aplikací nebere; má tam zůstat funkční přepínač ve vložení aplikace.
4. Kampaně → Kampaň na webu → „Přidat pruh do záhlaví“. Blok „Announcement: Campaign“; v nastavení bloku
   „Campaign banner“ není zaškrtávátko odpočtu.
5. Kampaně → Kampaň na webu: po přetažení banneru na úvodní stránce nahoru a „Zkontrolovat znovu“ zmizí štítek
   „Na webu, špatné místo“ a dlaždice zezelená.

**3. Aplikace v Shopify adminu.**

1. Překlady → „Povolit čtení jazyků“ → potvrdit. Seznam jazyků se objeví bez načtení stránky.
2. Uložit libovolnou slevu → Přehled. Dlaždice „Vyzkoušet košík“ ukáže nové počty „v pořádku / upozornění“.
3. Milníky → Vzhled a vlastní CSS → Pruh nahoře → „Jen věta“ → Uložit vzhled. Na webu je pruh bez ukazatele, košík
   a blok na stránce se nezměnily.
4. Milníky → Vzhled a vlastní CSS → Rámeček košíku a pruhu → vlastní CSS `.won-cart__saved { letter-spacing: 2px; }`
   → Uložit vzhled. V košíku na webu je řádek „Ušetříte“ roztažený.

**4. Pokladna.**

1. Výprodej s volbou „I s vybranými slevami → Množstevní sleva“, tři kusy v košíku: pokladna ukáže výprodejovou
   cenu a k ní množstevní slevu; kód na objednávku se na ten řádek nepřičte.
2. Dárková karta (produkt typu dárková karta) v košíku se slevou z objednávky a s množstevní slevou: na řádku karty
   není žádná sleva. Příznak zapisuje hodinová úloha, po založení karty počkej hodinu.

## Po review

Věci, které při průchodu chyběly nebo nejsou hotové, a do tohohle zadání nepatří:

- **Výprodej bez přístupu k objednávkám.** Na každém pohledu Výprodeje je žlutý pruh „Prodané kusy se zatím
  nepočítají“. Je pravdivý (5b je odložené), ale klient uvidí, že hlavní slib modulu zatím neplatí.
- **Ukázkový obchod.** Dev obchod má USD a produkty `won-e2e-*`.
- **Přehled: čísla „kolik kusů navíc“ a „kolik ochrana marže ušetřila“** se nesbírají (C1).
- **Pruh nahoře pro výprodej a množstevní slevy** neexistuje (rozhodnutí: výprodej do pruhu nepatří).
