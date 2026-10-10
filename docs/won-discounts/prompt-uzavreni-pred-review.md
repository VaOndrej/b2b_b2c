# Won Discounts — uzavření před první review (zadání pro novou inline session, stav k 10. 10. 2026)

## Chci mít

Aplikaci, kterou může poprvé projít netechnický potenciální klient. Review bude přes **celou aplikaci**, žádný modul
se neschovává ani neoznačuje jako Beta kvůli review. Nasazení na Railway do tohohle zadání nepatří.

Tvoje práce má dvě půlky:

1. **Projít aplikaci tak, jak dnes vypadá**, obrazovku po obrazovce a blok po bloku, a zapsat, co neplatí.
2. **Opravit, co najdeš.** Chyby, nesrozumitelná místa a místa, kde pravidla vzhledu ještě neplatí.

Nestavíš nové funkce. Tohle je první zadání, které má vývoj uzavřít, ne otevřít další kolo.

Majitel aplikace (Ondřej) není u počítače. Kde ti něco chybí, rozhodni sám podle pravidel níž, zapiš to do build logu
a pokračuj. Ptej se jen před nevratným krokem. Pracuješ **výhradně inline, bez subagentů**.

## Proč to děláme

Přečti [`analyza-vyvoje-2026-10-10.md`](analyza-vyvoje-2026-10-10.md). Krátce: za pět dní proběhlo sedm kol zpětné
vazby a pořád se vrací pět stejných druhů připomínek, pokaždé na jiné obrazovce. Opravy dosud dopadaly tam, kam Ondřej
zrovna ukázal. Ty máš tytéž druhy chyb najít **všude najednou**, dřív než je najde on nebo klient.

Pět druhů, podle kterých hledáš:

| # | Druh | Co kontroluješ |
|---|---|---|
| 1 | Nevidím stav | Každá dlaždice, sekce a blok říká pravdivě, jestli je to zapnuté. Zelená jen tehdy, když to opravdu běží pro všechny trhy. |
| 2 | Dlouhá stránka | Žádný dlouhý scroll bez dlaždic nebo bočního menu. Žádné rozbalování tam, kde není z čeho vybírat. |
| 3 | Nechápu, co to dělá | Obchodník, který nečte, pozná z obrazovky, co modul dělá, co má vyplnit a co se stane po uložení. |
| 4 | Web je jinak než aplikace | Náhled v aplikaci odpovídá webu. Blok je tam, kde aplikace tvrdí. Odkaz vede na správný produkt a správný blok. |
| 5 | Pravidlo platí jen někde | Co je opravené na jedné obrazovce, platí na všech se stejným prvkem. |

## Je to v

- Repo `~/Development/WonCommerce/Apps/b2b_b2c`, aplikace `apps/won-discounts`, jádro `packages/core/src/discounts`.
- **Pracuj v hlavním adresáři na větvi `main`.** Žádná nová větev, žádný `git worktree`.
- Obrazovky adminu: `apps/won-discounts/app/components/screens/` (14 souborů: Overview, Onboarding, Discounts,
  RuleEditor, Tiers, Milestones, Outlet, Campaigns, Margin, TryCart, Translations, Analytics, Settings, Plan).
- Sdílené součástky: `apps/won-discounts/app/components/shell/`.
- Bloky na webu: `apps/won-discounts/extensions/won-discounts-storefront/blocks/` (10 souborů).
- Admin se prohlíží přes dev náhled (`app/routes/dev.preview.$.tsx`, `app/lib/dev-harness.server.ts`). Do
  `admin.shopify.com` se Playwrightem nepřihlašuj (`mezery.md`, bod B4).
- Web se ověřuje na dev obchodě jen přes runbook (`apps/won-discounts/scripts/e2e/runbook/`): nejdřív nanečisto, po
  doběhnutí `cleanup` a `verify-clean` s exit 0.

## Povinná četba, v tomhle pořadí

1. `CLAUDE.md` v kořeni repa.
2. [`analyza-vyvoje-2026-10-10.md`](analyza-vyvoje-2026-10-10.md).
3. [`../won-discounts-build-log.md`](../won-discounts-build-log.md), oddíl „Aktuální stav“ až po „Dotažení úkolů 8 a 9“.
4. [`pravidla-vzhledu-kolo6-2026-10-10.md`](pravidla-vzhledu-kolo6-2026-10-10.md), hlavně sloupec „Kde ještě ne“.
5. [`../won-app-design-doctrine.md`](../won-app-design-doctrine.md), §17 až §20 a A7.
6. [`rozhodnuti.md`](rozhodnuti.md). Produktová rozhodnutí neměníš.

Po každé kompakci kontextu přečti znovu tohle zadání a blok CHECKPOINT (viz níž).

## Krok 0 — čistý start

V pracovním stromu jsou necommitnutá kola 4 až 7 (zhruba 96 souborů, 3 migrace databáze). Ondřej ti spuštěním tohohle
zadání dává „go“ na jejich commit.

1. `git status` a `git log origin/main..HEAD`. Když je tam něco jiného než kola 4 až 7 z build logu, zastav a napiš to.
2. `npm run setup -w won-discounts` (nové migrace).
3. Pusť celou bránu (viz „Brána“). Červená se opraví před commitem.
4. Commit po kolech, pokud jdou soubory rozumně rozdělit, jinak jeden commit s popisem všech čtyř kol. Push do `main`.

Dál pracuješ na čistém `main`.

## Krok 1 — průchod a matice

Založ [`matice-pred-review.md`](matice-pred-review.md). Je to hlavní výstup průchodu a zároveň to, co bude Ondřej
kontrolovat místo proklikávání aplikace.

**Tabulka A, admin.** Řádek = obrazovka nebo její pohled (dlaždice, která otevírá vlastní obsah, je samostatný řádek).
Sloupec = pravidlo: deset pravidel z `pravidla-vzhledu-kolo6-2026-10-10.md` a pravidla z doktríny §17 až §20. V poli
je `platí`, `neplatí` (s číslem nálezu), nebo `—` (netýká se).

**Tabulka B, web.** Řádek = blok. Sloupce: ukáže se na Horizonu, ukáže se na Dawnu, mobil 390 px, náhled v aplikaci
odpovídá webu, stav v aplikaci odpovídá skutečnosti, odkaz „otevřít v editoru“ vede správně, prázdný stav dává smysl.

**Tabulka C, scénáře obchodníka.** Projdi každý jako někdo, kdo aplikaci vidí poprvé a nečte dlouhé texty. U každého
zapiš počet kliknutí, kde ses zasekl a co jsi musel hádat.

1. První spuštění: průvodce až po první běžící slevu.
2. Doprava zdarma a dárek jako milníky pro Česko a Slovensko, vidět na webu.
3. Množstevní sleva na celý obchod, jedna výjimka pro produkt, tabulka na stránce produktu.
4. Sleva kódem, dávka náhodných kódů.
5. Výprodej jednoho produktu se štítkem na webu, kombinace s množstevní slevou.
6. Kampaň s bannerem a odpočtem.
7. Ochrana marže: zapnout, nastavit hranici pro obchod, kolekci a produkt, poznat, kde zasáhla.
8. Vyzkoušet košík: časté kombinace a ruční košík, pochopit upozornění a vědět, co s ním.
9. Druhý jazyk v Překladech, export a import.
10. Nastavení trhů a měn, chybějící částka v druhé měně.
11. Tarif: co je Free, co Pro, co se stane při přechodu zpět.

**Seznam nálezů** pod tabulkami. Každý nález: číslo, obrazovka nebo blok, druh (1 až 5 z tabulky nahoře), co obchodník
vidí, proč je to špatně, screenshot, a značka:

- **A, brání:** obchodník úkol nedokončí, nebo zákazník nedostane, co má.
- **B, mate:** dokončí, ale musí hádat, nebo aplikace tvrdí něco, co neplatí.
- **C, vkus:** funguje a je srozumitelné, jen by mohlo vypadat líp.

Projdi obě šířky (390 px a 1 440 px), oba tarify (Free a Pro) a prázdný i naplněný stav. Screenshoty do
`docs/won-discounts/evidence/pred-review-2026-10-10/`.

Průchod dokonči celý dřív, než začneš opravovat. Matici commitni.

## Krok 2 — opravy

Pořadí: všechna A, potom všechna B. **C neopravuješ**, jen je necháš v seznamu.

- Stejný druh nálezu na víc obrazovkách oprav jednou, ve sdílené součástce v `shell/`. Když součástka chybí, založ ji
  a použij všude. Žádná oprava kopírováním.
- Sloupec „Kde ještě ne“ z pravidel vzhledu ber jako nálezy B, pokud leží na cestě některého scénáře.
- Když je u modulu problém v tom, že nejde pochopit (druh 3), nezačínej textem. Nejdřív zkus: pořadí kroků, jeden
  příklad s čísly přímo na obrazovce, živý náhled výsledku. Text přidej až nakonec a krátký.
- Po každé opravené skupině: test, který by nález chytil, přepsat pole v matici na `platí`, screenshot po opravě,
  brána, commit, push, CHECKPOINT.
- Po opravách matici projdi ještě jednou celou. Oprava jedné obrazovky nesmí rozbít jinou.

## Krok 3 — ověření naživo

V build logu je 17× „neověřeno naživo“. Projdi je všechny a u každé napiš jedno ze tří:

- **ověřeno** přes runbook na Horizonu a Dawnu, s důkazem,
- **opraveno a ověřeno**,
- **nejde ověřit bez Ondřeje** (editor šablon, pokladna za přihlášením). K těm napiš přesné kroky: kam kliknout a co
  má vidět. Jdou do závěrečné zprávy jako jeden seznam.

Při selhaném E2E opakuj jen selhaný profil nebo test, ne celé kolo.

## Co neděláš

- Žádná nová funkce, nový blok, nový modul ani nová volba v nastavení. Když ti při průchodu nějaká chybí, zapiš ji do
  oddílu „Po review“ na konci matice a nech ji být.
- Žádná změna pokladní funkce (Rust, `extensions/won-discounts-engine`) ani schématu databáze, pokud to není oprava
  nálezu A. Wasm má strop 256 000 B, teď je na 237 328 B.
- Žádné nasazení: ne Railway, ne `shopify app deploy`.
- Žádný billing naživo, žádná analytika z objednávek, žádné nabídky z objednávek (5b). Jsou odložené.
- Žádný `prettier`. Repo nemá config a přeformátuje soubory na 80 znaků. Před commitem `git diff --stat`.
- Žádný zápis do dev obchodu mimo runbook. Heslo ke storefrontu je jen v `apps/won-discounts/.env`.
- Žádné zkratky v kódu: žádné `any`, žádné vypnuté testy, žádné `eslint-disable` navíc.

## Rozhodnutí, která platí a nemění se

- Dlaždice ukazuje zapnutý stav štítkem „Aktivní“. Žádné jiné slovo, i kdyby sekce pod ní říkala něco konkrétnějšího.
- Dlaždice Pro částí ukazují štítek „Pro“ i obchodu, který Pro má. Na Free „Pro · odemknout“.
- Vyká se. Štítek BETA zůstává tam, kde je.
- Dárkové karty nedostanou nikdy žádnou slevu.
- Výprodej do pruhu nahoře nepatří. Štítek výprodeje se vkládá jako blok na stránku produktu.
- Všechny částky jsou podle trhu.

## Brána

Po každé vrstvě celý `npm run test:unit -w won-discounts` (node, cargo, vitest), balíčky, `typecheck`, `lint`, `build`,
`theme check`, a když běží dev server, `test:e2e:preview`. Přesné příkazy a poslední zelená čísla jsou v build logu
(node 1 884, core 963, cargo 106, vitest 719). Počet testů smí jen růst.

## CHECKPOINT

Na začátek oddílu „Aktuální stav“ v build logu založ blok „Uzavření před review“ s řádkem CHECKPOINT: který krok,
kolik nálezů A a B je otevřených, poslední commit, co je rozdělané. Přepisuj ho po každé opravené skupině, ne až
na konci.

## Kdy je hotovo

- Matice nemá žádné `neplatí` u nálezů A ani B.
- Všech 11 scénářů projde bez zaseknutí. U každého je počet kliknutí před a po.
- Každá položka „neověřeno naživo“ má jeden ze tří stavů.
- Brána je zelená, všechno je v `origin/main`, `git status` je prázdný.

Když hotovo nestihneš, neuzavírej to. Napiš, co zbývá, a nech CHECKPOINT tak, aby šlo navázat.

## Závěrečná zpráva

Krátce, v tomhle pořadí:

1. Jedna věta, co je hotové.
2. Čísla: kolik nálezů A, B a C, kolik opravených, kolik zbývá.
3. Odkaz na matici a na složku s důkazy.
4. Seznam „ověř sám“ pro Ondřeje s přesnými kroky.
5. Nálezy C a oddíl „Po review“ jako seznam k rozhodnutí.
