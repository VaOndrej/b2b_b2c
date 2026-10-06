# Won Discounts — implementace třetího kola feedbacku (prompt pro AI, práce inline bez subagentů)

## Role a cíl

Jsi vývojář Shopify appky `won-discounts` v monorepu `~/Development/WonCommerce/Apps/b2b_b2c`, větev
`won-discounts-feedback-2026-10-06` (výchozí bod: commit `03bb055`). Implementuješ **všech 16 bodů** feedbacku od
Ondřeje ze 6. 10. 2026. Hotovo znamená: každý bod je v kódu, má test a důkaz, a v plánu je u něj zapsaný stav.
Žádný bod nesmí vypadnout; když některý nejde dokončit, řekneš to výslovně a proč.

Plán se všemi body, dnešním stavem v kódu, návrhem a jedenácti rozhodnutími je v
`docs/won-discounts/feedback-2026-10-06-kolo3-plan.md`. **Rozhodnutí v něm jsou Ondřejova a neměníš je.** Návrhy
jsou moje a vycházejí ze čtení kódu, ne z běžící appky: když se kód chová jinak, než plán tvrdí, řiď se kódem a
rozdíl zapiš.

## Začni tady

1. `docs/won-discounts/feedback-2026-10-06-kolo3-plan.md` — celé. Po každé kompakci kontextu znovu.
2. `CLAUDE.md` v rootu repa (zápis do live jen s „go“, `--dry-run` a záloha, důkaz místo tvrzení).
3. `docs/won-discounts-build-log.md`, sekce „Aktuální stav“ — co je otevřené a které necommitnuté soubory jsou cizí.
4. `docs/won-discounts/plan-zmen-2026-10-06.md` — první dvě kola, pravidla P1 až P9 a seznam „Neověřeno naživo“.
5. `docs/won-app-design-doctrine.md` (hlavně §18) a `docs/won-discounts/rozhodnuti.md`.
6. Podle potřeby: `docs/nova-aplikace.md`, `apps/won-discounts/extensions/won-discounts-storefront/README.md`,
   `apps/won-discounts/extensions/won-discounts-engine/README.md`.

## Co se implementuje

Detaily jsou v plánu, tohle je kontrolní seznam.

| Dávka | Bod | Co |
|---|---|---|
| A | 1, 8 | Zelený štítek „Aktivní“ (en „Active“) u všeho, co běží: jedna funkce stavu modulu, stejná na úvodní stránce i na stránce modulu. Odměny, Množstevní slevy, Ochrana marže, Výprodej, Kampaně, Slevy a kódy. |
| A | 2, 3 | Úvodní stránka jako rozcestník z dlaždic, celá dlaždice je odkaz. 3 sloupce na 1440 px, 2 sloupce na tabletu i na 390 px. Žádné nové bloky. |
| A | 5 | Tabulka v tématu: zelený štítek, když tam je; červený štítek + tlačítko na přidání, když není. Stejný vzor pro všechna umístění na webu. |
| A | 6 | Výjimky: jantar a štítek Pro jen jednou na sekci, vnořené bloky neutrální. Stejná chyba jinde. |
| A | 15 | „Prázdná sleva“ → „Vlastní sleva“ s větou, co to je. |
| B | 4 | Množstevní tabulka na stránce produktu počítá s kusy v košíku a přepíná aktivní a další úroveň i po změně košíku bez načtení stránky. Nejdřív zopakovat naživo. |
| C | 7 | Výjimky: jednodušší zadávání (řádky, přidání ve dvou krocích, převzaté počítání a typ slevy). |
| D | 9 | Milníky místo Odměn: stupně podle hodnoty košíku, odměna = dárek / doprava zdarma / sleva na celou objednávku. Free 2 stupně, Pro 6. Převod uložených odměn. |
| D | 10 | Milníky na webu: pruh nahoře, stránka produktu, boční košík, stránka košíku. Desktop i mobil. |
| E | 11, 14 | Překlady: texty pro jazyky zapnuté v Shopify, přidání jazyka rozbalovacím seznamem, Free 2 jazyky, Pro neomezeně, export a import CSV (jen Pro). |
| E | 12 | Záložka Vzhled zmizí, místo ní Překlady. Stará adresa přesměruje. |
| E | 13 | Vzhled se nastavuje u každého modulu a **nesdílí se**: tabulka, milníky, výprodej, kampaň. Free hotové vzhledy, Pro vlastní CSS pro každý zvlášť. |
| F | 16 | Kontrola kombinací: appka sama sestaví a spočítá časté kombinace aktivních slev, upozorní (hlavně na ochranu marže). Seznam ve Vyzkoušet košík, dlaždice na úvodní stránce. Počet vidí Free, detail je Pro. |

Pořadí: A → B → C → D → E → F. Další dávka nezačíná, dokud předchozí nemá zelenou bránu, důkazy a commit.

## Jak pracuješ

- **Výhradně inline.** Žádní subagenti, žádné workflow, ani na průzkum nebo audit (Ondřejův pokyn ze 6. 10.).
- Na začátku každé dávky krátký rozpis do plánu: soubory, tvary dat, které se mění (nastavení, data pro pokladnu,
  data pro web), a testy. U dávek D a E tvary dat zafixuj a commitni před implementací.
- Testy píšeš první a necháš je selhat, pak implementuješ.
- Po každé vrstvě celý `npm run test:unit` v `apps/won-discounts` (už dvakrát prošla červená brána bez povšimnutí).
- Stav průběžně zapisuj do plánu (sekce „Stav implementace“ na konci, po bodech), ať ho kompakce nesmaže.
- Commit po každé dávce na téhle větvi. Push a merge do `main` jen na Ondřejův pokyn.
- Když z bodu vyplyne pravidlo pro všechny Won appky (štítky stavu, Pro značené jednou, vzhled po prvcích),
  zapiš ho do `docs/won-app-design-doctrine.md` a do šablony `apps/_template`.
- Texty v adminu: česky i anglicky, vykat, bez žargonu („engine“, „propsat“, „slevová funkce“ do rozhraní nepatří).

## Brána každé dávky

```
cd ~/Development/WonCommerce/Apps/b2b_b2c
npm run test:packages
npm run test:unit -w won-discounts
npm run typecheck -w won-discounts
npm run lint -w won-discounts
npm run build -w won-discounts
npm run validate:shopify
```

Názvy workspace a skriptů si ověř v `package.json`, než je pustíš. Do zprávy dávej skutečný výstup, ne „prošlo“.

Důkazy navíc:
- **Admin:** screenshoty z Playwrightu ve 390 a 1440 px, před i po, pro každou změněnou obrazovku.
- **Web (body 4, 10, 13):** Horizon i Dawn, 390 a 1440 px, a E2E test, který opravdu kliká (přidání do košíku,
  průchod stupni milníků). Při selhaném E2E opakuj jen selhaný profil nebo test, ne celé kolo.
- **Data (bod 9 převod, bod 14 import):** dry-run výpis a tři skutečné záznamy po změně.

## Pevná omezení

- **Slevová funkce** má do limitu velikosti 1 037 B a výkonovou rezervu 0,10 bodu. Slevu z objednávky v milnících
  sestav z toho, co pokladna umí dnes. Když to nejde bez zvětšení funkce, zastav se a napiš Ondřejovi čísla.
- **Skript na stránce produktu:** interní limit se zvedá z 10 240 B na 12 kB (rozhodnuto). Změř váhu a rychlost
  stránky před a po a čísla přilož.
- **Nové oprávnění ke čtení jazyků obchodu** (bod 14): přesný název ověř v dokumentaci Shopify, nehádej. Appka musí
  fungovat i předtím, než ho obchodník potvrdí (nabídne jen výchozí jazyk a řekne proč).
- **Vlastní CSS** každého prvku platí jen uvnitř něj. Dnešní společné nastavení se při převodu zkopíruje k tabulce;
  ověř, že se na webu nic nezmění.
- **Repo nemá prettier.** Neformátuj soubory, hlídej `git diff --stat`, ať se nemění řádky, kterých ses nedotkl.
- **Cizí necommitnuté soubory nech být:** `docs/product-roadmap.html`, `docs/won-companion/`,
  `docs/won-discounts/paralelizace.md`, `apps/*/railway.json`, `docs/railway-hosting.md`, odstavec o Railway
  v `apps/won-discounts/DEPLOY.md`.
- Adresy stránek zůstávají (`/app/rewards`, `/app/appearance` přesměruje na `/app/translations`, `/app/plan`).
- Nenasazuj. Billing naživo a přístup k objednávkám jsou dál zablokované mimo tenhle úkol.

## Kdy se zastavit a zeptat

- **Bod 7:** před implementací ukaž Ondřejovi nákres obou stavů (seznam výjimek, úprava výjimky) a počkej na schválení.
  Mezitím pokračuj dávkami A a B.
- Zápis do dev storu nebo do tématu (instalace bloků, změna šablony, testovací objednávky): nejdřív dry-run a „go“.
- Nové oprávnění appky v `shopify.app.toml`: před změnou řekni, co obchodník uvidí.
- Když se bod nedá splnit tak, jak je rozhodnuto, nebo by rozhodnutí šla proti sobě.
- Na drobnosti (názvy, pořadí, texty) se neptej; rozhodni, zapiš do plánu a pokračuj.

## Co ověřit, než tomu uvěříš

Tohle v plánu stojí jen na čtení kódu:
- Bod 4: příčina je vynulování počtů po změně košíku (`assets/won-discounts-tiers.js:136`). Jestli tabulka počítá
  košík správně aspoň při načtení stránky, není ověřeno.
- Bod 1: proč není štítek vidět u Ochrany marže, i když ho karta posílá.
- Bod 9: dva stupně se slevou z objednávky → platí jen vyšší; práh slevy se počítá stejně jako práh dárku; chování
  s kódem a s ochranou marže.
- Bod 10: kde téma dovolí blok aplikace v bočním košíku (Horizon, Dawn).
- Bloky z druhého kola (průběh odměn, pruh nahoře, banner kampaně) nebyly naživo v editoru šablony ověřené.

## Zpráva na konci každé dávky

Česky, krátce, v tomhle pořadí:
1. Jedna věta, co je hotové.
2. Odrážky, co se změnilo, s `soubor:řádek`, a u každého bodu důkaz (cesta ke screenshotům, výstup testů).
3. Co není ověřené naživo a co se nepovedlo.
4. Jedna věta, co má Ondřej rozhodnout nebo ověřit, s přesným příkazem do terminálu.

Po dávce F projdi všech 16 bodů proti plánu jeden po druhém a ke každému napiš: hotovo / hotovo s výhradou / nehotovo.
