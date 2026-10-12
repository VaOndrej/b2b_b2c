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

P10 jsem v prvním průchodu myší neprocházel; pole říká, že prvky nesou značku `hoverMark`. Skutečné najetí myší se
ověří v druhém průchodu po opravách.

| Obrazovka nebo pohled | Screenshot | P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | §17 | §18b | §18g | §18h | §18i | §19a | §19b | §19c | §19f |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Přehled, prázdný obchod | `overview-off-pro` | — | platí | — | — | — | — | — | — | — | platí | platí | platí | — | platí | — | platí | platí | — | — |
| Přehled, naplněný | `overview-free` | — | platí | — | — | — | — | platí (byl 2) | — | — | platí | platí | platí | — | platí | — | platí | platí | — | — |
| Přehled, chyba zápisu | `overview-failed` | — | platí | — | — | — | — | platí (byl 2) | — | — | platí | platí | — | — | — | — | platí | platí | — | — |
| Průvodce, kroky 1 až 3 | `onboarding-3` | — | — | — | — | — | — | — | — | — | platí | platí | platí | platí | — | — | platí | — | — | — |
| Průvodce, kroky 4 a 5 | `onboarding-4` | — | — | — | — | — | — | — | — | — | platí | platí | platí | — | — | — | platí (byl 1) | — | — | — |
| Slevy a kódy, seznam | `discounts` | — | — | — | **neplatí (3)** | — | — | — | — | — | platí | platí | platí | platí | — | — | platí | — | — | platí |
| Slevy a kódy, prázdný | `discounts-empty` | — | — | — | — | — | — | — | — | — | platí | platí | platí | — | — | — | platí | — | — | platí |
| Editor slevy | `rule-editor-new-code` | — | — | — | — | **neplatí (4)** | — | — | platí | — | platí | platí | — | platí | — | platí | platí | platí | — | platí |
| Editor slevy, kódy a dávky | `rule-editor-batch` | — | — | — | — | — | — | — | platí | — | platí | platí | — | — | platí | **neplatí (5)** | — | platí | — | — |
| Množstevní slevy · Pro celý obchod | `tiers-free` | platí | platí | — | — | — | — | — | — | — | platí | platí | — | — | — | platí | platí | — | — | platí |
| Množstevní slevy · Tabulka na webu | `tiers-free--view-table` | platí | platí | — | — | — | — | — | platí (byl 8) | platí | platí | platí | — | platí | platí (byl 8) | platí (byl 7) | platí | — | platí | platí |
| Množstevní slevy · Výjimky | `tiers-exceptions--view-exceptions` | platí | platí | — | platí | — | — | — | — | — | platí | platí | — | — | platí | platí | platí | platí | — | platí |
| Množstevní slevy, prázdný | `tiers-empty` | platí | platí | — | — | — | — | — | — | — | platí | — | platí | — | — | — | platí (byl 6) | — | — | platí |
| Milníky · Stupně | `rewards-pro` | platí | platí | — | platí | — | — | — | — | — | platí | platí | — | — | — | platí | platí | — | — | platí |
| Milníky · Milníky na webu | `rewards-free--view-web` | platí | platí | — | — | — | — | — | — | **neplatí (19)** | platí | platí | — | — | — | — | platí (byl 9) | — | platí | platí |
| Milníky · Vzhled a vlastní CSS | `rewards-pro--view-look` | platí | platí | — | — | — | — | — | platí | — | platí | platí | — | — | platí (byl 8) | platí (byl 7) | platí | — | — | platí |
| Milníky, prázdný | `rewards-empty` | platí | platí | — | — | — | — | — | — | — | platí | — | platí | — | — | — | platí (byl 6) | — | — | platí |
| Výprodej · Výprodeje | `outlet-pro` | platí | platí | — | platí | — | platí | platí | — | platí | platí | platí | — | platí | — | — | platí (byl 10) | — | platí | platí |
| Výprodej · Nový výprodej | `outlet-pro--view-new` | platí | platí | — | — | platí | platí | — | — | platí | platí | — | — | platí | — | platí | platí | — | platí | platí |
| Výprodej · Štítek na webu | `outlet-pro--view-web` | platí | platí | — | — | — | — | — | platí | platí | platí | platí | — | — | platí | platí | platí (byl 10) | — | platí | platí |
| Výprodej · Pravidla výprodeje | `outlet-pro--view-info` | platí | platí | — | platí | — | platí | — | — | — | platí | platí | — | — | — | platí | platí | — | — | platí |
| Výprodej, Free | `outlet-free` | platí | platí | — | — | — | — | — | — | — | platí | — | — | — | platí | — | platí | platí | — | platí |
| Kampaně · Kampaně | `campaigns-pro` | platí | platí | — | **neplatí (11)** | — | — | — | — | — | platí | platí | platí | — | — | — | platí | — | — | platí |
| Kampaně · Nová kampaň | `campaigns-pro--view-form` | platí | platí | — | — | **neplatí (13)** | — | — | — | — | platí | — | — | — | — | platí | platí | — | — | platí |
| Kampaně · Kampaň na webu | `campaigns-pro--view-places` | platí | platí | — | — | — | — | — | — | platí | platí | platí | — | — | — | platí | platí (byl 12) | — | platí | platí |
| Kampaně, Free | `campaigns-free` | platí | platí | — | — | — | — | — | — | — | platí | — | — | — | platí | — | platí | platí | — | platí |
| Ochrana marže · Hranice | `margin-pro` | platí | platí | — | — | — | — | — | — | — | platí | platí | — | — | — | platí | platí | — | — | platí |
| Ochrana marže · Nákupní ceny | `margin-pro--view-costs` | platí | platí | **neplatí (15)** | — | — | — | — | — | — | platí | platí | — | platí | — | platí | platí | — | — | platí |
| Ochrana marže · Podle kolekcí | `margin-pro--view-collections` | platí | platí | — | platí | — | — | — | — | — | platí | platí | — | — | — | platí | platí (byl 14) | platí | — | platí |
| Ochrana marže · Podle produktů | `margin-pro--view-products` | platí | platí | — | platí | — | — | — | — | — | platí | platí | platí | — | — | platí | platí | platí | — | platí |
| Ochrana marže · Snížené slevy | `margin-pro--view-impact` | platí | platí | platí | — | — | — | — | — | — | platí | platí | — | — | — | platí | platí | platí | — | platí |
| Ochrana marže, vypnutá | `margin-off` | platí | platí | — | — | — | — | — | — | — | platí | platí | — | — | platí | — | platí | platí | — | platí |
| Vyzkoušet košík · Časté kombinace | `try-cart-warnings` | — | — | — | platí | — | — | platí | platí (byl 16) | — | platí | platí | — | — | — | — | platí | — | — | platí |
| Vyzkoušet košík · Košík a výsledek | `try-cart-warnings` | — | — | platí | — | — | — | platí (byl 17) | platí | — | platí | platí | — | — | — | platí | — | — | — | — |
| Vyzkoušet košík, Free | `try-cart-free` | — | — | — | — | — | — | — | — | — | platí | — | — | — | platí | — | — | platí | — | — |
| Překlady | `translations-pro` | — | — | — | — | — | — | — | platí | — | platí | platí | — | platí | — | platí | platí | platí | — | platí |
| Přehledy, Pro | `analytics-pro` | — | — | — | — | — | — | — | — | — | platí | platí | platí | — | — | — | — | — | — | — |
| Přehledy, Free | `analytics-free` | — | — | — | — | — | — | — | — | — | platí | platí | — | — | **neplatí (18)** | — | — | platí | — | — |
| Nastavení | `settings-pro` | — | — | — | — | — | — | — | platí | — | platí | platí | — | — | — | platí | platí | — | — | platí |
| Nastavení · Tarif | `plan-free` | — | — | — | — | — | — | — | — | — | platí | platí | — | — | platí | — | — | platí | — | — |

## Tabulka B, web

Stav sloupců je z dosavadních živých běhů zapsaných v build logu. Co se od posledního běhu změnilo (kola 3 až 7) a
naživo se nezkoušelo, je `neověřeno` a patří do kroku 3. `neověřeno` není `platí`.

| Blok | Horizon | Dawn | Mobil 390 px | Náhled = web | Stav v aplikaci = skutečnost | „Otevřít v editoru“ | Prázdný stav |
|---|---|---|---|---|---|---|---|
| `won_discounts_embed` (vložení, košík, pruh) | platí (dotažení 8–9) | platí | platí | platí (vzhledy Milníků) | platí | neověřeno | platí |
| `quantity_tiers` (tabulka) | platí (dotažení 8–9) | platí | platí | platí (převod vzhledu, stejné pixely) | platí | neověřeno (výběr bloku) | platí |
| `rewards_progress` (Milníky na stránce) | platí | platí | platí | platí | neověřeno (**nález 9**) | neověřeno | platí |
| `cart_rewards` (Milníky a kód v košíku) | platí (MVP 4) | platí | platí | neověřeno (vzhledy podle místa, kolo 7) | neověřeno (**nález 19**, polohu nečteme) | neověřeno | platí |
| `card_tiers` (cena na kartě, BETA) | platí | platí | platí | — | platí | — | platí (oprava „BEGIN app snippet“) |
| `outlet_badge` (štítek výprodeje) | neověřeno od kola 3 | neověřeno | neověřeno | neověřeno | neověřeno | neověřeno (`previewPath`) | neověřeno (`outlet.sample`) |
| `campaign_banner` | neověřeno na Pro | neověřeno | neověřeno | neověřeno | platí v náhledu (byl 12), naživo neověřeno | neověřeno | neověřeno |
| `top_bar` | neověřeno (Horizon nemá kam) | neověřeno | neověřeno | neověřeno | neověřeno | neověřeno | neověřeno |
| `announcement_milestones` | neověřeno (nový, kolo 7) | neověřeno | neověřeno | neověřeno | neověřeno | neověřeno | neověřeno |
| `announcement_campaign` | neověřeno (nový, kolo 7) | neověřeno | neověřeno | neověřeno | neověřeno | neověřeno | neověřeno |

## Tabulka C, scénáře obchodníka

Počty kliknutí jsou z náhledu, od úvodní stránky po hotový výsledek, bez psaní do polí. Výběr produktu v okně Shopify
počítám jako 2 kliknutí. Přesnost ±1.

| # | Scénář | Kliknutí před | Kde jsem se zasekl | Co jsem musel hádat | Kliknutí po |
|---|---|---|---|---|---|
| 1 | První spuštění až po běžící slevu | 9 | Nikde. | Kroky 4 a 5 mají štítek „Vypnuto“: je něco vypnuté, nebo jen nehotové? (nález 1) | |
| 2 | Doprava zdarma a dárek pro CZ a SK, vidět na webu | 15 | Nikde. | Prázdné Milníky svítí červeně dřív, než cokoli nastavím (6). Dlaždice říká „Aktivní“, řádek pod ní „Na webu chybí“ (9). | |
| 3 | Množstevní sleva, výjimka, tabulka na produktu | 16 | Nikde. | V pohledu „Tabulka na webu“ jsou dvě tlačítka Uložit, to první neukládá nic z toho, co vidím (7). | |
| 4 | Sleva kódem, dávka náhodných kódů | 7 | **U dávky kódů:** chybí tlačítko, „100“ v poli vypadá jako vyplněná hodnota (5). | Že kódy vzniknou až po Uložit celé slevy. | |
| 5 | Výprodej se štítkem, kombinace s množstevní slevou | 11 | Nikde. | Žlutý pruh „Prodané kusy se zatím nepočítají“ (viz „Po review“). | |
| 6 | Kampaň s bannerem a odpočtem | 10 | **Po naplánování:** formulář o banneru neříká nic, je pod třetí dlaždicí (13). | Jestli je banner na webu: dlaždice říká „Aktivní“, blok je ale na špatném místě (12). | |
| 7 | Ochrana marže: obchod, kolekce, produkt, kde zasáhla | 12 | Nikde. | Jestli nastavení kolekce platí: dlaždice nemá štítek stavu (14). | |
| 8 | Vyzkoušet košík | 5 | Nikde. | Proč je stejné upozornění pětkrát pod sebou (16). Co s řádky ve výsledku: „Otevřít slevu“ je odkaz na konci věty (17). | |
| 9 | Druhý jazyk v Překladech, export a import | 6 | Nikde. | Nic. | |
| 10 | Trhy a měny, chybějící částka | 4 | Nikde. | Na Přehledu řádek neříká „co s tím“, jen tlačítko „Doplnit hodnotu“ (2). | |
| 11 | Tarif: Free, Pro, přechod zpět | 2 | Nikde. | Nic. | |

## Seznam nálezů

Druh: 1 nevidím stav, 2 dlouhá stránka, 3 nechápu, co to dělá, 4 web je jinak než aplikace, 5 pravidlo platí jen někde.
Značka: **A** brání, **B** mate, **C** vkus.

Nález A není z průchodu adminu žádný. Může přibýt z kroku 3 (web).

U opravených nálezů je screenshot po opravě ve složce `po/` pod stejným názvem.

### B, mate

| # | Kde | Druh | Co obchodník vidí | Proč je to špatně | Screenshot | Stav |
|---|---|---|---|---|---|---|
| 1 | Průvodce, kroky 4 a 5 | 1 | „4. První sleva · Vypnuto“, „5. Hotovo · Vypnuto“ | „Vypnuto“ je slovo pro přepínač. Krok není vypnutý, jen ještě není hotový. | `onboarding-4` | opravený |
| 2 | Přehled, „Vyžaduje pozornost“ | 5 | Řádek „Pozor · …“ a obyčejné tlačítko | Pravidlo P7 (co se stalo, co s tím, hlavní tlačítko) platí jen ve Vyzkoušet košík. | `overview-free` | opravený |
| 3 | Slevy a kódy, seznam | 5 | Řádky se slovem „Upravit“ bez rámečku, „Nová sleva ze vzoru“ rozbalovací | P4: hlavní akce řádku nevypadá jako tlačítko, recepty jsou schované v rozbalení. | `discounts` | otevřený |
| 4 | Editor slevy | 5 | Pět sekcí pod sebou bez čísel | P5: formulář, který se vyplňuje popořadě, nemá kroky. Výprodej a Kampaň je mají. | `rule-editor-new-code` | otevřený |
| 5 | Editor slevy, „Vygenerovat kódy“ | 3 | Pole „Kolik kódů“ se šedým „100“, žádné tlačítko | Nejde poznat, že se má napsat počet a uložit slevu. Šedé „100“ vypadá jako vyplněné. | `rule-editor-batch` | otevřený |
| 6 | Množstevní slevy a Milníky, prázdný obchod | 1 | Dlaždice „… na webu · Vyžaduje pozornost · 1 věc k vyřešení“ | Červená dřív, než je co ukazovat. Obchodník nic nepokazil. | `tiers-empty`, `rewards-empty` | opravený |
| 7 | Množstevní slevy → Tabulka na webu, Milníky → Vzhled | 3 | Tlačítko „Uložit“ stránky nad sekcí vzhledu, která má vlastní „Uložit vzhled“ | Dvě Uložit, první neukládá nic z toho, co je v pohledu vidět (P3, §18i). | `tiers-free--view-table`, `rewards-pro--view-look` | opravený |
| 8 | Sekce vzhledu na Free (tabulka, milníky, štítek, banner) | 2 | Celý zamčený formulář Pro včetně anglického zadání pro AI | Stránka má 2 100 px, půlka je šedá a nejde použít. §18h: zamčená funkce je jedna věta a odkaz na tarif. | `tiers-free--view-table` | opravený |
| 9 | Milníky → Milníky na webu | 1 | Dlaždice zelená „Aktivní“, řádek „Stránka produktu“ červený „Na webu chybí“ s hlavním tlačítkem | Dvě místa si odporují: je to v pořádku, nebo ne? | `rewards-free--view-web` | opravený |
| 10 | Výprodej, dlaždice „Štítek na webu“ | 1 | Žádný štítek stavu, jen červené „1 věc k vyřešení“ | Ostatní dlaždice „na webu“ štítek mají. | `outlet-pro` | opravený |
| 11 | Kampaně, seznam | 5 | Karty bez hlavičky, stav jako text „Aktivní · datum“, tlačítka dole | P4: běžící výprodej má kartu s hlavičkou, štítkem a tlačítkem, kampaň ne. | `campaigns-pro` | otevřený |
| 12 | Kampaně, dlaždice „Kampaň na webu“ | 1 | „Aktivní · 1 místo je na webu“ | To jedno místo má štítek „Na webu, špatné místo“, zákazník banner nevidí. Zelená nad blokem, který nikdo nevidí (§20i). | `campaigns-pro--view-places` | opravený |
| 13 | Kampaně → Nová kampaň | 3 | Tři kroky bez zmínky o banneru a odpočtu; úvod je tam dvakrát | Kde se zapíná banner, se obchodník nedozví. | `campaigns-pro--view-form` | otevřený |
| 14 | Ochrana marže, dlaždice „Podle kolekcí“ a „Podle produktů“ | 1 | „Vlastní nastavení: Podzimní kolekce a Doplňky“ bez štítku | Nastavení platí, dlaždice to neříká. | `margin-pro` | opravený |
| 15 | Ochrana marže → Nákupní ceny | 5 | Štítek „Jen přehled“ na dlaždici, pod ní ale chybí pruh „tady nic nezapínáte“; seznam je rozbalovací | P3 platí u Snížených slev, tady ne. | `margin-pro--view-costs` | otevřený |
| 16 | Vyzkoušet košík, Časté kombinace | 2 | Pět karet, v každé tytéž dva nálezy; ke košíku je to 2 500 px | Stejná věta pětkrát, formulář až pod tím. | `try-cart-warnings` | opravený |
| 17 | Vyzkoušet košík, „Co se uplatní“ | 5 | Žlutý pruh s odrážkami, „Otevřít slevu“ jako odkaz na konci věty | P7 platí o sekci výš, tady ne. | `try-cart-warnings` | opravený |
| 18 | Přehledy na Free | 5 | „Ukázka, ne vaše čísla“ se dvěma vymyšlenými řádky | Rozhodnutí z 6. 10.: vymyšlené ukázky se neukazují (§18h). | `analytics-free` | otevřený |
| 19 | Milníky na webu, „Stránka košíku“ | 4 | „Na webu“ a „Otevřít úpravu vzhledu“ | Polohu košíkového bloku aplikace nečte (P9, sloupec „Kde ještě ne“). | `rewards-free--view-web` | otevřený |
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

## Po review

Věci, které při průchodu chyběly nebo nejsou hotové, a do tohohle zadání nepatří:

- **Výprodej bez přístupu k objednávkám.** Na každém pohledu Výprodeje je žlutý pruh „Prodané kusy se zatím
  nepočítají“. Je pravdivý (5b je odložené), ale klient uvidí, že hlavní slib modulu zatím neplatí.
- **Ukázkový obchod.** Dev obchod má USD a produkty `won-e2e-*`.
- **Přehled: čísla „kolik kusů navíc“ a „kolik ochrana marže ušetřila“** se nesbírají (C1).
- **Pruh nahoře pro výprodej a množstevní slevy** neexistuje (rozhodnutí: výprodej do pruhu nepatří).
