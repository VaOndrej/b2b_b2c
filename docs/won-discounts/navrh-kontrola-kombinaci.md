# Won Discounts: kontrola kombinací — kdy se počítá a odkud bere produkty

Stav: **změřeno a zavedeno 8. 10. 2026** (dotažení úkolů 8 a 9, body 7, 8 a 11;
[zadání](prompt-dotazeni-ukol8-9.md)). Body 7 a 11 jsou hotové. U bodu 8 je zavedená doporučená varianta
a **čeká na potvrzení Ondřeje** (níž „K rozhodnutí“).

## Bod 7 — kdy se počítá

| | Dřív | Teď |
|---|---|---|
| Výpočet | při každém otevření Přehledu a Vyzkoušet košík | po každé synchronizaci nastavení (uložení čehokoli, „Synchronizovat znovu“, změna tarifu) a jednou denně |
| Kde je výsledek | nikde, počítal se znovu | tabulka `CombinationCheck`, jeden řádek na obchod |
| Stránky | plánovaly všechny scénáře | čtou jeden řádek |
| Otevření scénáře (`?scenario=`) | celý výpočet podruhé | ze stejného řádku, nic se nepočítá |

Měřeno lokálně (SQLite, obchod na Pro s 300 variantami v zrcadle nákupních cen, 5 scénářů, 40 opakování, medián):

| Co | Dřív | Teď |
|---|---|---|
| Kontrola při otevření stránky | 3,3 ms, 6 dotazů do databáze | 0,2 ms, 1 dotaz |
| Vyzkoušet košík (celé načtení stránky, bez Shopify) | 1,6 ms, 7 dotazů | 0,4 ms, 2 dotazy |
| Přehled (celé načtení stránky, bez Shopify) | 5,0 ms | 4,4 ms |
| Jeden výpočet po uložení nebo v denní úloze | – | 21 ms |

Na produkční databázi (Postgres přes síť) rozhoduje hlavně počet dotazů: 6 → 1 při každém otevření stránky.

Uložený výsledek nenese žádné texty (jen druhy nálezů, slevu za nálezem, částky a košík scénáře), stejný řádek
proto slouží českému i anglickému rozhraní. Denní úloha se jmenuje `combinations.daily`
(`app/lib/jobs/scheduler.server.ts`); měnu a časové pásmo obchodu bere z toho, co si zapsala poslední
synchronizace (`ShopSyncState.currency`, `timezone`).

**Co z toho plyne:** změna udělaná přímo v Shopify (cena, nákupní cena) se v kontrole projeví po příštím uložení
nebo do druhého dne. Stránka nápovědy to říká. Obchod, který od nasazení nic neuložil, dostane první výsledek
z denní úlohy nebo z Přehledu (ten si synchronizaci po nasazení vyžádá sám).

## Bod 8 — skutečné produkty i bez Ochrany marže

Zrcadlo nákupních cen (`VariantCost`) existuje jen se zapnutou Ochranou marže. Bez něj kontrola počítala
s ukázkovým produktem za 500.

| Varianta | Dotazy do Shopify | Co dá | Nevýhoda |
|---|---|---|---|
| A. Nechat ukázkový produkt | 0 | nic | scénáře nejsou o obchodníkově zboží, nejdou otevřít v košíku |
| **B. Jeden dotaz při synchronizaci, nejvýš jednou denně (zavedeno)** | 1 při prvním uložení dne, 1 denně v denní úloze, 0 při otevření stránky | první aktivní produkt obchodu a produkty, které scénáře potřebují jménem (cílený slevou, s výjimkou, ve výprodeji), s cenami | bez nákupních cen: nález „ochrana marže“ u těchto obchodů nevznikne (ochrana je vypnutá, nemá co snížit) |
| C. Zrcadlit ceny všech variant i bez Ochrany marže | celý katalog po stránkách (250 variant na dotaz) při zapnutí a po každé změně produktu | nejnižší marži nejde určit ani tak (nákupní ceny se nečtou) | řádově víc dotazů a dat za stejný výsledek jako B |

Zavedená varianta B: dotaz `WonCombinationProducts` (ověřený proti schématu Admin API 2026-04, vyžaduje jen
`read_products`, které aplikace má). Načtené produkty jsou uložené u výsledku (`CombinationCheck.products`) a čtou
se znovu, až když jsou starší 24 hodin nebo když scénář potřebuje produkt, který mezi nimi není. Když Shopify
neodpoví, použijí se uložené; uložení nastavení kvůli tomu nikdy neselže.

## Bod 11 — nejprodávanější produkt

Z uložených dat ho získat nejde. Přehledy ukládají ke každé objednávce jen to, kolik které slevy ubraly
(`OrderDiscountFact`: částky, žádné produkty, žádné osobní údaje). Admin API u dotazu `products` řazení podle
prodejnosti nenabízí. Kontrola ho proto nevybírá a stránka nápovědy to říká
(`apps/won-discounts/docs/tasks/try-a-cart.md`). Změnit by to šlo jen ukládáním produktů objednávek, což je
samostatné rozhodnutí (přístup k objednávkám je odložený úkol `won-discounts-pristup-k-objednavkam`).

## K rozhodnutí

1. **Bod 8:** potvrdit variantu B (jeden dotaz na produkty při uložení, nejvýš jednou denně), nebo zůstat
   u ukázkového produktu (A). Doporučení: B.
2. **„Pokladna slevy zkrátí“:** nález vznikne až u košíku se stovkami různých řádků (test ho staví ze 400 řádků).
   Scénáře aplikace mají jeden až dva řádky, takže ho v „Častých kombinacích“ obchodník prakticky neuvidí;
   ukáže se u ručního košíku. Přidat scénář „velký košík“ by znamenalo číst stovky produktů. Doporučení: nepřidávat.

## Jak měření zopakovat

Časy a počty dotazů: skript nad testovací databází (`createTestDatabase`, `FakeStore`), 300 řádků `VariantCost`,
obchod s množstevní slevou, kódem, slevou z objednávky, dvěma stupni Milníků, dopravou zdarma, dárkem a Ochranou
marže; 40 volání `combinationCheck`, `overviewPage` a `tryCartPage`, medián. Počet dotazů počítá rozšíření Prisma
klienta (`$allOperations`).
